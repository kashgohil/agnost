// Batch signal extractor.
//
// Default mode: only conversations with at least one unscored user turn.
// Resumable — re-running picks up where a crash left off.
// --force mode: re-extracts every conversation (overwrites prior signals).
//   Useful when iterating on the prompt or switching models.
//
// Conversation-granularity, not turn-granularity, because is_repeat detection
// requires the full transcript in one prompt. When a conversation has some
// scored and some unscored turns, we re-extract the whole thing and upsert.

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { Semaphore } from "../lib/concurrency.ts";
import { extractSignals } from "./extract.ts";
import { persistSignals } from "./persist.ts";

type ConvForExtract = {
  conversation_id: string;
  turns: Array<{ turn_id: string; role: "user" | "assistant"; content: string }>;
};

async function loadTargetConversationIds(opts: {
  force: boolean;
  limit?: number;
}): Promise<string[]> {
  if (opts.force) {
    const q = db
      .selectDistinct({ conversationId: schema.conversations.id })
      .from(schema.conversations)
      .orderBy(asc(schema.conversations.id));
    const rows = opts.limit ? await q.limit(opts.limit) : await q;
    return rows.map((r) => r.conversationId);
  }

  // Conversations with at least one unscored user turn.
  const q = db
    .selectDistinct({ conversationId: schema.turns.conversationId })
    .from(schema.turns)
    .leftJoin(schema.turnSignals, eq(schema.turnSignals.turnId, schema.turns.id))
    .where(and(eq(schema.turns.role, "user"), isNull(schema.turnSignals.turnId)))
    .orderBy(asc(schema.turns.conversationId));
  const rows = opts.limit ? await q.limit(opts.limit) : await q;
  return rows.map((r) => r.conversationId);
}

async function loadConversations(convIds: string[]): Promise<ConvForExtract[]> {
  if (convIds.length === 0) return [];

  const turnRows = await db
    .select({
      conversationId: schema.turns.conversationId,
      id: schema.turns.id,
      role: schema.turns.role,
      content: schema.turns.content,
      turnIndex: schema.turns.turnIndex,
    })
    .from(schema.turns)
    .where(inArray(schema.turns.conversationId, convIds))
    .orderBy(asc(schema.turns.conversationId), asc(schema.turns.turnIndex));

  const grouped = new Map<string, ConvForExtract>();
  for (const row of turnRows) {
    // Strip the composite "conv_xxx:t3" prefix back to the local "t3" form
    // the LLM saw at generation time.
    const localTurnId = row.id.slice(row.conversationId.length + 1);
    const entry = grouped.get(row.conversationId) ?? {
      conversation_id: row.conversationId,
      turns: [],
    };
    entry.turns.push({
      turn_id: localTurnId,
      role: row.role as "user" | "assistant",
      content: row.content,
    });
    grouped.set(row.conversationId, entry);
  }
  return Array.from(grouped.values());
}

export type ExtractStats = {
  attempted: number;
  succeeded: number;
  failed: number;
};

export async function runSignalExtraction(opts: {
  model: string;
  concurrency: number;
  force?: boolean;
  limit?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<ExtractStats> {
  const convIds = await loadTargetConversationIds({
    force: opts.force ?? false,
    limit: opts.limit,
  });
  const convs = await loadConversations(convIds);
  const total = convs.length;
  let succeeded = 0;
  let failed = 0;
  let done = 0;

  const sem = new Semaphore(opts.concurrency);
  await Promise.all(
    convs.map((conv) =>
      sem.run(async () => {
        try {
          const out = await extractSignals(conv, opts.model);
          await persistSignals(conv.conversation_id, out.signals);
          succeeded++;
        } catch (err) {
          failed++;
          process.stderr.write(
            `\n[error] ${conv.conversation_id}: ${(err as Error).message}\n`,
          );
        } finally {
          done++;
          opts.onProgress?.(done, total);
        }
      }),
    ),
  );

  return { attempted: total, succeeded, failed };
}
