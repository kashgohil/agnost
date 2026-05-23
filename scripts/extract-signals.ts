/**
 * Run the per-turn signal extractor over conversations in the DB.
 *
 * Default: only conversations with at least one unscored user turn.
 * --force: re-extract every conversation (overwrites prior signals).
 *          Useful when iterating on the prompt or switching models.
 *
 * Usage:
 *   bun scripts/extract-signals.ts [--concurrency N] [--limit N] [--force] [--model SLUG]
 */

import { parseArgs } from "node:util";

import { config } from "../src/config.ts";
import { runSignalExtraction } from "../src/signals/pipeline.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      concurrency: { type: "string", default: "5" },
      limit: { type: "string" },
      force: { type: "boolean", default: false },
      model: { type: "string", default: config.signalExtractionModel },
    },
  });

  const stats = await runSignalExtraction({
    model: values.model!,
    concurrency: Number(values.concurrency),
    limit: values.limit ? Number(values.limit) : undefined,
    force: values.force,
    onProgress: (done, total) => {
      if (done % 5 === 0 || done === total) {
        process.stderr.write(`\rextracting: ${done}/${total}`);
      }
    },
  });
  process.stderr.write("\n");
  console.log(
    `model: ${values.model}, force: ${values.force}, attempted: ${stats.attempted}, succeeded: ${stats.succeeded}, failed: ${stats.failed}`,
  );
  process.exit(stats.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
