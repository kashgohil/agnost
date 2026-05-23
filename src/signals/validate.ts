// Post-extraction validation: the LLM must return exactly one signal per
// user turn — no missing, no extras, no hallucinated turn_ids.
//
// Failure here triggers a corrective retry in extract.ts. We don't silently
// drop unknown turn_ids or paper over missing ones because the rest of the
// pipeline assumes signal coverage matches user-turn coverage.

import type { TurnSignal } from "./schema.ts";

export type SignalValidationResult =
  | { ok: true }
  | { ok: false; reason: string; missing: string[]; extra: string[] };

export function validateSignalCoverage(
  signals: TurnSignal[],
  expectedUserTurnIds: string[],
): SignalValidationResult {
  const expected = new Set(expectedUserTurnIds);
  const got = new Set(signals.map((s) => s.turn_id));

  const missing = expectedUserTurnIds.filter((id) => !got.has(id));
  const extra = signals.map((s) => s.turn_id).filter((id) => !expected.has(id));

  // Catch duplicates: a model that emits "t1" twice satisfies neither set
  // semantics nor downstream invariants.
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const s of signals) {
    if (seen.has(s.turn_id)) duplicates.push(s.turn_id);
    seen.add(s.turn_id);
  }

  if (missing.length === 0 && extra.length === 0 && duplicates.length === 0) {
    return { ok: true };
  }

  const reasons: string[] = [];
  if (missing.length > 0) reasons.push(`missing signals for: ${missing.join(", ")}`);
  if (extra.length > 0) reasons.push(`unknown turn_ids: ${extra.join(", ")}`);
  if (duplicates.length > 0) reasons.push(`duplicate turn_ids: ${duplicates.join(", ")}`);

  return { ok: false, reason: reasons.join("; "), missing, extra };
}
