// Elysia API skeleton. Real routes get mounted from src/server/routes/ as
// they're built (ingestion, insights, etc.). Health endpoint exists so
// docker-compose health probes and reviewer smoke tests have something to hit.

import { Elysia } from "elysia";

import { config } from "../config.ts";

export const app = new Elysia()
  .get("/health", () => ({ status: "ok" }))
  .listen(config.port);

console.log(`listening on http://localhost:${config.port}`);
