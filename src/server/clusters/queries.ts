import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { db, schema } from "../../db/client.ts";

export type ClustersResponse = {
  clusters: ClusterRow[];
  intents: IntentRow[];
};

export type ClusterRow = {
  id: string;
  label: string;
  member_count: number;
  insights: Array<{ id: string; partition: string; tags: string[] }>;
  sample_intents: string[];
  sample_messages: string[];
};

export type IntentRow = {
  intent: string;
  cluster_id: string | null;
  probability: number | null;
  position_x: number;
  position_y: number;
};

const SAMPLES_PER_CLUSTER = 4;

export async function getClustersOverview(): Promise<ClustersResponse> {
  const intentRows = await db
    .select({
      intent: schema.intents.intent,
      clusterId: schema.intents.clusterId,
      probability: schema.intents.probability,
      positionX: schema.intents.positionX,
      positionY: schema.intents.positionY,
    })
    .from(schema.intents)
    .where(isNotNull(schema.intents.positionX));

  const intents: IntentRow[] = intentRows.map((r) => ({
    intent: r.intent,
    cluster_id: r.clusterId,
    probability: r.probability,
    position_x: r.positionX!,
    position_y: r.positionY!,
  }));

  const clusterRows = await db
    .select({
      id: schema.clusters.id,
      label: schema.clusters.label,
      memberCount: schema.clusters.memberCount,
    })
    .from(schema.clusters)
    .orderBy(desc(schema.clusters.memberCount));

  if (clusterRows.length === 0) {
    return { clusters: [], intents };
  }

  const clusterIds = clusterRows.map((c) => c.id);

  const insightRows = await db
    .select({
      clusterId: schema.insights.clusterId,
      insightId: schema.insights.id,
      partition: schema.insights.partition,
      tags: schema.insights.tags,
    })
    .from(schema.insights)
    .where(inArray(schema.insights.clusterId, clusterIds))
    .orderBy(asc(schema.insights.clusterId), asc(schema.insights.partition));
  const insightsByCluster = new Map<
    string,
    Array<{ id: string; partition: string; tags: string[] }>
  >();
  for (const r of insightRows) {
    const arr = insightsByCluster.get(r.clusterId) ?? [];
    arr.push({ id: r.insightId, partition: r.partition, tags: r.tags });
    insightsByCluster.set(r.clusterId, arr);
  }

  const sampleIntentsRows = await db
    .select({
      clusterId: schema.intents.clusterId,
      intent: schema.intents.intent,
    })
    .from(schema.intents)
    .where(isNotNull(schema.intents.clusterId))
    .orderBy(asc(schema.intents.clusterId), asc(schema.intents.intent));
  const sampleIntentsByCluster = new Map<string, string[]>();
  for (const r of sampleIntentsRows) {
    const arr = sampleIntentsByCluster.get(r.clusterId!) ?? [];
    if (arr.length >= SAMPLES_PER_CLUSTER) continue;
    arr.push(r.intent);
    sampleIntentsByCluster.set(r.clusterId!, arr);
  }

  const sampleMessagesRows = await db
    .select({
      clusterId: schema.intents.clusterId,
      content: schema.turns.content,
      turnIndex: schema.turns.turnIndex,
    })
    .from(schema.intents)
    .innerJoin(schema.turnSignals, eq(schema.turnSignals.intent, schema.intents.intent))
    .innerJoin(schema.turns, eq(schema.turns.id, schema.turnSignals.turnId))
    .where(and(isNotNull(schema.intents.clusterId), eq(schema.turns.role, "user")))
    .orderBy(asc(schema.intents.clusterId), asc(schema.turns.conversationId), asc(schema.turns.turnIndex));
  const sampleMessagesByCluster = new Map<string, string[]>();
  for (const r of sampleMessagesRows) {
    const arr = sampleMessagesByCluster.get(r.clusterId!) ?? [];
    if (arr.length >= SAMPLES_PER_CLUSTER) continue;
    arr.push(r.content);
    sampleMessagesByCluster.set(r.clusterId!, arr);
  }

  const clusters: ClusterRow[] = clusterRows.map((c) => ({
    id: c.id,
    label: c.label,
    member_count: c.memberCount,
    insights: insightsByCluster.get(c.id) ?? [],
    sample_intents: sampleIntentsByCluster.get(c.id) ?? [],
    sample_messages: sampleMessagesByCluster.get(c.id) ?? [],
  }));

  return { clusters, intents };
}
