// Env var loader. Bun auto-loads .env into process.env; this module just
// asserts what's required and exposes a typed config object.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  openrouterApiKey: required("OPENROUTER_API_KEY"),
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 3000),
  // Per-pipeline-stage model defaults, overridable via env or CLI flag.
  // Stage-specific because the structural complexity differs:
  //   - dataset generation: hard multi-turn constraints → needs 4.1-mini or stronger
  //   - signal extraction: single-pass classification → 4o-mini handles it
  signalExtractionModel: process.env.SIGNAL_EXTRACTION_MODEL ?? "openai/gpt-4o-mini",
};
