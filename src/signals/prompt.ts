// Prompt for per-conversation signal extraction. One pass returns signals for
// every user turn — gives the model context for is_repeat detection without
// adding state across calls.

import { FRUSTRATION_MARKERS } from "./schema.ts";

type TurnForPrompt = {
  turn_id: string;
  role: "user" | "assistant";
  content: string;
};

export function buildSignalPrompt(turns: TurnForPrompt[]): string {
  const userTurnIds = turns.filter((t) => t.role === "user").map((t) => t.turn_id);
  const transcript = turns
    .map((t) => `[${t.turn_id}] ${t.role.toUpperCase()}: ${t.content}`)
    .join("\n");

  return `You are analyzing a conversation between a user and an AI agent. For EVERY user turn, extract structured signals about what the user wanted, how they felt, and whether they were repeating themselves.

Conversation transcript:
${transcript}

For each user turn below, produce one entry in the signals array (in order). Do NOT produce entries for assistant turns.

User turn IDs to score (in order): ${userTurnIds.join(", ")}

Fields:
- intent: a short canonical phrase in snake_case verb_noun form summarizing what the user is trying to accomplish in that specific turn. Examples: "refund_old_order", "export_order_history", "redirect_in_transit_package", "check_order_status", "ask_about_discount_code". Keep it normalized — the same goal phrased differently should produce the same intent string. If the user is making small talk or providing info the agent asked for, use a generic intent like "provide_order_id" or "acknowledge". 2-4 words maximum.
- sentiment: a number from -1 (very negative, hostile, abandonment) to 1 (very positive, thankful), with 0 being neutral.
- frustration_markers: zero or more tags drawn from this fixed set. Only include a tag if it clearly applies to this turn:
  ${FRUSTRATION_MARKERS.map((m) => `* ${m}`).join("\n  ")}
- is_repeat: true if this user turn is essentially repeating an earlier user turn from the same conversation (same underlying intent, even if rephrased). False otherwise. The first time an intent appears it is NOT a repeat.

Return strictly the structured JSON matching the schema — no preamble.`;
}
