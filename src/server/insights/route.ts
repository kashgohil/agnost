// /v1/insights routes — list, detail, and paginated eval-set.
// Validates query params with Zod (mirrors the ingestion route's pattern).

import { Elysia } from "elysia";

import { getEvalSet, getInsightById, listInsights } from "./queries.ts";
import { EvalSetQuerySchema, ListInsightsQuerySchema } from "./schema.ts";

export const insightsRoutes = new Elysia({ prefix: "/v1/insights" })
  .get("/", async ({ query, set }) => {
    const parsed = ListInsightsQuerySchema.safeParse(query);
    if (!parsed.success) {
      set.status = 400;
      return { error: "invalid_query", details: parsed.error.flatten() };
    }
    return await listInsights(parsed.data);
  })
  .get("/:id", async ({ params, set }) => {
    const insight = await getInsightById(params.id);
    if (!insight) {
      set.status = 404;
      return { error: "not_found", id: params.id };
    }
    return insight;
  })
  .get("/:id/eval-set", async ({ params, query, set }) => {
    const parsed = EvalSetQuerySchema.safeParse(query);
    if (!parsed.success) {
      set.status = 400;
      return { error: "invalid_query", details: parsed.error.flatten() };
    }
    const result = await getEvalSet(params.id, parsed.data.limit, parsed.data.offset);
    if (!result) {
      set.status = 404;
      return { error: "not_found", id: params.id };
    }
    return {
      insight_id: result.insight.id,
      headline: result.insight.headline,
      tags: result.insight.tags,
      attributed_cause: result.insight.attributed_cause,
      total: result.total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      conversations: result.conversations,
    };
  });
