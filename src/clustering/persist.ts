// Persist cluster assignments, labels, and UMAP positions. Atomic replace.
// Positions are written for noise intents too so they still appear on the scatter.

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
    await tx.delete(schema.clusters);

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
