// OpenRouter client + the single LLM call this generator makes.

import OpenAI from "openai";

import { buildPrompt } from "./prompt.ts";
import {
  ConversationSchema,
  conversationJsonSchema,
  type GeneratedConversation,
} from "./schema.ts";
import type { Scenario, Skeleton } from "./types.ts";
import { validateConversation } from "./validate.ts";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const EXPANSION_TEMPERATURE = 0.9; // high - we want surface variation across the cluster
const MAX_ATTEMPTS = 3; // initial + 2 retries on validation failure

export function makeClient(apiKey: string): OpenAI {
  return new OpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey,
    defaultHeaders: {
      // OpenRouter uses these for attribution / per-app rate limits. Optional.
      "HTTP-Referer": "https://github.com/local/agnost-takehome",
      "X-Title": "agnost-takehome",
    },
  });
}

export async function expandConversation(
  client: OpenAI,
  model: string,
  scenario: Scenario,
  sk: Skeleton,
): Promise<GeneratedConversation> {
  const prompt = buildPrompt(scenario, sk);
  let lastReason = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // On retries, append the validation failure so the model corrects course.
    const messages: { role: "user"; content: string }[] = [
      {
        role: "user",
        content:
          attempt === 1
            ? prompt
            : `${prompt}\n\nIMPORTANT: A previous attempt was rejected because: ${lastReason}. Produce a corrected conversation that satisfies ALL hard requirements.`,
      },
    ];

    const resp = await client.chat.completions.create({
      model,
      temperature: EXPANSION_TEMPERATURE,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "conversation",
          strict: true,
          schema: conversationJsonSchema,
        },
      },
    });
    const content = resp.choices[0]?.message.content;
    if (!content) throw new Error("Empty response from model");

    const parsed = ConversationSchema.parse(JSON.parse(content));
    const result = validateConversation(parsed, sk);
    if (result.ok) return parsed;

    lastReason = result.reason;
    if (attempt < MAX_ATTEMPTS) {
      process.stderr.write(
        `\n[retry ${attempt}/${MAX_ATTEMPTS - 1}] ${sk.mode_id}: ${lastReason}\n`,
      );
    }
  }

  throw new Error(
    `validation failed after ${MAX_ATTEMPTS} attempts: ${lastReason}`,
  );
}
