// DB queries for the insights API. Typed Drizzle throughout — no raw SQL.

import { and, arrayContains, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import { db, schema } from "../../db/client.ts";
import { isFailedToolStatus, toolsForIntents } from "../../insights/tool-relevance.ts";
import { type OutcomePartition, partitionConversation } from "../../insights/typology.ts";
import type { ListInsightsQuery, SortOption } from "./schema.ts";

const UNCATEGORIZED_TAG = "uncategorized";

// Single source of truth for the joined insight shape returned by the list/get
// endpoints. cluster_label is joined in from the clusters table.
export type InsightWithLabel = {
  id: string;
  cluster_id: string;
  cluster_label: string;
  partition: string;
  tags: string[];
  taxonomy_version: number;
  headline: string;
  recommendation: string;
  key_observation: string | null;
  volume_pct: number;
  conversation_count: number;
  sentiment_avg: number;
  weekly_volume: number[];
  attributed_cause: { tool: string; failure_rate: number } | null;
  marker_distribution: Record<string, number>;
  end_reason_distribution: Record<string, number>;
  example_conversation_ids: string[];
  generated_at: string;
};

function sortClause(sort: SortOption) {
  switch (sort) {
    case "volume_desc":
      return desc(schema.insights.volumePct);
    case "volume_asc":
      return asc(schema.insights.volumePct);
    case "sentiment_asc":
      return asc(schema.insights.sentimentAvg);
    case "recent":
      return desc(schema.insights.generatedAt);
  }
}

function buildWhere(q: ListInsightsQuery) {
  const conditions = [];
  if (q.tag.length > 0) {
    // AND semantics: row's tags array must contain ALL specified tags.
    conditions.push(arrayContains(schema.insights.tags, q.tag));
  }
  if (q.min_volume_pct !== undefined) {
    conditions.push(gte(schema.insights.volumePct, q.min_volume_pct));
  }
  if (q.min_conversation_count !== undefined) {
    conditions.push(gte(schema.insights.conversationCount, q.min_conversation_count));
  }
  if (!q.include_uncategorized) {
    // Exclude rows tagged with "uncategorized".
    conditions.push(sql`NOT (${UNCATEGORIZED_TAG} = ANY(${schema.insights.tags}))`);
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listInsights(
  q: ListInsightsQuery,
): Promise<{ insights: InsightWithLabel[]; total: number; taxonomy_version: number | null }> {
  const where = buildWhere(q);

  const rows = await db
    .select({
      id: schema.insights.id,
      clusterId: schema.insights.clusterId,
      clusterLabel: schema.clusters.label,
      partition: schema.insights.partition,
      tags: schema.insights.tags,
      taxonomyVersion: schema.insights.taxonomyVersion,
      headline: schema.insights.headline,
      recommendation: schema.insights.recommendation,
      keyObservation: schema.insights.keyObservation,
      volumePct: schema.insights.volumePct,
      conversationCount: schema.insights.conversationCount,
      sentimentAvg: schema.insights.sentimentAvg,
      weeklyVolume: schema.insights.weeklyVolume,
      attributedCause: schema.insights.attributedCause,
      markerDistribution: schema.insights.markerDistribution,
      endReasonDistribution: schema.insights.endReasonDistribution,
      exampleConversationIds: schema.insights.exampleConversationIds,
      generatedAt: schema.insights.generatedAt,
    })
    .from(schema.insights)
    .innerJoin(schema.clusters, eq(schema.clusters.id, schema.insights.clusterId))
    .where(where)
    .orderBy(sortClause(q.sort))
    .limit(q.limit)
    .offset(q.offset);

  // Total count under the same filter (without limit/offset).
  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.insights)
    .where(where);

  // taxonomy_version is consistent across a given generation run; pull from any
  // row. If no rows, null.
  const anyVersionRow = await db
    .select({ v: schema.insights.taxonomyVersion })
    .from(schema.insights)
    .limit(1);

  return {
    insights: rows.map(toInsightWithLabel),
    total: totalRows[0]?.count ?? 0,
    taxonomy_version: anyVersionRow[0]?.v ?? null,
  };
}

export async function getInsightById(id: string): Promise<InsightWithLabel | null> {
  const rows = await db
    .select({
      id: schema.insights.id,
      clusterId: schema.insights.clusterId,
      clusterLabel: schema.clusters.label,
      partition: schema.insights.partition,
      tags: schema.insights.tags,
      taxonomyVersion: schema.insights.taxonomyVersion,
      headline: schema.insights.headline,
      recommendation: schema.insights.recommendation,
      keyObservation: schema.insights.keyObservation,
      volumePct: schema.insights.volumePct,
      conversationCount: schema.insights.conversationCount,
      sentimentAvg: schema.insights.sentimentAvg,
      weeklyVolume: schema.insights.weeklyVolume,
      attributedCause: schema.insights.attributedCause,
      markerDistribution: schema.insights.markerDistribution,
      endReasonDistribution: schema.insights.endReasonDistribution,
      exampleConversationIds: schema.insights.exampleConversationIds,
      generatedAt: schema.insights.generatedAt,
    })
    .from(schema.insights)
    .innerJoin(schema.clusters, eq(schema.clusters.id, schema.insights.clusterId))
    .where(eq(schema.insights.id, id))
    .limit(1);

  return rows[0] ? toInsightWithLabel(rows[0]) : null;
}

function toInsightWithLabel(row: {
  id: string;
  clusterId: string;
  clusterLabel: string;
  partition: string;
  tags: string[];
  taxonomyVersion: number;
  headline: string;
  recommendation: string;
  keyObservation: string | null;
  volumePct: number;
  conversationCount: number;
  sentimentAvg: number;
  weeklyVolume: number[];
  attributedCause: { tool: string; failure_rate: number } | null;
  markerDistribution: Record<string, number>;
  endReasonDistribution: Record<string, number>;
  exampleConversationIds: string[];
  generatedAt: Date;
}): InsightWithLabel {
  return {
    id: row.id,
    cluster_id: row.clusterId,
    cluster_label: row.clusterLabel,
    partition: row.partition,
    tags: row.tags,
    taxonomy_version: row.taxonomyVersion,
    headline: row.headline,
    recommendation: row.recommendation,
    key_observation: row.keyObservation,
    volume_pct: row.volumePct,
    conversation_count: row.conversationCount,
    sentiment_avg: row.sentimentAvg,
    weekly_volume: row.weeklyVolume,
    attributed_cause: row.attributedCause,
    marker_distribution: row.markerDistribution,
    end_reason_distribution: row.endReasonDistribution,
    example_conversation_ids: row.exampleConversationIds,
    generated_at: row.generatedAt.toISOString(),
  };
}

// Eval-set: paginated list of conversations that contributed to this insight.
// "Contributed" = at least one user turn maps to an intent in the insight's
// cluster. Ordered started_at desc so paginated iteration is stable and
// "recent first" is the natural default.

export type EvalSetConversation = {
  conversation_id: string;
  agent_id: string;
  started_at: string;
  ended_at: string;
  end_reason: string;
  turns: Array<{
    turn_id: string;
    role: string;
    content: string;
    timestamp: string;
    tool_calls: Array<{
      tool_call_id: string;
      tool_name: string;
      input_summary: string;
      status: string;
      output: string;
      latency_ms: number;
      timestamp: string;
    }>;
  }>;
};

export async function getEvalSet(
  insightId: string,
  limit: number,
  offset: number,
): Promise<{
  insight: InsightWithLabel;
  total: number;
  conversations: EvalSetConversation[];
} | null> {
  const insight = await getInsightById(insightId);
  if (!insight) return null;

  // Conversations whose user turns map to an intent in this insight's cluster
  // AND whose outcome partition matches the insight's partition. Partition is
  // not stored — it's computed from the same deterministic function the
  // pipeline uses, so this re-derives it on the fly. See typology.partitionConversation.
  const candidateConvs = await db
    .selectDistinct({
      conversationId: schema.turns.conversationId,
      endReason: schema.conversations.endReason,
      startedAt: schema.conversations.startedAt,
    })
    .from(schema.intents)
    .innerJoin(schema.turnSignals, eq(schema.turnSignals.intent, schema.intents.intent))
    .innerJoin(schema.turns, eq(schema.turns.id, schema.turnSignals.turnId))
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.turns.conversationId))
    .where(eq(schema.intents.clusterId, insight.cluster_id));

  if (candidateConvs.length === 0) {
    return { insight, total: 0, conversations: [] };
  }

  const candidateIds = candidateConvs.map((r) => r.conversationId);

  // Sentiment per (cluster, conversation) — same as aggregate.ts derivation.
  const sentRows = await db
    .select({
      conversationId: schema.turns.conversationId,
      sentiment: schema.turnSignals.sentiment,
    })
    .from(schema.intents)
    .innerJoin(schema.turnSignals, eq(schema.turnSignals.intent, schema.intents.intent))
    .innerJoin(schema.turns, eq(schema.turns.id, schema.turnSignals.turnId))
    .where(
      and(
        eq(schema.intents.clusterId, insight.cluster_id),
        inArray(schema.turns.conversationId, candidateIds),
      ),
    );
  const sentByConv = new Map<string, { sum: number; n: number }>();
  for (const r of sentRows) {
    const e = sentByConv.get(r.conversationId) ?? { sum: 0, n: 0 };
    e.sum += r.sentiment;
    e.n += 1;
    sentByConv.set(r.conversationId, e);
  }

  // Whether any topically relevant tool call in the conversation failed.
  // This must match aggregate.ts, otherwise the detail/eval-set page can show
  // a different partition population than the persisted insight row.
  const intentTurnCount = sql<number>`count(${schema.turnSignals.turnId})::int`;
  const topIntentRows = await db
    .select({
      intent: schema.intents.intent,
      turnCount: intentTurnCount,
    })
    .from(schema.intents)
    .innerJoin(schema.turnSignals, eq(schema.turnSignals.intent, schema.intents.intent))
    .where(eq(schema.intents.clusterId, insight.cluster_id))
    .groupBy(schema.intents.intent)
    .orderBy(desc(intentTurnCount), asc(schema.intents.intent))
    .limit(5);
  const relevantTools = toolsForIntents(topIntentRows.map((r) => r.intent));

  const failRows = await db
    .select({
      conversationId: schema.turns.conversationId,
      toolName: schema.toolCalls.toolName,
      status: schema.toolCalls.status,
    })
    .from(schema.turns)
    .innerJoin(schema.toolCalls, eq(schema.toolCalls.turnId, schema.turns.id))
    .where(inArray(schema.turns.conversationId, candidateIds));
  const failByConv = new Map<string, boolean>();
  for (const r of failRows) {
    const relevant = relevantTools === null || relevantTools.has(r.toolName);
    if (relevant && isFailedToolStatus(r.status)) {
      failByConv.set(r.conversationId, true);
    } else if (!failByConv.has(r.conversationId)) {
      failByConv.set(r.conversationId, false);
    }
  }

  // Filter to this partition.
  const targetPartition = insight.partition as OutcomePartition;
  const matchingConvs = candidateConvs.filter((c) => {
    const sent = sentByConv.get(c.conversationId);
    const sentimentAvg = sent && sent.n > 0 ? sent.sum / sent.n : 0;
    const partition = partitionConversation({
      end_reason: c.endReason,
      sentiment_avg: sentimentAvg,
      any_tool_failed: failByConv.get(c.conversationId) ?? false,
    });
    return partition === targetPartition;
  });

  matchingConvs.sort((a, b) => (b.startedAt.getTime() - a.startedAt.getTime()));
  const total = matchingConvs.length;
  const page = matchingConvs.slice(offset, offset + limit);

  if (page.length === 0) {
    return { insight, total, conversations: [] };
  }

  const conversations = await loadFullConversations(page.map((r) => r.conversationId));
  return { insight, total, conversations };
}

async function loadFullConversations(convIds: string[]): Promise<EvalSetConversation[]> {
  if (convIds.length === 0) return [];

  const convRows = await db
    .select()
    .from(schema.conversations)
    .where(inArray(schema.conversations.id, convIds));

  const turnRows = await db
    .select()
    .from(schema.turns)
    .where(inArray(schema.turns.conversationId, convIds))
    .orderBy(schema.turns.conversationId, schema.turns.turnIndex);

  const turnIds = turnRows.map((t) => t.id);
  const toolCallRows = turnIds.length > 0
    ? await db
        .select()
        .from(schema.toolCalls)
        .where(inArray(schema.toolCalls.turnId, turnIds))
        .orderBy(schema.toolCalls.turnId, schema.toolCalls.toolCallIndex)
    : [];

  const toolCallsByTurn = new Map<string, typeof toolCallRows>();
  for (const tc of toolCallRows) {
    const arr = toolCallsByTurn.get(tc.turnId) ?? [];
    arr.push(tc);
    toolCallsByTurn.set(tc.turnId, arr);
  }

  const turnsByConv = new Map<string, typeof turnRows>();
  for (const t of turnRows) {
    const arr = turnsByConv.get(t.conversationId) ?? [];
    arr.push(t);
    turnsByConv.set(t.conversationId, arr);
  }

  // Preserve input order (which is sort-by-recent from getEvalSet).
  const byId = new Map(convRows.map((c) => [c.id, c]));
  return convIds
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .map((c) => {
      const turns = (turnsByConv.get(c.id) ?? []).map((t) => {
        // Strip composite-prefix back to the original local id ("t1") for cleanliness.
        const localTurnId = t.id.slice(c.id.length + 1);
        return {
          turn_id: localTurnId,
          role: t.role,
          content: t.content,
          timestamp: t.timestamp.toISOString(),
          tool_calls: (toolCallsByTurn.get(t.id) ?? []).map((tc) => ({
            tool_call_id: tc.id.slice(t.id.length + 1),
            tool_name: tc.toolName,
            input_summary: tc.inputSummary,
            status: tc.status,
            output: tc.output,
            latency_ms: tc.latencyMs,
            timestamp: tc.timestamp.toISOString(),
          })),
        };
      });
      return {
        conversation_id: c.id,
        agent_id: c.agentId,
        started_at: c.startedAt.toISOString(),
        ended_at: c.endedAt.toISOString(),
        end_reason: c.endReason,
        turns,
      };
    });
}
