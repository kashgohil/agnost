// Zod schema for the LLM-generated conversation, also used as the JSON schema
// sent in response_format. `input_summary: string` (not `input: object`) is a
// workaround: OpenAI strict mode forbids free-form objects.

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const ToolCallSchema = z
  .object({
    tool_name: z.string(),
    input_summary: z.string(),
    status: z.enum(["success", "error", "empty_result"]),
    output: z.string(),
    latency_ms: z.number().int(),
  })
  .strict();

export const TurnSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    tool_calls: z.array(ToolCallSchema),
  })
  .strict();

export const ConversationSchema = z
  .object({
    turns: z.array(TurnSchema),
  })
  .strict();

export type GeneratedConversation = z.infer<typeof ConversationSchema>;

// zod-to-json-schema wraps the result in `definitions` when given a name; unwrap.
export const conversationJsonSchema = (() => {
  const full = zodToJsonSchema(ConversationSchema, {
    name: "conversation",
    $refStrategy: "none",
  }) as { definitions?: Record<string, unknown> };
  return (full.definitions?.conversation ?? full) as Record<string, unknown>;
})();
