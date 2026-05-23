/**
 * Generate synthetic conversation dataset from a scenario YAML.
 *
 * CLI entry point — all the actual work lives in scripts/dataset/.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... bun scripts/generate-dataset.ts \
 *       --scenario data/scenarios/shopco.yaml \
 *       --out data/conversations/shopco \
 *       --concurrency 10
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

import { Semaphore } from "./dataset/concurrency.ts";
import { conversationId, generateOne } from "./dataset/generate.ts";
import { makeClient } from "./dataset/llm.ts";
import { makeRng } from "./dataset/rng.ts";
import { buildWorkList, loadScenario } from "./dataset/scenario.ts";

const DEFAULT_MODEL = "openai/gpt-4.1-mini";

async function main() {
  const { values } = parseArgs({
    options: {
      scenario: { type: "string" },
      out: { type: "string" },
      concurrency: { type: "string", default: "10" },
      seed: { type: "string", default: "42" },
      model: { type: "string", default: DEFAULT_MODEL },
      limit: { type: "string" },
    },
  });

  if (!values.scenario || !values.out) {
    console.error(
      "Usage: --scenario <path> --out <dir> [--concurrency N] [--seed N] [--model SLUG] [--limit N]",
    );
    process.exit(1);
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY not set");
    process.exit(1);
  }

  const scenario = loadScenario(values.scenario);
  const scenarioName = basename(values.scenario).replace(/\.ya?ml$/, "");
  mkdirSync(values.out, { recursive: true });

  const rng = makeRng(Number(values.seed));
  const windowStart = new Date(`${scenario.time_window.start}T00:00:00.000Z`);
  let workList = buildWorkList(scenario, rng);
  const fullSize = workList.length;

  if (values.limit) {
    const n = Number(values.limit);
    if (!Number.isFinite(n) || n <= 0) {
      console.error(
        `--limit must be a positive integer (got: ${values.limit})`,
      );
      process.exit(1);
    }
    workList = workList.slice(0, n);
    console.error(
      `[limit] generating first ${workList.length} of ${fullSize} conversations`,
    );
  }

  const client = makeClient(apiKey);
  const sem = new Semaphore(Number(values.concurrency));

  const total = workList.length;
  let done = 0;

  const tasks = workList.map(([skeleton, weekIdx], i) =>
    sem.run(async () => {
      const convId = conversationId(scenarioName, i);
      try {
        const row = await generateOne({
          client,
          model: values.model!,
          scenario,
          skeleton,
          weekIdx,
          windowStart,
          convId,
          rng,
          outDir: values.out!,
        });
        done++;
        if (done % 10 === 0 || done === total) {
          process.stderr.write(`\rgenerating: ${done}/${total}`);
        }
        return row;
      } catch (err) {
        process.stderr.write(
          `\n[error] ${convId}: ${(err as Error).message}\n`,
        );
        throw err;
      }
    }),
  );

  const groundTruth = await Promise.all(tasks);
  process.stderr.write("\n");

  const gtPath = join(values.out, "_ground_truth.json");
  writeFileSync(gtPath, JSON.stringify(groundTruth, null, 2));
  console.log(`Wrote ${groundTruth.length} conversations to ${values.out}`);
  console.log(`Ground truth at ${gtPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
