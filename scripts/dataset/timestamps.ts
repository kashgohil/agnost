// Synthesize timestamps for a generated conversation:
//   - A start time within the assigned week (business hours).
//   - Realistic gaps between turns (longer for user turns — thinking/typing —
//     shorter for assistant turns) plus tool-call latencies.

import { randInt } from "./rng.ts";
import type { GeneratedConversation } from "./schema.ts";
import type { EnrichedTurn } from "./types.ts";

export function randomTimestamp(
  weekIdx: number,
  windowStart: Date,
  rng: () => number,
): Date {
  const dayOffset = randInt(rng, 0, 6);
  const hour = randInt(rng, 8, 20);
  const minute = randInt(rng, 0, 59);
  const second = randInt(rng, 0, 59);
  const ts = new Date(windowStart);
  ts.setUTCDate(ts.getUTCDate() + weekIdx * 7 + dayOffset);
  ts.setUTCHours(hour, minute, second, 0);
  return ts;
}

export function attachTimestamps(
  turns: GeneratedConversation["turns"],
  startedAt: Date,
  rng: () => number,
): { turns: EnrichedTurn[]; endedAt: Date } {
  let cursor = new Date(startedAt);
  const enriched: EnrichedTurn[] = [];

  turns.forEach((turn, i) => {
    const gapSeconds =
      turn.role === "user" ? randInt(rng, 15, 90) : randInt(rng, 2, 8);
    cursor = new Date(cursor.getTime() + gapSeconds * 1000);

    const turnId = `t${i + 1}`;
    const enrichedToolCalls = turn.tool_calls.map((tc, j) => {
      cursor = new Date(cursor.getTime() + tc.latency_ms);
      return {
        tool_call_id: `${turnId}_tc${j + 1}`,
        tool_name: tc.tool_name,
        input_summary: tc.input_summary,
        status: tc.status,
        output: tc.output,
        latency_ms: tc.latency_ms,
        timestamp: cursor.toISOString(),
      };
    });

    enriched.push({
      turn_id: turnId,
      role: turn.role,
      content: turn.content,
      timestamp: cursor.toISOString(),
      tool_calls: enrichedToolCalls,
    });
  });

  return { turns: enriched, endedAt: cursor };
}
