// Persist a validated conversation to Postgres.
//
// Idempotent on conversation_id — re-POSTing the same payload is a no-op,
// not an error. Useful because the bulk ingest script and any retry path will
// re-send conversations we've already seen.

import { eq } from "drizzle-orm";

import { db, schema } from "../../db/client.ts";
import type { InboundConversation } from "./schema.ts";

export type IngestResult =
  | { conversation_id: string; status: "ingested" }
  | { conversation_id: string; status: "already_ingested" };

// Globally unique IDs for turns and tool_calls — composite so any row is
// traceable back to its conversation without a join.
const turnDbId = (convId: string, turnId: string) => `${convId}:${turnId}`;
const toolCallDbId = (convId: string, turnId: string, toolCallId: string) =>
  `${convId}:${turnId}:${toolCallId}`;

export async function persistConversation(
  payload: InboundConversation,
): Promise<IngestResult> {
  const existing = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, payload.conversation_id))
    .limit(1);

  if (existing.length > 0) {
    return { conversation_id: payload.conversation_id, status: "already_ingested" };
  }

  const turnRows = payload.turns.map((turn, i) => ({
    id: turnDbId(payload.conversation_id, turn.turn_id),
    conversationId: payload.conversation_id,
    turnIndex: i,
    role: turn.role,
    content: turn.content,
    timestamp: new Date(turn.timestamp),
  }));

  const toolCallRows = payload.turns.flatMap((turn) =>
    turn.tool_calls.map((tc, j) => ({
      id: toolCallDbId(payload.conversation_id, turn.turn_id, tc.tool_call_id),
      turnId: turnDbId(payload.conversation_id, turn.turn_id),
      toolCallIndex: j,
      toolName: tc.tool_name,
      inputSummary: tc.input_summary,
      status: tc.status,
      output: tc.output,
      latencyMs: tc.latency_ms,
      timestamp: new Date(tc.timestamp),
    })),
  );

  await db.transaction(async (tx) => {
    await tx.insert(schema.conversations).values({
      id: payload.conversation_id,
      agentId: payload.agent_id,
      startedAt: new Date(payload.started_at),
      endedAt: new Date(payload.ended_at),
      endReason: payload.end_reason,
      raw: payload,
    });
    if (turnRows.length > 0) await tx.insert(schema.turns).values(turnRows);
    if (toolCallRows.length > 0) await tx.insert(schema.toolCalls).values(toolCallRows);
  });

  return { conversation_id: payload.conversation_id, status: "ingested" };
}
