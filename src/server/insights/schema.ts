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

export const ListInsightsQuerySchema = z.object({
  tag: tagsParam,
  min_volume_pct: z.coerce.number().min(0).max(1).optional(),
  min_conversation_count: z.coerce.number().int().min(0).optional(),
  sort: z.enum(SortOptions).default("volume_desc"),
  include_uncategorized: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const EvalSetQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListInsightsQuery = z.infer<typeof ListInsightsQuerySchema>;
export type EvalSetQuery = z.infer<typeof EvalSetQuerySchema>;
