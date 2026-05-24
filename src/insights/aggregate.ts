// Compute per (cluster, partition) metrics from the DB.
//
// The unit of an insight is one (cluster, partition) pair, not a cluster.
// A cluster is a topic group (refund-related conversations). A partition is
// a deterministic outcome bucket (succeeded / failed_at_tool / dropped_off /
// escalated / agent_gave_up / unresolved). One cluster can produce multiple
// insights — one per partition that has enough volume.
//
// All queries are typed Drizzle. Aggregation happens in Node memory rather
// than as one big GROUP BY in SQL: easier to evolve, sufficient for current
// scale, see REASONING.md trade for the switch-point.

import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db, schema } from "../db/client.ts";
import { pickStableShuffled } from "../lib/sampling.ts";
import {
  type ClusterMetrics,
  type OutcomePartition,
  partitionConversation,
} from "./typology.ts";
import { isFailedToolStatus, toolsForIntents } from "./tool-relevance.ts";

// Inlined preview examples on the insight row — enough to show phrasing
// variety, few enough to keep the list endpoint snappy. Engineers wanting more
// hit /v1/insights/:id/eval-set, which paginates the full set.
const EXAMPLES_PER_PARTITION = 3;
const SAMPLE_MESSAGES_PER_PARTITION = 8;

// Attribution thresholds — when to claim a tool is the cause of a partition's
// failures. Applied per (cluster, partition), so the failure rate is computed
// within the partition's conversations, not across the whole cluster.
const MIN_CALLS = 5;
const MIN_FAILURE_RATE = 0.5;

type Key = string; // "cluster_id::partition"
const key = (clusterId: string, partition: OutcomePartition): Key =>
  `${clusterId}::${partition}`;

function isFailed(status: string): boolean {
  return isFailedToolStatus(status);
}

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

  // 1. PER-CONVERSATION FACTS
  //    For every (cluster, conversation) pair, gather the facts needed to
  //    partition that conversation. We compute the partition once and key
  //    everything else off it.
  type ConvFacts = {
    clusterId: string;
    conversationId: string;
    endReason: string;
    startedAt: Date;
    sentimentAvg: number;        // avg over user-turn signals in cluster
    isRepeatRate: number;        // avg of is_repeat flags in cluster
    turnCountInCluster: number;  // number of user turns in this cluster
    anyRelevantToolFailed: boolean;
    anyToolFailed: boolean;
    toolCallCount: number;
    toolLatencySum: number;      // for avg latency per conversation
    partition: OutcomePartition; // derived
  };

  // Per-conversation aggregates of signals attached to turns whose intent is
  // in some cluster. selectDistinct already deduplicates the join product;
  // we still group again in TS for safety + readability.
  const signalRows = await db
    .select({
      clusterId: schema.intents.clusterId,
      conversationId: schema.turns.conversationId,
      sentiment: schema.turnSignals.sentiment,
      isRepeat: schema.turnSignals.isRepeat,
    })
    .from(schema.intents)
    .innerJoin(schema.turnSignals, eq(schema.turnSignals.intent, schema.intents.intent))
    .innerJoin(schema.turns, eq(schema.turns.id, schema.turnSignals.turnId))
    .where(isNotNull(schema.intents.clusterId));

  // conv-level metadata (end_reason, started_at)
  const convMetaRows = await db
    .select({
      id: schema.conversations.id,
      endReason: schema.conversations.endReason,
      startedAt: schema.conversations.startedAt,
    })
    .from(schema.conversations);
  const convMeta = new Map(convMetaRows.map((r) => [r.id, r]));

  // Dominant intents per cluster. Used twice:
  //   1. grounding content generation
  //   2. deciding which tools are relevant to a cluster for attribution
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
  const relevantToolsByCluster = new Map<string, Set<string> | null>();
  for (const c of clusters) {
    relevantToolsByCluster.set(
      c.id,
      toolsForIntents((topIntentsByCluster.get(c.id) ?? []).map((i) => i.intent)),
    );
  }

  // For each (cluster, conversation), gather all tool calls in that
  // conversation. Tool calls are per-conversation, not per-cluster — a
  // conversation either had a tool fail or didn't, regardless of cluster.
  // We still need the cluster axis to attach the conversation's tool outcomes
  // to the right cluster bucket.
  const conversationTurns = alias(schema.turns, "conversation_turns");
  const toolCallRows = await db
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
    .innerJoin(
      conversationTurns,
      eq(conversationTurns.conversationId, schema.turns.conversationId),
    )
    .innerJoin(schema.toolCalls, eq(schema.toolCalls.turnId, conversationTurns.id))
    .where(isNotNull(schema.intents.clusterId));

  // Assemble per-(cluster, conversation) facts.
  const facts = new Map<Key, ConvFacts>();
  for (const r of signalRows) {
    const cluster = r.clusterId!;
    const k = `${cluster}::${r.conversationId}`;
    const meta = convMeta.get(r.conversationId);
    if (!meta) continue;
    let f = facts.get(k);
    if (!f) {
      f = {
        clusterId: cluster,
        conversationId: r.conversationId,
        endReason: meta.endReason,
        startedAt: meta.startedAt,
        sentimentAvg: 0,
        isRepeatRate: 0,
        turnCountInCluster: 0,
        anyRelevantToolFailed: false,
        anyToolFailed: false,
        toolCallCount: 0,
        toolLatencySum: 0,
        partition: "unresolved",
      };
      facts.set(k, f);
    }
    // accumulate sentiment + is_repeat
    const n = f.turnCountInCluster;
    f.sentimentAvg = (f.sentimentAvg * n + r.sentiment) / (n + 1);
    f.isRepeatRate = (f.isRepeatRate * n + (r.isRepeat ? 1 : 0)) / (n + 1);
    f.turnCountInCluster = n + 1;
  }

  for (const r of toolCallRows) {
    const k = `${r.clusterId!}::${r.conversationId}`;
    const f = facts.get(k);
    if (!f) continue;
    f.toolCallCount += 1;
    f.toolLatencySum += r.latencyMs;
    const failed = isFailed(r.status);
    if (failed) {
      f.anyToolFailed = true;
      const relevantTools = relevantToolsByCluster.get(r.clusterId!);
      if (relevantTools === null || relevantTools?.has(r.toolName)) {
        f.anyRelevantToolFailed = true;
      }
    }
  }

  // 2. ASSIGN PARTITION per (cluster, conversation)
  for (const f of facts.values()) {
    f.partition = partitionConversation({
      end_reason: f.endReason,
      sentiment_avg: f.sentimentAvg,
      any_tool_failed: f.anyRelevantToolFailed,
    });
  }

  // 3. AGGREGATE BY (cluster, partition)
  type Acc = {
    conversationIds: Set<string>;
    sentimentSum: number;
    isRepeatSum: number;
    turnSum: number;
    weeklyVolume: Map<string, Set<string>>; // week -> conversation_ids
    endReasonCounts: Map<string, number>;
    toolCallCountSum: number;
    toolLatencySum: number;
    convsWithToolCallsCount: number;
  };
  const accs = new Map<Key, Acc>();
  for (const f of facts.values()) {
    const k = key(f.clusterId, f.partition);
    let a = accs.get(k);
    if (!a) {
      a = {
        conversationIds: new Set(),
        sentimentSum: 0,
        isRepeatSum: 0,
        turnSum: 0,
        weeklyVolume: new Map(),
        endReasonCounts: new Map(),
        toolCallCountSum: 0,
        toolLatencySum: 0,
        convsWithToolCallsCount: 0,
      };
      accs.set(k, a);
    }
    a.conversationIds.add(f.conversationId);
    a.sentimentSum += f.sentimentAvg * f.turnCountInCluster;
    a.isRepeatSum += f.isRepeatRate * f.turnCountInCluster;
    a.turnSum += f.turnCountInCluster;
    const week = isoWeek(f.startedAt);
    let ws = a.weeklyVolume.get(week);
    if (!ws) {
      ws = new Set();
      a.weeklyVolume.set(week, ws);
    }
    ws.add(f.conversationId);
    a.endReasonCounts.set(
      f.endReason,
      (a.endReasonCounts.get(f.endReason) ?? 0) + 1,
    );
    a.toolCallCountSum += f.toolCallCount;
    if (f.toolCallCount > 0) {
      a.toolLatencySum += f.toolLatencySum / f.toolCallCount;
      a.convsWithToolCallsCount += 1;
    }
  }

  // Pre-compute the universe of weeks so weekly_volume arrays are aligned.
  const allWeeks = Array.from(
    new Set(Array.from(facts.values()).map((f) => isoWeek(f.startedAt))),
  ).sort();

  // 4. ATTRIBUTED CAUSE per (cluster, partition).
  //    Filter tool calls to those whose conversation is in this partition,
  //    then find the dominant failing tool.
  const conversationPartition = new Map<string, OutcomePartition>(); // conversation_id -> partition (within the same cluster)
  for (const f of facts.values()) {
    conversationPartition.set(`${f.clusterId}::${f.conversationId}`, f.partition);
  }
  type ToolAcc = { calls: number; failed: number };
  const toolAccs = new Map<Key, Map<string, ToolAcc>>(); // (cluster, partition) -> tool -> stats
  for (const r of toolCallRows) {
    const cluster = r.clusterId!;
    const partition = conversationPartition.get(`${cluster}::${r.conversationId}`);
    if (!partition) continue;
    const relevantTools = relevantToolsByCluster.get(cluster);
    if (relevantTools !== null && !relevantTools?.has(r.toolName)) continue;
    const k = key(cluster, partition);
    let byTool = toolAccs.get(k);
    if (!byTool) {
      byTool = new Map();
      toolAccs.set(k, byTool);
    }
    const ta = byTool.get(r.toolName) ?? { calls: 0, failed: 0 };
    ta.calls += 1;
    if (isFailed(r.status)) ta.failed += 1;
    byTool.set(r.toolName, ta);
  }
  const attribCause = new Map<Key, { tool: string; failure_rate: number }>();
  for (const [k, byTool] of toolAccs) {
    const candidates = Array.from(byTool.entries())
      .filter(([, ta]) => ta.calls >= MIN_CALLS)
      .map(([tool, ta]) => ({ tool, failure_rate: ta.failed / ta.calls }))
      .filter((c) => c.failure_rate >= MIN_FAILURE_RATE)
      .sort((a, b) => b.failure_rate - a.failure_rate);
    if (candidates.length > 0) attribCause.set(k, candidates[0]!);
  }

  // 5. FRUSTRATION MARKER DISTRIBUTION per (cluster, partition).
  //    Pull markers joined with cluster + conversation, filter to partition.
  const markerRows = await db.execute<{
    cluster_id: string;
    conversation_id: string;
    marker: string;
  }>(sql`
    SELECT i.cluster_id, t.conversation_id, marker
    FROM ${schema.intents} i
    JOIN ${schema.turnSignals} s ON s.intent = i.intent
    JOIN ${schema.turns} t ON t.id = s.turn_id
    CROSS JOIN LATERAL unnest(s.frustration_markers) AS marker
    WHERE i.cluster_id IS NOT NULL
  `);
  type MarkerAcc = { counts: Map<string, number>; totalTurns: number };
  const markerAccs = new Map<Key, MarkerAcc>();
  for (const r of markerRows) {
    const partition = conversationPartition.get(`${r.cluster_id}::${r.conversation_id}`);
    if (!partition) continue;
    const k = key(r.cluster_id, partition);
    let ma = markerAccs.get(k);
    if (!ma) {
      ma = { counts: new Map(), totalTurns: 0 };
      markerAccs.set(k, ma);
    }
    ma.counts.set(r.marker, (ma.counts.get(r.marker) ?? 0) + 1);
  }
  // turn count denominator: number of user turns in this (cluster, partition)
  for (const f of facts.values()) {
    const ma = markerAccs.get(key(f.clusterId, f.partition));
    if (ma) ma.totalTurns += f.turnCountInCluster;
  }

  // 6. EXAMPLES + SAMPLE MESSAGES per (cluster, partition).
  // Use the existing per-conversation grouping; sample stably.
  const exampleRowsByKey = new Map<Key, Array<{ key: string; value: string }>>();
  for (const f of facts.values()) {
    const k = key(f.clusterId, f.partition);
    let arr = exampleRowsByKey.get(k);
    if (!arr) {
      arr = [];
      exampleRowsByKey.set(k, arr);
    }
    arr.push({ key: k, value: f.conversationId });
  }
  const examplesByKey = new Map<Key, string[]>();
  for (const [k, rows] of exampleRowsByKey) {
    const picked = pickStableShuffled(rows, EXAMPLES_PER_PARTITION);
    examplesByKey.set(k, picked.get(k) ?? []);
  }

  // Sample user messages — pull them once, then bucket by (cluster, partition).
  const sampleMsgRows = await db
    .select({
      clusterId: schema.intents.clusterId,
      conversationId: schema.turns.conversationId,
      content: schema.turns.content,
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
  const sampleSeed: Array<{ key: Key; value: string }> = [];
  for (const r of sampleMsgRows) {
    const partition = conversationPartition.get(`${r.clusterId!}::${r.conversationId}`);
    if (!partition) continue;
    sampleSeed.push({ key: key(r.clusterId!, partition), value: r.content });
  }
  const sampleByKey = pickStableShuffled(sampleSeed, SAMPLE_MESSAGES_PER_PARTITION);

  // 7. EMIT ClusterMetrics — one per (cluster, partition).
  const clusterById = new Map(clusters.map((c) => [c.id, c]));
  const result: ClusterMetrics[] = [];
  for (const [k, a] of accs) {
    const [clusterId, partition] = k.split("::") as [string, OutcomePartition];
    const cluster = clusterById.get(clusterId);
    if (!cluster) continue;

    const conversationCount = a.conversationIds.size;
    const sentimentAvg = a.turnSum > 0 ? a.sentimentSum / a.turnSum : 0;
    const isRepeatRate = a.turnSum > 0 ? a.isRepeatSum / a.turnSum : 0;
    const weeklyVolume = allWeeks.map((w) => a.weeklyVolume.get(w)?.size ?? 0);

    const endReasonDist: Record<string, number> = {};
    const totalConv = Array.from(a.endReasonCounts.values()).reduce((s, v) => s + v, 0);
    for (const [er, n] of a.endReasonCounts) {
      endReasonDist[er] = totalConv > 0 ? n / totalConv : 0;
    }

    const markerDist: Record<string, number> = {};
    const ma = markerAccs.get(k);
    if (ma) {
      const denom = ma.totalTurns || 1;
      for (const [m, n] of ma.counts) markerDist[m] = n / denom;
    }

    // attributed cause suppressed for positive-sentiment partitions —
    // a "succeeded" partition with an incidentally-failing tool is coincidence.
    const sentimentSuppressesAttribution = sentimentAvg >= 0;
    const attributedCause = sentimentSuppressesAttribution
      ? null
      : (attribCause.get(k) ?? null);

    result.push({
      cluster_id: clusterId,
      cluster_label: cluster.label,
      partition,
      conversation_count: conversationCount,
      total_conversations: totalConversations,
      volume_pct: totalConversations > 0 ? conversationCount / totalConversations : 0,
      sentiment_avg: sentimentAvg,
      weekly_volume: weeklyVolume,
      avg_tool_calls_per_conv:
        a.conversationIds.size > 0 ? a.toolCallCountSum / a.conversationIds.size : 0,
      is_repeat_rate: isRepeatRate,
      end_reason_distribution: endReasonDist,
      marker_distribution: markerDist,
      attributed_cause: attributedCause,
      avg_latency_ms:
        a.convsWithToolCallsCount > 0 ? a.toolLatencySum / a.convsWithToolCallsCount : 0,
      top_intents: topIntentsByCluster.get(clusterId) ?? [],
      example_conversation_ids: examplesByKey.get(k) ?? [],
      sample_messages: sampleByKey.get(k) ?? [],
    });
  }

  return result.sort((a, b) =>
    a.cluster_id === b.cluster_id
      ? a.partition.localeCompare(b.partition)
      : a.cluster_id.localeCompare(b.cluster_id),
  );
}

function isoWeek(d: Date): string {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
