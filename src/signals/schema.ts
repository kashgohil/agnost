// Output schema for the signal-extraction LLM call. One pass per conversation,
// returning a per-user-turn signal array. The schema is strict because the
// downstream clustering and insight stages depend on consistent fields.

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Fixed enum of frustration markers — discrete tags aggregate cleanly across
// clusters. Add to this list with care: every addition is a new dimension the
// rest of the pipeline must understand.
export const FRUSTRATION_MARKERS = [
  "repeated_question",
  "escalation_request",
  "negative_feedback",
  "abandonment_signal",
  "frustration_language",
  "profanity",
] as const;

export const TurnSignalSchema = z
  .object({
    turn_id: z.string().min(1),
    // Short canonical phrase (snake_case verb_noun), not the raw message.
    // E.g. "refund_old_order", "export_order_history", "redirect_in_transit_package".
    intent: z.string().min(1),
    sentiment: z.number().min(-1).max(1),
    frustration_markers: z.array(z.enum(FRUSTRATION_MARKERS)),
    is_repeat: z.boolean(),
  })
  .strict();

export const SignalExtractionSchema = z
  .object({
    signals: z.array(TurnSignalSchema),
  })
  .strict();

export type TurnSignal = z.infer<typeof TurnSignalSchema>;
export type SignalExtraction = z.infer<typeof SignalExtractionSchema>;

export const signalExtractionJsonSchema = (() => {
  const full = zodToJsonSchema(SignalExtractionSchema, {
    name: "signal_extraction",
    $refStrategy: "none",
  }) as { definitions?: Record<string, unknown> };
  return (full.definitions?.signal_extraction ?? full) as Record<string, unknown>;
})();
