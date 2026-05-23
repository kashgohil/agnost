// Post-generation validation. The LLM produces structurally valid JSON (the
// Zod schema enforces shape) but doesn't always respect the *content*
// constraints from the skeleton — sometimes it stops early, skips required
// tool calls, or attaches tool calls to user turns. We check those here and
// the caller retries on failure.

import type { GeneratedConversation } from "./schema.ts";
import type { Skeleton } from "./types.ts";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validateConversation(
  conv: GeneratedConversation,
  sk: Skeleton,
): ValidationResult {
  // 1. Tool calls must only appear in assistant turns.
  for (const [i, turn] of conv.turns.entries()) {
    if (turn.role === "user" && turn.tool_calls.length > 0) {
      return { ok: false, reason: `tool_call on user turn ${i}` };
    }
  }

  // 2. The tool_call_pattern must appear in order with matching outcomes.
  const flatToolCalls = conv.turns.flatMap((t) => t.tool_calls);
  if (flatToolCalls.length < sk.tool_call_pattern.length) {
    return {
      ok: false,
      reason: `expected ${sk.tool_call_pattern.length} tool calls, got ${flatToolCalls.length}`,
    };
  }
  for (let i = 0; i < sk.tool_call_pattern.length; i++) {
    const expected = sk.tool_call_pattern[i]!;
    const actual = flatToolCalls[i]!;
    if (actual.tool_name !== expected.tool) {
      return {
        ok: false,
        reason: `tool call ${i}: expected ${expected.tool}, got ${actual.tool_name}`,
      };
    }
    if (actual.status !== expected.outcome) {
      return {
        ok: false,
        reason: `tool call ${i} (${expected.tool}): expected outcome ${expected.outcome}, got ${actual.status}`,
      };
    }
  }

  // 3. Sanity: must have at least two turns. Either role can be last — drop-offs
  //    and agent-gave-up cases naturally end on assistant, resolved/escalated
  //    cases can end on either.
  if (conv.turns.length < 2) {
    return {
      ok: false,
      reason: `only ${conv.turns.length} turn(s) — too short`,
    };
  }

  return { ok: true };
}
