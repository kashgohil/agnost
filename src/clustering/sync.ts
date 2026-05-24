// Sync distinct intents from turn_signals into the intents table.
// Idempotent — existing intents keep their embedding/cluster.

import { sql } from "drizzle-orm";

import { db, schema } from "../db/client.ts";

export async function syncIntents(): Promise<{ added: number; total: number }> {
  const seen = await db
    .selectDistinct({ intent: schema.turnSignals.intent })
    .from(schema.turnSignals);

  if (seen.length === 0) return { added: 0, total: 0 };

  const rows = seen.map((r) => ({ intent: r.intent }));

  const inserted = await db
    .insert(schema.intents)
    .values(rows)
    .onConflictDoNothing({ target: schema.intents.intent })
    .returning({ intent: schema.intents.intent });

  const totalRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.intents);
  return {
    added: inserted.length,
    total: Number(totalRow[0]?.count ?? 0),
  };
}
