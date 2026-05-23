/**
 * Generate typed insights from the current clusters. Replaces prior insights
 * atomically. Reports uncategorized_rate — the operational signal for whether
 * the taxonomy (src/insights/typology.ts) is keeping up.
 *
 * Usage:
 *   bun scripts/generate-insights.ts [--headline-model SLUG] [--concurrency N]
 */

import { parseArgs } from "node:util";

import { config } from "../src/config.ts";
import { runInsightsPipeline } from "../src/insights/pipeline.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      "headline-model": { type: "string", default: config.insightHeadlineModel },
      concurrency: { type: "string", default: "5" },
    },
  });

  const stats = await runInsightsPipeline({
    headlineModel: values["headline-model"]!,
    headlineConcurrency: Number(values.concurrency),
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
