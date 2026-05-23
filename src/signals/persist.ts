// Persist extracted signals to the turn_signals table. Idempotent on turn_id:
// re-running with new prompt/model overwrites prior signals via an upsert.

import { sql } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import type { TurnSignal } from "./schema.ts";

// DB IDs use the composite form "conv_xxx:t1"; the LLM only sees the local
// "t1" form. Caller passes the conversation_id so we can re-attach the prefix.
const turnDbId = (convId: string, localTurnId: string) => `${convId}:${localTurnId}`;

export async function persistSignals(
  conversationId: string,
  signals: TurnSignal[],
): Promise<void> {
  if (signals.length === 0) return;

  const rows = signals.map((s) => ({
    turnId: turnDbId(conversationId, s.turn_id),
    intent: s.intent,
    sentiment: s.sentiment,
    frustrationMarkers: s.frustration_markers,
    isRepeat: s.is_repeat,
  }));

  await db
    .insert(schema.turnSignals)
    .values(rows)
    .onConflictDoUpdate({
      target: schema.turnSignals.turnId,
      set: {
        intent: sql`EXCLUDED.intent`,
        sentiment: sql`EXCLUDED.sentiment`,
        frustrationMarkers: sql`EXCLUDED.frustration_markers`,
        isRepeat: sql`EXCLUDED.is_repeat`,
        extractedAt: sql`now()`,
      },
    });
}
