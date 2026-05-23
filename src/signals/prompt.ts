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
- intent: a short canonical phrase in snake_case verb_noun form summarizing what the user is trying to accomplish in that specific turn. Examples: "refund_old_order", "export_order_history", "redirect_in_transit_package", "check_order_status", "ask_about_discount_code". 2-4 words maximum.

  CANONICALIZATION RULES (important for consistency across turns and conversations):
  * When the user restates an earlier goal in different terms within THIS conversation — even with different language, mechanism, or framing — reuse the EXACT SAME intent label as the first mention of that goal. Do not invent new labels for the same underlying objective. Example: if turn 1 is "I want to change my shipping address" → "change_shipping_address", and turn 4 is "can you contact the courier to redirect it?", turn 4's intent is still "change_shipping_address" — the underlying goal is unchanged.
  * Only invent a new intent label when the user's underlying objective genuinely changes (e.g., switches from refund to product question).
  * Prefer broader, more reusable labels over hyper-specific ones. "change_shipping_address" beats "redirect_in_transit_package_via_courier".
  * If the user is making small talk or providing info the agent asked for, use a generic intent like "provide_order_id" or "acknowledge".
- sentiment: a number from -1 (very negative, hostile, abandonment) to 1 (very positive, thankful), with 0 being neutral.
- frustration_markers: zero or more tags drawn from this fixed set. Only include a tag if it clearly applies to this turn:
  ${FRUSTRATION_MARKERS.map((m) => `* ${m}`).join("\n  ")}
- is_repeat: true if this user turn is essentially repeating an earlier user turn from the same conversation (same underlying intent, even if rephrased). False otherwise. The first time an intent appears it is NOT a repeat.

Return strictly the structured JSON matching the schema — no preamble.`;
}
