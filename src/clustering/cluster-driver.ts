// TS driver for the HDBSCAN subprocess. Loads embedded intents, spawns
// scripts/cluster.py with vectors on stdin, parses cluster labels from stdout.
//
// The Python boundary is intentionally narrow — pure algorithm, no DB access,
// no business logic. Swap out HDBSCAN by replacing one file.

import { isNotNull } from "drizzle-orm";

import { config } from "../config.ts";
import { db, schema } from "../db/client.ts";

type ClusterRequest = {
  min_cluster_size: number;
  min_samples: number;
};

export type IntentClusterAssignment = {
  intent: string;
  label: number; // -1 for noise, otherwise the HDBSCAN cluster id (small integer)
  probability: number;
};

export async function runClustering(
  req: ClusterRequest,
): Promise<IntentClusterAssignment[]> {
  const rows = await db
    .select({ intent: schema.intents.intent, embedding: schema.intents.embedding })
    .from(schema.intents)
    .where(isNotNull(schema.intents.embedding));

  if (rows.length === 0) return [];

  // pgvector via drizzle returns vectors as number[]. Build the subprocess input.
  const vectors = rows.map((r) => r.embedding as number[]);
  const payload = JSON.stringify({
    vectors,
    min_cluster_size: req.min_cluster_size,
    min_samples: req.min_samples,
  });

  // clusterRunner may include args (e.g. "uv run"), so split on whitespace.
  const runner = config.clusterRunner.split(/\s+/).filter(Boolean);
  const proc = Bun.spawn([...runner, "scripts/cluster.py"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Bun.spawn's stdin is a WritableStream — write payload and close.
  proc.stdin.write(payload);
  await proc.stdin.end();

  const [stdoutText, stderrText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(
      `cluster.py exited ${proc.exitCode}: ${stderrText.trim() || "(no stderr)"}`,
    );
  }

  let parsed: { labels: number[]; probabilities: number[] };
  try {
    parsed = JSON.parse(stdoutText);
  } catch (err) {
    throw new Error(
      `cluster.py produced invalid JSON: ${(err as Error).message}\nstdout: ${stdoutText.slice(0, 500)}`,
    );
  }

  if (parsed.labels.length !== rows.length || parsed.probabilities.length !== rows.length) {
    throw new Error(
      `cluster.py output length mismatch: ${rows.length} intents in, ${parsed.labels.length} labels out`,
    );
  }

  return rows.map((r, i) => ({
    intent: r.intent,
    label: parsed.labels[i]!,
    probability: parsed.probabilities[i]!,
  }));
}
