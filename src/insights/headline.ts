// LLM-generated headline string for an insight.
//
// The LLM only writes — the metrics and tags are deterministic. Inputs: cluster
// label + computed numbers + assigned tags. Output: one PM-readable sentence.

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { openrouter } from "../llm/openrouter.ts";
import { withLlmRetry } from "../llm/retry.ts";
import type { ClusterMetrics } from "./typology.ts";

const HeadlineSchema = z.object({ headline: z.string().min(1).max(160) }).strict();

const headlineJsonSchema = (() => {
  const full = zodToJsonSchema(HeadlineSchema, {
    name: "headline",
    $refStrategy: "none",
  }) as { definitions?: Record<string, unknown> };
  return (full.definitions?.headline ?? full) as Record<string, unknown>;
})();

export async function generateHeadline(
  m: ClusterMetrics,
  tags: { problem: string; trajectory: string; severity: string },
  model: string,
): Promise<string> {
  const causeBlurb = m.attributed_cause
    ? `\nAttributed cause: tool "${m.attributed_cause.tool}" fails ${Math.round(m.attributed_cause.failure_rate * 100)}% of the time.`
    : "";

  const prompt = `Write a single headline (max 120 chars) summarizing a cluster of user-conversation intents from agent analytics. The headline should read like a one-line bullet on an engineering/PM dashboard. Lead with the volume percentage. State what users are doing and (if attributed) the cause.

Cluster label: ${m.cluster_label}
Tags: ${tags.problem}, ${tags.trajectory}, ${tags.severity}
Volume: ${m.conversation_count} conversations (${(m.volume_pct * 100).toFixed(0)}% of total)
Average sentiment: ${m.sentiment_avg.toFixed(2)}${causeBlurb}

Examples of headline shape:
- "23% of conversations: refund requests blocked by 30-day window"
- "14% of conversations: bulk export requests — no tool exists (rising)"
- "9% of conversations: shipping address changes — courier-redirect not supported"

Return strictly the structured JSON matching the schema.`;

  const resp = await withLlmRetry(() =>
    openrouter().chat.completions.create({
      model,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "headline", strict: true, schema: headlineJsonSchema },
      },
    }),
  );

  const content = resp.choices[0]?.message.content;
  if (!content) throw new Error("Empty response from headline generator");
  return HeadlineSchema.parse(JSON.parse(content)).headline;
}
