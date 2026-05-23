// POST /v1/traces — ingest a conversation trace.
//
// Validates with Zod, persists transactionally, returns 201 on first ingest
// and 200 on idempotent re-ingest. Zod is the validation source of truth
// instead of Elysia's TypeBox so the schema is reusable elsewhere (e.g., the
// bulk ingest script) without duplicating type definitions.

import { Elysia } from "elysia";

import { persistConversation } from "./persist.ts";
import { InboundConversationSchema } from "./schema.ts";

export const ingestRoutes = new Elysia({ prefix: "/v1" }).post(
  "/traces",
  async ({ body, set }) => {
    const parsed = InboundConversationSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { error: "invalid_payload", details: parsed.error.flatten() };
    }

    const result = await persistConversation(parsed.data);
    set.status = result.status === "ingested" ? 201 : 200;
    return result;
  },
);
