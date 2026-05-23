// drizzle-kit config. Reads DATABASE_URL from env (Bun auto-loads .env when
// migrations are run via `bun drizzle-kit ...`).

import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://agnost:agnost@localhost:5432/agnost",
  },
  strict: true,
} satisfies Config;
