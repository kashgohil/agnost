// End-to-end clustering orchestrator. Five steps:
//   1. Sync intents from turn_signals (insert any new ones)
//   2. Embed any intents missing a vector
//   3. Run HDBSCAN via Python subprocess
//   4. Label each non-noise cluster with an LLM call
//   5. Persist clusters + assignments (replaces prior run atomically)

import { Semaphore } from "../lib/concurrency.ts";
import { runClustering, type IntentClusterAssignment } from "./cluster-driver.ts";
import { embedMissingIntents } from "./embed.ts";
import { labelCluster } from "./label.ts";
import { persistClusters } from "./persist.ts";
import { syncIntents } from "./sync.ts";

export type ClusteringStats = {
  intents_total: number;
  intents_added: number;
  intents_embedded: number;
  clusters_formed: number;
  noise_intents: number;
};

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

  // Group by HDBSCAN cluster label. -1 is noise — don't persist as a real cluster.
  const grouped = new Map<number, IntentClusterAssignment[]>();
  let noise = 0;
  for (const a of assignments) {
    if (a.label === -1) {
      noise++;
      continue;
    }
    const arr = grouped.get(a.label) ?? [];
    arr.push(a);
    grouped.set(a.label, arr);
  }

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
  await persistClusters(labeled);

  return {
    intents_total: sync.total,
    intents_added: sync.added,
    intents_embedded: embed.embedded,
    clusters_formed: labeled.length,
    noise_intents: noise,
  };
}
