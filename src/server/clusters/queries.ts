// /v1/clusters — backs the Clusters view. Returns every cluster plus every
// intent (including noise) so the scatter can render all points and the list
// can show member intents. Includes "has insight?" flag so the UI can show
// which clusters did/didn't surface as actionable problems.

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
  insight_id: string | null;
  insight_tags: string[] | null;
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
  // 1. All intents with positions (positions are set for both clustered + noise).
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

  // 2. Clusters with member counts (denorm column on clusters table).
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

  // 3. For each cluster, look up its insight (if any) to surface "actionable?".
  const insightRows = await db
    .select({
      clusterId: schema.insights.clusterId,
      insightId: schema.insights.id,
      tags: schema.insights.tags,
    })
    .from(schema.insights)
    .where(inArray(schema.insights.clusterId, clusterIds));
  const insightByCluster = new Map(insightRows.map((r) => [r.clusterId, r]));

  // 4. Sample intents per cluster — first N alphabetically (stable across runs).
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

  // 5. Sample user messages per cluster. Stable ordering keeps the endpoint
  // deterministic; the cap is applied in TS to avoid raw window-function SQL.
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

  const clusters: ClusterRow[] = clusterRows.map((c) => {
    const ins = insightByCluster.get(c.id);
    return {
      id: c.id,
      label: c.label,
      member_count: c.memberCount,
      insight_id: ins?.insightId ?? null,
      insight_tags: ins?.tags ?? null,
      sample_intents: sampleIntentsByCluster.get(c.id) ?? [],
      sample_messages: sampleMessagesByCluster.get(c.id) ?? [],
    };
  });

  return { clusters, intents };
}
