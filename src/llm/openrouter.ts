// Shared OpenRouter client for server-side LLM calls. Lazy singleton so
// module imports don't require env vars to be set at boot.
//
// Note: model selection is the caller's responsibility (see config.ts for
// per-stage defaults). This module is pure transport.

import OpenAI from "openai";

import { config } from "../config.ts";

let client: OpenAI | null = null;

export function openrouter(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: config.openrouterApiKey,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/local/agnost-takehome",
        "X-Title": "agnost-takehome",
      },
    });
  }
  return client;
}
