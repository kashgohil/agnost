// Env var loader. Bun auto-loads .env into process.env; this module just
// surfaces what's available with a clear distinction between what's required
// at boot vs what's only needed when a specific pipeline stage runs.
//
// DATABASE_URL is required at boot (every route touches Postgres).
// OPENROUTER_API_KEY is NOT required at boot — only LLM-calling stages need
// it. Callers (openrouter() factory, scripts) enforce the requirement at
// call time. This keeps GET /health and read-only routes bootable without
// an LLM key, which matters for reviewer/CI ergonomics.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  // Optional at boot. The openrouter() factory throws a clear error if
  // it's actually needed and missing.
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 3000),
  // Per-pipeline-stage model defaults, overridable via env or CLI flag.
  // Stage-specific because the structural complexity differs:
  //   - dataset generation: hard multi-turn constraints → needs 4.1-mini or stronger
  //   - signal extraction: single-pass classification → 4o-mini handles it
  signalExtractionModel: process.env.SIGNAL_EXTRACTION_MODEL ?? "openai/gpt-4o-mini",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
  clusterLabelingModel: process.env.CLUSTER_LABELING_MODEL ?? "openai/gpt-4o-mini",
  insightHeadlineModel: process.env.INSIGHT_HEADLINE_MODEL ?? "openai/gpt-4o-mini",
  // How to invoke scripts/cluster.py. Defaults to `uv run` (auto-installs
  // PEP 723 deps on first call, caches afterwards). Override to e.g.
  // ".venv/bin/python" if you prefer to manage your own env.
  clusterRunner: process.env.CLUSTER_RUNNER ?? "uv run",
};
