// Persist cluster assignments + labels to the DB.
//
// Re-clustering semantics: clears any existing clusters/cluster-assignments,
// then writes the new run. Embeddings on `intents` are untouched. Wrap in a
// transaction so partial state is impossible — either the whole new clustering
// is visible, or the old one remains.

import { eq, sql } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import type { IntentClusterAssignment } from "./cluster-driver.ts";

type LabeledCluster = {
  cluster_id: string; // "cluster_0001"
  label: string;
  intents: IntentClusterAssignment[];
};

export async function persistClusters(clusters: LabeledCluster[]): Promise<void> {
  await db.transaction(async (tx) => {
    // Wipe prior cluster state. ON DELETE SET NULL on intents.cluster_id
    // means we don't need a separate update.
    await tx.delete(schema.clusters);

    if (clusters.length === 0) return;

    // Insert the new cluster rows.
    await tx.insert(schema.clusters).values(
      clusters.map((c) => ({
        id: c.cluster_id,
        label: c.label,
        memberCount: c.intents.length,
      })),
    );

    // Update each member intent. Per-row UPDATE because each intent has its
    // own (cluster_id, probability) pair — no clean bulk equivalent in plain SQL.
    for (const c of clusters) {
      for (const i of c.intents) {
        await tx
          .update(schema.intents)
          .set({
            clusterId: c.cluster_id,
            probability: i.probability,
            clusteredAt: sql`now()`,
          })
          .where(eq(schema.intents.intent, i.intent));
      }
    }
  });
}
