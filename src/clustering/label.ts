// LLM-generated human-readable label per cluster.

import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { db, schema } from "../db/client.ts";
import { openrouter } from "../llm/openrouter.ts";
import { withLlmRetry } from "../llm/retry.ts";

const ClusterLabelSchema = z
  .object({
    label: z.string().min(1).max(80),
  })
  .strict();

const clusterLabelJsonSchema = (() => {
  const full = zodToJsonSchema(ClusterLabelSchema, {
    name: "cluster_label",
    $refStrategy: "none",
  }) as { definitions?: Record<string, unknown> };
  return (full.definitions?.cluster_label ?? full) as Record<string, unknown>;
})();

const SAMPLE_MESSAGES_PER_CLUSTER = 5;

async function sampleMessagesForIntents(intents: string[]): Promise<string[]> {
  if (intents.length === 0) return [];
  const rows = await db
    .select({ content: schema.turns.content })
    .from(schema.turns)
    .innerJoin(schema.turnSignals, eq(schema.turnSignals.turnId, schema.turns.id))
    .where(inArray(schema.turnSignals.intent, intents))
    .orderBy(sql`random()`)
    .limit(SAMPLE_MESSAGES_PER_CLUSTER);
  return rows.map((r) => r.content);
}

export async function labelCluster(
  clusterIntents: string[],
  model: string,
): Promise<string> {
  const samples = await sampleMessagesForIntents(clusterIntents);

  const prompt = `You are labeling a cluster of user-conversation intents discovered in agent analytics. Produce a short (3-8 word) human-readable label suitable for a dashboard heading. Use noun-phrase form. Don't use the word "cluster" in the label.

Intent strings in this cluster (these are normalized snake_case phrases, all about the same underlying user goal):
${clusterIntents.map((i) => `- ${i}`).join("\n")}

${samples.length > 0 ? `Example user messages from this cluster:\n${samples.map((s) => `- "${s}"`).join("\n")}\n` : ""}
Return strictly the structured JSON matching the schema.`;

  const resp = await withLlmRetry(() =>
    openrouter().chat.completions.create({
      model,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "cluster_label",
          strict: true,
          schema: clusterLabelJsonSchema,
        },
      },
    }),
  );

  const content = resp.choices[0]?.message.content;
  if (!content) throw new Error("Empty response from cluster labeler");
  return ClusterLabelSchema.parse(JSON.parse(content)).label;
}
