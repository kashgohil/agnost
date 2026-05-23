// End-to-end clustering orchestrator. Five steps:
//   1. Sync intents from turn_signals (insert any new ones)
//   2. Embed any intents missing a vector
//   3. Run HDBSCAN via Python subprocess
//   4. Promote high-frequency noise singletons to their own clusters
//   5. Label each cluster with an LLM call
//   6. Persist clusters + assignments (replaces prior run atomically)

import { inArray, sql } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { Semaphore } from "../lib/concurrency.ts";
import { runClustering, type IntentClusterAssignment } from "./cluster-driver.ts";
import { embedMissingIntents } from "./embed.ts";
import { labelCluster } from "./label.ts";
import { persistClusters } from "./persist.ts";
import { syncIntents } from "./sync.ts";

// Why this exists: HDBSCAN min_cluster_size rejects singletons. But if the
// LLM canonicalizes a concept consistently (e.g., 314 turns all labeled
// "export_order_history"), that concept is ONE point in clustering space → a
// singleton → noise. Important high-volume patterns get hidden in noise.
// Solution: any noise intent that appears in >= this many user turns is
// promoted to its own single-intent cluster.
const NOISE_PROMOTION_TURN_THRESHOLD = 15;

export type ClusteringStats = {
  intents_total: number;
  intents_added: number;
  intents_embedded: number;
  clusters_formed: number;
  clusters_promoted_from_noise: number;
  noise_intents: number;
};

async function fetchTurnCounts(intents: string[]): Promise<Map<string, number>> {
  if (intents.length === 0) return new Map();
  const rows = await db
    .select({
      intent: schema.turnSignals.intent,
      turnCount: sql<number>`count(*)::int`,
    })
    .from(schema.turnSignals)
    .where(inArray(schema.turnSignals.intent, intents))
    .groupBy(schema.turnSignals.intent);
  return new Map(rows.map((r) => [r.intent, r.turnCount]));
}

function promoteHighFrequencyNoise(
  assignments: IntentClusterAssignment[],
  turnCounts: Map<string, number>,
): {
  grouped: Map<number, IntentClusterAssignment[]>;
  noisePoints: IntentClusterAssignment[];
  promotedCount: number;
} {
  // First pass: split by HDBSCAN label.
  const grouped = new Map<number, IntentClusterAssignment[]>();
  const trueNoise: IntentClusterAssignment[] = [];
  let nextLabel = -1;
  for (const a of assignments) {
    if (a.label === -1) {
      trueNoise.push(a);
    } else {
      const arr = grouped.get(a.label) ?? [];
      arr.push(a);
      grouped.set(a.label, arr);
      if (a.label > nextLabel) nextLabel = a.label;
    }
  }
  nextLabel++;

  // Promote noise singletons whose underlying turn-count is meaningful.
  const remainingNoise: IntentClusterAssignment[] = [];
  let promoted = 0;
  for (const a of trueNoise) {
    const turns = turnCounts.get(a.intent) ?? 0;
    if (turns >= NOISE_PROMOTION_TURN_THRESHOLD) {
      grouped.set(nextLabel, [{ ...a, label: nextLabel, probability: 1.0 }]);
      nextLabel++;
      promoted++;
    } else {
      remainingNoise.push(a);
    }
  }

  return { grouped, noisePoints: remainingNoise, promotedCount: promoted };
}

export async function runClusteringPipeline(opts: {
  embeddingModel: string;
  labelingModel: string;
  minClusterSize: number;
  minSamples: number;
  labelingConcurrency: number;
  onProgress?: (stage: string, info?: string) => void;
}): Promise<ClusteringStats> {
  const log = (stage: string, info?: string) => opts.onProgress?.(stage, info);

  log("sync");
  const sync = await syncIntents();

  log("embed");
  const embed = await embedMissingIntents(opts.embeddingModel);

  log("cluster");
  const assignments = await runClustering({
    min_cluster_size: opts.minClusterSize,
    min_samples: opts.minSamples,
  });

  log("promote-noise");
  const noiseIntentStrings = assignments.filter((a) => a.label === -1).map((a) => a.intent);
  const turnCounts = await fetchTurnCounts(noiseIntentStrings);
  const { grouped, noisePoints, promotedCount } = promoteHighFrequencyNoise(
    assignments,
    turnCounts,
  );
  if (promotedCount > 0) log("promote-noise", `promoted ${promotedCount} singleton(s)`);

  const sortedLabels = Array.from(grouped.keys()).sort((a, b) => a - b);

  log("label", `${sortedLabels.length} clusters`);
  const sem = new Semaphore(opts.labelingConcurrency);
  const labeled = await Promise.all(
    sortedLabels.map((hdbscanLabel, i) =>
      sem.run(async () => {
        const intents = grouped.get(hdbscanLabel)!;
        const intentStrings = intents.map((x) => x.intent);
        const label = await labelCluster(intentStrings, opts.labelingModel);
        return {
          cluster_id: `cluster_${String(i + 1).padStart(4, "0")}`,
          label,
          intents,
        };
      }),
    ),
  );

  log("persist");
  await persistClusters(labeled, noisePoints);

  return {
    intents_total: sync.total,
    intents_added: sync.added,
    intents_embedded: embed.embedded,
    clusters_formed: labeled.length,
    clusters_promoted_from_noise: promotedCount,
    noise_intents: noisePoints.length,
  };
}
