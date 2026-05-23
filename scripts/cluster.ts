/**
 * Run the clustering pipeline end-to-end.
 *
 * Steps (see src/clustering/pipeline.ts):
 *   sync → embed → cluster (Python subprocess) → label → persist
 *
 * Re-runnable: each run replaces prior cluster assignments atomically.
 * Embeddings persist across runs.
 *
 * Usage:
 *   bun scripts/cluster.ts [--min-cluster-size N] [--min-samples N] \
 *       [--embedding-model SLUG] [--labeling-model SLUG] [--labeling-concurrency N]
 */

import { parseArgs } from "node:util";

import { config } from "../src/config.ts";
import { runClusteringPipeline } from "../src/clustering/pipeline.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      "min-cluster-size": { type: "string", default: "5" },
      "min-samples": { type: "string", default: "5" },
      "embedding-model": { type: "string", default: config.embeddingModel },
      "labeling-model": { type: "string", default: config.clusterLabelingModel },
      "labeling-concurrency": { type: "string", default: "5" },
    },
  });

  const stats = await runClusteringPipeline({
    embeddingModel: values["embedding-model"]!,
    labelingModel: values["labeling-model"]!,
    minClusterSize: Number(values["min-cluster-size"]),
    minSamples: Number(values["min-samples"]),
    labelingConcurrency: Number(values["labeling-concurrency"]),
    onProgress: (stage, info) => {
      process.stderr.write(`[${stage}]${info ? ` ${info}` : ""}\n`);
    },
  });

  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
