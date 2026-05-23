// /v1/clusters — backs the Clusters view. Returns every cluster plus every
// intent (including noise) so the scatter can render all points and the list
// can show member intents. Includes "has insight?" flag so the UI can show
// which clusters did/didn't surface as actionable problems.

import { desc, inArray, isNotNull, sql } from "drizzle-orm";

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
  const sampleIntentsRows = await db.execute<{
    cluster_id: string;
    intent: string;
    rn: number;
  }>(sql`
    SELECT cluster_id, intent, rn FROM (
      SELECT
        cluster_id,
        intent,
        row_number() OVER (PARTITION BY cluster_id ORDER BY intent) AS rn
      FROM ${schema.intents}
      WHERE cluster_id IS NOT NULL
    ) sub
    WHERE rn <= ${SAMPLES_PER_CLUSTER}
  `);
  const sampleIntentsByCluster = new Map<string, string[]>();
  for (const r of sampleIntentsRows) {
    const arr = sampleIntentsByCluster.get(r.cluster_id) ?? [];
    arr.push(r.intent);
    sampleIntentsByCluster.set(r.cluster_id, arr);
  }

  // 5. Sample user messages per cluster — one per intent, random across the
  // cluster, capped at SAMPLES_PER_CLUSTER total to keep payload small.
  const sampleMessagesRows = await db.execute<{
    cluster_id: string;
    content: string;
    rn: number;
  }>(sql`
    SELECT cluster_id, content, rn FROM (
      SELECT
        i.cluster_id,
        t.content,
        row_number() OVER (PARTITION BY i.cluster_id ORDER BY random()) AS rn
      FROM ${schema.intents} i
      JOIN ${schema.turnSignals} s ON s.intent = i.intent
      JOIN ${schema.turns} t ON t.id = s.turn_id
      WHERE i.cluster_id IS NOT NULL
    ) sub
    WHERE rn <= ${SAMPLES_PER_CLUSTER}
  `);
  const sampleMessagesByCluster = new Map<string, string[]>();
  for (const r of sampleMessagesRows) {
    const arr = sampleMessagesByCluster.get(r.cluster_id) ?? [];
    arr.push(r.content);
    sampleMessagesByCluster.set(r.cluster_id, arr);
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
