// Compute per-cluster metrics from the DB. Several focused queries merged in
// TS rather than one monster aggregate — easier to read, easier to evolve.
//
// All filters are run-time-safe (no string interpolation). The cluster_id and
// tool_name columns are short text so the GROUP BY traffic is light.

import { asc, eq, isNotNull, sql } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import type { ClusterMetrics } from "./typology.ts";

// Inlined preview examples on the insight row — enough to show phrasing
// variety, few enough to keep the list endpoint snappy. Engineers wanting more
// hit /v1/insights/:id/eval-set, which paginates the full set.
const EXAMPLES_PER_CLUSTER = 3;

export async function aggregateAllClusters(): Promise<ClusterMetrics[]> {
  const clusters = await db
    .select({ id: schema.clusters.id, label: schema.clusters.label })
    .from(schema.clusters)
    .orderBy(asc(schema.clusters.id));

  if (clusters.length === 0) return [];

  const totalConvRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.conversations);
  const totalConversations = totalConvRows[0]?.count ?? 0;

  // Per-cluster: distinct conversation count + sentiment + is_repeat rate.
  const coreRows = await db
    .select({
      clusterId: schema.intents.clusterId,
      conversationCount: sql<number>`count(distinct ${schema.turns.conversationId})::int`,
      sentimentAvg: sql<number>`avg(${schema.turnSignals.sentiment})::float`,
      isRepeatRate: sql<number>`avg(case when ${schema.turnSignals.isRepeat} then 1.0 else 0.0 end)::float`,
      turnCount: sql<number>`count(*)::int`,
    })
    .from(schema.intents)
    .innerJoin(schema.turnSignals, eq(schema.turnSignals.intent, schema.intents.intent))
    .innerJoin(schema.turns, eq(schema.turns.id, schema.turnSignals.turnId))
    .where(isNotNull(schema.intents.clusterId))
    .groupBy(schema.intents.clusterId);
  const coreByCluster = new Map(coreRows.map((r) => [r.clusterId!, r]));

  // Per-cluster, per-week conversation counts.
  const weekRows = await db
    .select({
      clusterId: schema.intents.clusterId,
      week: sql<string>`date_trunc('week', ${schema.conversations.startedAt})::text`,
      conversationCount: sql<number>`count(distinct ${schema.conversations.id})::int`,
    })
    .from(schema.intents)
    .innerJoin(schema.turnSignals, eq(schema.turnSignals.intent, schema.intents.intent))
    .innerJoin(schema.turns, eq(schema.turns.id, schema.turnSignals.turnId))
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.turns.conversationId))
    .where(isNotNull(schema.intents.clusterId))
    .groupBy(schema.intents.clusterId, sql`date_trunc('week', ${schema.conversations.startedAt})`)
    .orderBy(schema.intents.clusterId, sql`date_trunc('week', ${schema.conversations.startedAt})`);

  const weeklyByCluster = new Map<string, number[]>();
  const allWeeksSet = new Set<string>();
  const rawWeekData = new Map<string, Map<string, number>>(); // clusterId → week → count
  for (const r of weekRows) {
    allWeeksSet.add(r.week);
    let m = rawWeekData.get(r.clusterId!);
    if (!m) {
      m = new Map();
      rawWeekData.set(r.clusterId!, m);
    }
    m.set(r.week, r.conversationCount);
  }
  const allWeeks = Array.from(allWeeksSet).sort();
  for (const [clusterId, byWeek] of rawWeekData) {
    weeklyByCluster.set(clusterId, allWeeks.map((w) => byWeek.get(w) ?? 0));
  }

  // Per-cluster end_reason distribution.
  const endReasonRows = await db
    .select({
      clusterId: schema.intents.clusterId,
      endReason: schema.conversations.endReason,
      conversationCount: sql<number>`count(distinct ${schema.conversations.id})::int`,
    })
    .from(schema.intents)
    .innerJoin(schema.turnSignals, eq(schema.turnSignals.intent, schema.intents.intent))
    .innerJoin(schema.turns, eq(schema.turns.id, schema.turnSignals.turnId))
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.turns.conversationId))
    .where(isNotNull(schema.intents.clusterId))
    .groupBy(schema.intents.clusterId, schema.conversations.endReason);

  const endReasonByCluster = new Map<string, Record<string, number>>();
  for (const r of endReasonRows) {
    const dist = endReasonByCluster.get(r.clusterId!) ?? {};
    dist[r.endReason] = r.conversationCount;
    endReasonByCluster.set(r.clusterId!, dist);
  }
  // Normalize to rates (per conversation).
  for (const [clusterId, dist] of endReasonByCluster) {
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    if (total > 0) {
      for (const k of Object.keys(dist)) dist[k] = dist[k]! / total;
    }
  }

  // Per-cluster frustration marker distribution. Unnest the array column for
  // simple counting; rate = occurrences / total user turns in cluster.
  const markerRows = await db.execute<{
    cluster_id: string;
    marker: string;
    occurrences: number;
  }>(sql`
    SELECT i.cluster_id, marker, count(*)::int AS occurrences
    FROM ${schema.intents} i
    JOIN ${schema.turnSignals} s ON s.intent = i.intent
    CROSS JOIN LATERAL unnest(s.frustration_markers) AS marker
    WHERE i.cluster_id IS NOT NULL
    GROUP BY i.cluster_id, marker
  `);
  const markerByCluster = new Map<string, Record<string, number>>();
  for (const r of markerRows) {
    const dist = markerByCluster.get(r.cluster_id) ?? {};
    dist[r.marker] = r.occurrences;
    markerByCluster.set(r.cluster_id, dist);
  }
  for (const [clusterId, dist] of markerByCluster) {
    const turnCount = coreByCluster.get(clusterId)?.turnCount ?? 1;
    for (const k of Object.keys(dist)) dist[k] = dist[k]! / turnCount;
  }

  // Per-cluster tool call counts + failure rates. The DISTINCT CTE is critical:
  // a conversation with N user turns in the cluster would otherwise count each
  // tool call N times. The cluster→tool_call mapping must be deduplicated first.
  const toolRows = await db.execute<{
    cluster_id: string;
    tool_name: string;
    total_calls: number;
    failed_calls: number;
  }>(sql`
    WITH cluster_tool_calls AS (
      SELECT DISTINCT i.cluster_id, tc.id AS tool_call_id, tc.tool_name, tc.status
      FROM ${schema.intents} i
      JOIN ${schema.turnSignals} s ON s.intent = i.intent
      JOIN ${schema.turns} t ON t.id = s.turn_id
      JOIN ${schema.turns} t2 ON t2.conversation_id = t.conversation_id
      JOIN ${schema.toolCalls} tc ON tc.turn_id = t2.id
      WHERE i.cluster_id IS NOT NULL
    )
    SELECT
      cluster_id,
      tool_name,
      count(*)::int AS total_calls,
      sum(case when status in ('error', 'empty_result') then 1 else 0 end)::int AS failed_calls
    FROM cluster_tool_calls
    GROUP BY cluster_id, tool_name
  `);

  // Per-cluster avg tool calls per conversation + avg latency.
  // Same multiplication risk — dedupe cluster→(conv, tool_call) first.
  const toolCallCountRows = await db.execute<{
    cluster_id: string;
    avg_tool_calls: number;
    avg_latency_ms: number;
  }>(sql`
    WITH cluster_convs AS (
      SELECT DISTINCT i.cluster_id, t.conversation_id
      FROM ${schema.intents} i
      JOIN ${schema.turnSignals} s ON s.intent = i.intent
      JOIN ${schema.turns} t ON t.id = s.turn_id
      WHERE i.cluster_id IS NOT NULL
    ),
    per_conv AS (
      SELECT
        cc.cluster_id,
        cc.conversation_id,
        coalesce(count(tc.id), 0)::float AS tool_calls,
        coalesce(avg(tc.latency_ms), 0)::float AS avg_latency
      FROM cluster_convs cc
      LEFT JOIN ${schema.turns} t2 ON t2.conversation_id = cc.conversation_id
      LEFT JOIN ${schema.toolCalls} tc ON tc.turn_id = t2.id
      GROUP BY cc.cluster_id, cc.conversation_id
    )
    SELECT
      cluster_id,
      avg(tool_calls)::float AS avg_tool_calls,
      avg(avg_latency)::float AS avg_latency_ms
    FROM per_conv
    GROUP BY cluster_id
  `);
  const toolCallStatsByCluster = new Map(
    toolCallCountRows.map((r) => [
      r.cluster_id,
      { avg_tool_calls: r.avg_tool_calls, avg_latency_ms: r.avg_latency_ms },
    ]),
  );

  // Attributed cause: top-failure tool per cluster (min 5 calls).
  const attributedCauseByCluster = new Map<string, { tool: string; failure_rate: number }>();
  const grouped = new Map<string, typeof toolRows>();
  for (const r of toolRows) {
    const arr = grouped.get(r.cluster_id) ?? [];
    arr.push(r);
    grouped.set(r.cluster_id, arr);
  }
  for (const [clusterId, rows] of grouped) {
    const candidates = rows
      .filter((r) => r.total_calls >= 5)
      .map((r) => ({ tool: r.tool_name, failure_rate: r.failed_calls / r.total_calls }))
      .sort((a, b) => b.failure_rate - a.failure_rate);
    if (candidates.length > 0 && candidates[0]!.failure_rate > 0) {
      attributedCauseByCluster.set(clusterId, candidates[0]!);
    }
  }

  // Example conversation IDs per cluster — random sample.
  const exampleRows = await db.execute<{ cluster_id: string; conversation_id: string }>(sql`
    SELECT cluster_id, conversation_id FROM (
      SELECT
        i.cluster_id,
        t.conversation_id,
        row_number() OVER (PARTITION BY i.cluster_id ORDER BY random()) AS rn
      FROM ${schema.intents} i
      JOIN ${schema.turnSignals} s ON s.intent = i.intent
      JOIN ${schema.turns} t ON t.id = s.turn_id
      WHERE i.cluster_id IS NOT NULL
      GROUP BY i.cluster_id, t.conversation_id
    ) sub
    WHERE rn <= ${EXAMPLES_PER_CLUSTER}
  `);
  const examplesByCluster = new Map<string, string[]>();
  for (const r of exampleRows) {
    const arr = examplesByCluster.get(r.cluster_id) ?? [];
    arr.push(r.conversation_id);
    examplesByCluster.set(r.cluster_id, arr);
  }

  return clusters.map((c) => {
    const core = coreByCluster.get(c.id);
    const toolStats = toolCallStatsByCluster.get(c.id);
    return {
      cluster_id: c.id,
      cluster_label: c.label,
      conversation_count: core?.conversationCount ?? 0,
      total_conversations: totalConversations,
      volume_pct:
        totalConversations > 0 ? (core?.conversationCount ?? 0) / totalConversations : 0,
      sentiment_avg: core?.sentimentAvg ?? 0,
      weekly_volume: weeklyByCluster.get(c.id) ?? [],
      avg_tool_calls_per_conv: toolStats?.avg_tool_calls ?? 0,
      is_repeat_rate: core?.isRepeatRate ?? 0,
      end_reason_distribution: endReasonByCluster.get(c.id) ?? {},
      marker_distribution: markerByCluster.get(c.id) ?? {},
      attributed_cause: attributedCauseByCluster.get(c.id) ?? null,
      avg_latency_ms: toolStats?.avg_latency_ms ?? 0,
      example_conversation_ids: examplesByCluster.get(c.id) ?? [],
    };
  });
}
