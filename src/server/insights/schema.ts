// Zod schemas for /v1/insights query params and response shapes.
//
// Tag filtering is AND-semantics: `?tag=emerging&tag=high` returns insights
// with BOTH tags. Narrowing is more useful than broadening on a dashboard.

import { z } from "zod";

const SortOptions = ["volume_desc", "volume_asc", "sentiment_asc", "recent"] as const;
export type SortOption = (typeof SortOptions)[number];

// Repeated query params arrive as string | string[] depending on count. Normalize.
const tagsParam = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]));

// Query-string booleans cannot use z.coerce.boolean() — it calls Boolean(),
// and Boolean("false") === true (any non-empty string is truthy). Parse
// explicitly: "true"/"1" → true, "false"/"0"/missing → false.
const boolParam = z
  .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
  .optional()
  .transform((v) => v === "true" || v === "1");

export const ListInsightsQuerySchema = z.object({
  tag: tagsParam,
  min_volume_pct: z.coerce.number().min(0).max(1).optional(),
  min_conversation_count: z.coerce.number().int().min(0).optional(),
  sort: z.enum(SortOptions).default("volume_desc"),
  include_uncategorized: boolParam,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const EvalSetQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListInsightsQuery = z.infer<typeof ListInsightsQuerySchema>;
export type EvalSetQuery = z.infer<typeof EvalSetQuerySchema>;
