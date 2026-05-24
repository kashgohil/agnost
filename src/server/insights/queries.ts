import { and, arrayContains, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { db, schema } from "../../db/client.ts";
import {
  buildPrecedingUserTurnMap,
  buildTurnClusterMap,
  isFailedToolStatus,
} from "../../insights/proximity.ts";
import { type OutcomePartition, partitionConversation } from "../../insights/typology.ts";
import type { ListInsightsQuery, SortOption } from "./schema.ts";

const UNCATEGORIZED_TAG = "uncategorized";

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

  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.insights)
    .where(where);

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

  // Re-derive partition per candidate conversation using the same rule the
  // pipeline uses, so eval-set count agrees with the headline count.
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

  const candidateTurns = await db
    .select({
      id: schema.turns.id,
      conversationId: schema.turns.conversationId,
      turnIndex: schema.turns.turnIndex,
      role: schema.turns.role,
    })
    .from(schema.turns)
    .where(inArray(schema.turns.conversationId, candidateIds));

  const candidateSignals = await db
    .select({ turnId: schema.turnSignals.turnId, intent: schema.turnSignals.intent })
    .from(schema.turnSignals)
    .innerJoin(schema.turns, eq(schema.turns.id, schema.turnSignals.turnId))
    .where(inArray(schema.turns.conversationId, candidateIds));

  const candidateIntents = await db
    .select({ intent: schema.intents.intent, clusterId: schema.intents.clusterId })
    .from(schema.intents)
    .where(eq(schema.intents.clusterId, insight.cluster_id));

  const precedingUserMap = buildPrecedingUserTurnMap(candidateTurns);
  const turnIntentMap = new Map(candidateSignals.map((s) => [s.turnId, s.intent]));
  const intentClusterMap = new Map(candidateIntents.map((i) => [i.intent, i.clusterId]));
  const turnClusterMap = buildTurnClusterMap(
    precedingUserMap,
    turnIntentMap,
    intentClusterMap,
  );

  const toolCallRows = await db
    .select({
      turnId: schema.toolCalls.turnId,
      status: schema.toolCalls.status,
    })
    .from(schema.toolCalls)
    .innerJoin(schema.turns, eq(schema.turns.id, schema.toolCalls.turnId))
    .where(inArray(schema.turns.conversationId, candidateIds));

  const turnConv = new Map(candidateTurns.map((t) => [t.id, t.conversationId]));
  const failByConv = new Map<string, boolean>();
  for (const tc of toolCallRows) {
    const cluster = turnClusterMap.get(tc.turnId);
    if (cluster !== insight.cluster_id) continue;
    const convId = turnConv.get(tc.turnId);
    if (!convId) continue;
    if (isFailedToolStatus(tc.status)) failByConv.set(convId, true);
    else if (!failByConv.has(convId)) failByConv.set(convId, false);
  }

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

  matchingConvs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
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

  const byId = new Map(convRows.map((c) => [c.id, c]));
  return convIds
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .map((c) => {
      const turns = (turnsByConv.get(c.id) ?? []).map((t) => {
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
