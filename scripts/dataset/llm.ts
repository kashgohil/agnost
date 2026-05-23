// OpenRouter client + the single LLM call this generator makes.

import OpenAI from "openai";

import { buildPrompt } from "./prompt.ts";
import {
  ConversationSchema,
  conversationJsonSchema,
  type GeneratedConversation,
} from "./schema.ts";
import type { Scenario, Skeleton } from "./types.ts";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const EXPANSION_TEMPERATURE = 0.9; // high — we want surface variation across the cluster

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
  const resp = await client.chat.completions.create({
    model,
    temperature: EXPANSION_TEMPERATURE,
    messages: [{ role: "user", content: buildPrompt(scenario, sk) }],
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
  return ConversationSchema.parse(JSON.parse(content));
}
