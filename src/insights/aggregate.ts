// Compute per-cluster metrics from the DB. Several focused queries merged in
// TS rather than one monster aggregate — easier to read, easier to evolve.
//
// All filters are run-time-safe (no string interpolation). The cluster_id and
// tool_name columns are short text so the GROUP BY traffic is light.

import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db, schema } from "../db/client.ts";
import { pickStableShuffled } from "../lib/sampling.ts";
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

  // Per-cluster tool call counts + failure rates. The DISTINCT query is critical:
  // a conversation with N user turns in the cluster would otherwise count each
  // tool call N times. The cluster→tool_call mapping must be deduplicated first.
  const conversationTurns = alias(schema.turns, "conversation_turns");
  const clusterToolCallRows = await db
    .selectDistinct({
      clusterId: schema.intents.clusterId,
      conversationId: schema.turns.conversationId,
      toolCallId: schema.toolCalls.id,
      toolName: schema.toolCalls.toolName,
      status: schema.toolCalls.status,
      latencyMs: schema.toolCalls.latencyMs,
    })
    .from(schema.intents)
    .innerJoin(schema.turnSignals, eq(schema.turnSignals.intent, schema.intents.intent))
    .innerJoin(schema.turns, eq(schema.turns.id, schema.turnSignals.turnId))
    .innerJoin(conversationTurns, eq(conversationTurns.conversationId, schema.turns.conversationId))
    .innerJoin(schema.toolCalls, eq(schema.toolCalls.turnId, conversationTurns.id))
    .where(isNotNull(schema.intents.clusterId));

  // Per-cluster avg tool calls per conversation + avg latency.
  // Same multiplication risk — dedupe cluster→(conv, tool_call) first.
  const clusterConvRows = await db
    .selectDistinct({
      clusterId: schema.intents.clusterId,
      conversationId: schema.turns.conversationId,
    })
    .from(schema.intents)
    .innerJoin(schema.turnSignals, eq(schema.turnSignals.intent, schema.intents.intent))
    .innerJoin(schema.turns, eq(schema.turns.id, schema.turnSignals.turnId))
    .where(isNotNull(schema.intents.clusterId));

  const perClusterConv = new Map<string, { clusterId: string; calls: number; latencySum: number }>();
  for (const row of clusterConvRows) {
    perClusterConv.set(`${row.clusterId!}:${row.conversationId}`, {
      clusterId: row.clusterId!,
      calls: 0,
      latencySum: 0,
    });
  }
  for (const row of clusterToolCallRows) {
    const key = `${row.clusterId!}:${row.conversationId}`;
    const entry = perClusterConv.get(key);
    if (!entry) continue;
    entry.calls++;
    entry.latencySum += row.latencyMs;
  }

  const toolCallStatsByCluster = new Map<
    string,
    { avg_tool_calls: number; avg_latency_ms: number }
  >();
  const statsAcc = new Map<
    string,
    { convs: number; toolCalls: number; avgLatencySum: number }
  >();
  for (const entry of perClusterConv.values()) {
    const acc = statsAcc.get(entry.clusterId) ?? {
      convs: 0,
      toolCalls: 0,
      avgLatencySum: 0,
    };
    acc.convs++;
    acc.toolCalls += entry.calls;
    acc.avgLatencySum += entry.calls > 0 ? entry.latencySum / entry.calls : 0;
    statsAcc.set(entry.clusterId, acc);
  }
  for (const [clusterId, acc] of statsAcc) {
    toolCallStatsByCluster.set(clusterId, {
      avg_tool_calls: acc.convs > 0 ? acc.toolCalls / acc.convs : 0,
      avg_latency_ms: acc.convs > 0 ? acc.avgLatencySum / acc.convs : 0,
    });
  }

  // Attributed cause: top-failure tool per cluster (min 5 calls).
  const attributedCauseByCluster = new Map<string, { tool: string; failure_rate: number }>();
  type ToolRow = { tool_name: string; total_calls: number; failed_calls: number };
  const grouped = new Map<string, Map<string, ToolRow>>();
  for (const r of clusterToolCallRows) {
    const byTool = grouped.get(r.clusterId!) ?? new Map<string, ToolRow>();
    const tool = byTool.get(r.toolName) ?? {
      tool_name: r.toolName,
      total_calls: 0,
      failed_calls: 0,
    };
    tool.total_calls++;
    if (r.status === "error" || r.status === "empty_result") tool.failed_calls++;
    byTool.set(r.toolName, tool);
    grouped.set(r.clusterId!, byTool);
  }
  // Thresholds: we want attribution only when a tool failure is genuinely the
  // story of the cluster — not when *some* refund tool fails in *some*
  // conversations that happen to overlap. Require:
  //  - >= 10 calls total to that tool within cluster conversations
  //  - failure rate >= 0.5
  // Otherwise, no attribution. Positive-sentiment clusters get further
  // filtered downstream (a happy cluster shouldn't be "attributed" to a
  // tool that incidentally fails for some unrelated reason).
  const MIN_CALLS = 10;
  const MIN_FAILURE_RATE = 0.5;
  for (const [clusterId, byTool] of grouped) {
    const candidates = Array.from(byTool.values())
      .filter((r) => r.total_calls >= MIN_CALLS)
      .map((r) => ({ tool: r.tool_name, failure_rate: r.failed_calls / r.total_calls }))
      .filter((c) => c.failure_rate >= MIN_FAILURE_RATE)
      .sort((a, b) => b.failure_rate - a.failure_rate);
    if (candidates.length > 0) {
      attributedCauseByCluster.set(clusterId, candidates[0]!);
    }
  }

  // Example conversation IDs per cluster. Hash-based pseudo-randomization:
  // stable across runs (same insight always shows the same examples — good
  // for debugging) but mixes across the dataset so the LLM and the UI don't
  // always ground on the same atypical first-by-id conversations.
  const exampleRows = await db
    .selectDistinct({
      clusterId: schema.intents.clusterId,
      conversationId: schema.turns.conversationId,
    })
    .from(schema.intents)
    .innerJoin(schema.turnSignals, eq(schema.turnSignals.intent, schema.intents.intent))
    .innerJoin(schema.turns, eq(schema.turns.id, schema.turnSignals.turnId))
    .where(isNotNull(schema.intents.clusterId));
  const examplesByCluster = pickStableShuffled(
    exampleRows.map((r) => ({ key: r.clusterId!, value: r.conversationId })),
    EXAMPLES_PER_CLUSTER,
  );

  // Sample user messages per cluster — used by the content generator to ground
  // recommendations in actual conversation content, not just aggregates.
  const SAMPLE_MESSAGES_PER_CLUSTER = 8;
  const sampleMsgRows = await db
    .select({
      clusterId: schema.intents.clusterId,
      content: schema.turns.content,
      turnIndex: schema.turns.turnIndex,
    })
    .from(schema.intents)
    .innerJoin(schema.turnSignals, eq(schema.turnSignals.intent, schema.intents.intent))
    .innerJoin(schema.turns, eq(schema.turns.id, schema.turnSignals.turnId))
    .where(
      and(
        isNotNull(schema.intents.clusterId),
        eq(schema.turns.role, "user"),
        sql`length(${schema.turns.content}) > 8`,
      ),
    );
  const sampleMessagesByCluster = pickStableShuffled(
    sampleMsgRows.map((r) => ({ key: r.clusterId!, value: r.content })),
    SAMPLE_MESSAGES_PER_CLUSTER,
  );

  const intentTurnCount = sql<number>`count(${schema.turnSignals.turnId})::int`;
  const topIntentRows = await db
    .select({
      clusterId: schema.intents.clusterId,
      intent: schema.intents.intent,
      turnCount: intentTurnCount,
    })
    .from(schema.intents)
    .innerJoin(schema.turnSignals, eq(schema.turnSignals.intent, schema.intents.intent))
    .where(isNotNull(schema.intents.clusterId))
    .groupBy(schema.intents.clusterId, schema.intents.intent)
    .orderBy(asc(schema.intents.clusterId), desc(intentTurnCount), asc(schema.intents.intent));
  const topIntentsByCluster = new Map<
    string,
    Array<{ intent: string; turn_count: number }>
  >();
  for (const r of topIntentRows) {
    const arr = topIntentsByCluster.get(r.clusterId!) ?? [];
    if (arr.length >= 5) continue;
    arr.push({ intent: r.intent, turn_count: r.turnCount });
    topIntentsByCluster.set(r.clusterId!, arr);
  }

  return clusters.map((c) => {
    const core = coreByCluster.get(c.id);
    const toolStats = toolCallStatsByCluster.get(c.id);
    const sentimentAvg = core?.sentimentAvg ?? 0;
    // Don't attribute a failure cause to a positive-sentiment cluster. A
    // happy cluster sharing some conversations with a failing tool is
    // coincidence, not causation.
    const attributedCause =
      sentimentAvg < 0 ? (attributedCauseByCluster.get(c.id) ?? null) : null;
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
      attributed_cause: attributedCause,
      avg_latency_ms: toolStats?.avg_latency_ms ?? 0,
      top_intents: topIntentsByCluster.get(c.id) ?? [],
      example_conversation_ids: examplesByCluster.get(c.id) ?? [],
      sample_messages: sampleMessagesByCluster.get(c.id) ?? [],
    };
  });
}
