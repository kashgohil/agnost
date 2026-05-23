// Postgres connection + Drizzle wrapper. One instance per process — Bun's
// dev/run model is short-lived, so we don't bother with pool sizing here;
// postgres.js does sensible defaults.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { config } from "../config.ts";
import * as schema from "./schema.ts";

const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
});

export const db = drizzle(sql, { schema });
export { schema };
