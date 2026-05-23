// Sync distinct intents from turn_signals into the intents table.
// Idempotent: only adds new intent strings, leaves embeddings/clusters intact
// on existing rows.

import { sql } from "drizzle-orm";

import { db, schema } from "../db/client.ts";

export async function syncIntents(): Promise<{ added: number; total: number }> {
  // Pull every distinct intent string we've seen in any signal.
  const seen = await db
    .selectDistinct({ intent: schema.turnSignals.intent })
    .from(schema.turnSignals);

  if (seen.length === 0) return { added: 0, total: 0 };

  const rows = seen.map((r) => ({ intent: r.intent }));

  // ON CONFLICT DO NOTHING — preserves embedding/cluster fields on existing intents.
  const inserted = await db
    .insert(schema.intents)
    .values(rows)
    .onConflictDoNothing({ target: schema.intents.intent })
    .returning({ intent: schema.intents.intent });

  const totalRow = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM ${schema.intents}`,
  );
  return {
    added: inserted.length,
    total: Number(totalRow[0]?.count ?? 0),
  };
}
