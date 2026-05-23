// LLM call for signal extraction.
//
// Two layers of retry:
//   - withLlmRetry (transport): exponential backoff on 429/5xx/network errors.
//   - content retry (in this file): if the model returns the wrong set of
//     turn_ids, append the failure reason and try again. Different concerns,
//     kept separate.

import { withLlmRetry } from "../llm/retry.ts";
import { openrouter } from "../llm/openrouter.ts";
import { buildSignalPrompt } from "./prompt.ts";
import {
  SignalExtractionSchema,
  signalExtractionJsonSchema,
  type SignalExtraction,
} from "./schema.ts";
import { validateSignalCoverage } from "./validate.ts";

const MAX_CONTENT_ATTEMPTS = 3;

type ConversationForExtraction = {
  conversation_id: string;
  turns: Array<{
    turn_id: string;
    role: "user" | "assistant";
    content: string;
  }>;
};

export async function extractSignals(
  conv: ConversationForExtraction,
  model: string,
): Promise<SignalExtraction> {
  const expectedUserTurnIds = conv.turns
    .filter((t) => t.role === "user")
    .map((t) => t.turn_id);

  const basePrompt = buildSignalPrompt(conv.turns);
  let lastReason = "";

  for (let attempt = 1; attempt <= MAX_CONTENT_ATTEMPTS; attempt++) {
    const prompt =
      attempt === 1
        ? basePrompt
        : `${basePrompt}\n\nIMPORTANT: A previous attempt was rejected because: ${lastReason}. The signals array must contain exactly one entry per user turn ID listed above — no more, no fewer, no other IDs.`;

    const resp = await withLlmRetry(() =>
      openrouter().chat.completions.create({
        model,
        temperature: 0.1,
        messages: [{ role: "user", content: prompt }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "signal_extraction",
            strict: true,
            schema: signalExtractionJsonSchema,
          },
        },
      }),
    );

    const content = resp.choices[0]?.message.content;
    if (!content) throw new Error("Empty response from signal extractor");

    const parsed = SignalExtractionSchema.parse(JSON.parse(content));
    const result = validateSignalCoverage(parsed.signals, expectedUserTurnIds);
    if (result.ok) return parsed;

    lastReason = result.reason;
    if (attempt < MAX_CONTENT_ATTEMPTS) {
      process.stderr.write(
        `\n[content retry ${attempt}/${MAX_CONTENT_ATTEMPTS - 1}] ${conv.conversation_id}: ${lastReason}\n`,
      );
    }
  }

  throw new Error(
    `signal extraction validation failed after ${MAX_CONTENT_ATTEMPTS} attempts: ${lastReason}`,
  );
}
