// Elysia API entry point. Routes are mounted from their respective modules
// to keep this file as pure wiring.

import { Elysia } from "elysia";

import { config } from "../config.ts";
import { ingestRoutes } from "./ingest/route.ts";

export const app = new Elysia()
  .get("/health", () => ({ status: "ok" }))
  .use(ingestRoutes)
  .listen(config.port);

console.log(`listening on http://localhost:${config.port}`);
