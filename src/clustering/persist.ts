// Persist cluster assignments + labels + UMAP positions.
//
// Re-clustering semantics: clears any existing clusters/cluster-assignments,
// then writes the new run. Embeddings on `intents` are untouched. Wrap in a
// transaction so partial state is impossible — either the whole new clustering
// is visible, or the old one remains.
//
// Positions are written for BOTH clustered and noise intents — noise still
// appears on the Clusters view scatter (uncolored), which is what makes
// "see what fell through clustering" useful.

import { eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import type { IntentClusterAssignment } from "./cluster-driver.ts";

type LabeledCluster = {
  cluster_id: string; // "cluster_0001"
  label: string;
  intents: IntentClusterAssignment[];
};

export async function persistClusters(
  clusters: LabeledCluster[],
  noise: IntentClusterAssignment[],
): Promise<void> {
  await db.transaction(async (tx) => {
    // Wipe prior cluster state. ON DELETE SET NULL on intents.cluster_id
    // clears assignments transitively.
    await tx.delete(schema.clusters);

    // First reset positions on every intent we're about to update — the union
    // of clustered + noise covers every intent that went through this run.
    const allIntentStrings = [
      ...clusters.flatMap((c) => c.intents.map((i) => i.intent)),
      ...noise.map((n) => n.intent),
    ];
    if (allIntentStrings.length > 0) {
      await tx
        .update(schema.intents)
        .set({ clusterId: null, probability: null, positionX: null, positionY: null })
        .where(inArray(schema.intents.intent, allIntentStrings));
    }

    if (clusters.length > 0) {
      await tx.insert(schema.clusters).values(
        clusters.map((c) => ({
          id: c.cluster_id,
          label: c.label,
          memberCount: c.intents.length,
        })),
      );
    }

    // Per-row updates because each intent has its own (cluster_id, prob, x, y)
    // tuple — no clean bulk equivalent in plain SQL.
    for (const c of clusters) {
      for (const i of c.intents) {
        await tx
          .update(schema.intents)
          .set({
            clusterId: c.cluster_id,
            probability: i.probability,
            positionX: i.position[0],
            positionY: i.position[1],
            clusteredAt: sql`now()`,
          })
          .where(eq(schema.intents.intent, i.intent));
      }
    }

    // Noise points: set positions only. cluster_id stays null.
    for (const n of noise) {
      await tx
        .update(schema.intents)
        .set({
          positionX: n.position[0],
          positionY: n.position[1],
          clusteredAt: sql`now()`,
        })
        .where(eq(schema.intents.intent, n.intent));
    }
  });
}
