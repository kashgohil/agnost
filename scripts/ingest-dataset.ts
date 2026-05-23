/**
 * Bulk-ingest a generated dataset into the running API.
 *
 * Walks data/conversations/<scenario>/conv_*.json and POSTs each to /v1/traces.
 * Idempotent: re-running skips already-ingested conversations server-side.
 *
 * Usage:
 *   bun scripts/ingest-dataset.ts \
 *       --dir data/conversations/shopco \
 *       --url http://localhost:3000 \
 *       --concurrency 10
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { Semaphore } from "../src/lib/concurrency.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: "string" },
      url: { type: "string", default: "http://localhost:3000" },
      concurrency: { type: "string", default: "10" },
    },
  });

  if (!values.dir) {
    console.error("Usage: --dir <conversations-dir> [--url BASE] [--concurrency N]");
    process.exit(1);
  }

  const files = readdirSync(values.dir)
    .filter((f) => f.startsWith("conv_") && f.endsWith(".json"))
    .map((f) => join(values.dir!, f));

  if (files.length === 0) {
    console.error(`No conv_*.json files found in ${values.dir}`);
    process.exit(1);
  }

  const endpoint = `${values.url}/v1/traces`;
  const sem = new Semaphore(Number(values.concurrency));

  let ingested = 0;
  let already = 0;
  let failed = 0;

  const tasks = files.map((file) =>
    sem.run(async () => {
      const body = readFileSync(file, "utf-8");
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (!res.ok) {
          failed++;
          const text = await res.text();
          process.stderr.write(`\n[${res.status}] ${file}: ${text}\n`);
          return;
        }
        const out = (await res.json()) as { status: string };
        if (out.status === "ingested") ingested++;
        else if (out.status === "already_ingested") already++;
        const total = ingested + already + failed;
        if (total % 25 === 0 || total === files.length) {
          process.stderr.write(`\ringesting: ${total}/${files.length}`);
        }
      } catch (err) {
        failed++;
        process.stderr.write(`\n[error] ${file}: ${(err as Error).message}\n`);
      }
    }),
  );

  await Promise.all(tasks);
  process.stderr.write("\n");
  console.log(`ingested: ${ingested}, already: ${already}, failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
