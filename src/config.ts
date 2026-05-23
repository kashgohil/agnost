// Env var loader. Bun auto-loads .env into process.env; this module just
// asserts what's required and exposes a typed config object.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  openrouterApiKey: required("OPENROUTER_API_KEY"),
  openaiApiKey: required("OPENAI_API_KEY"),
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 3000),
};
