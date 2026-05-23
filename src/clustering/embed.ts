// Embed any intent strings that don't yet have a vector. Batched, idempotent.
//
// OpenRouter's embeddings endpoint is OpenAI-compatible so the openai SDK
// works without a separate client. We use a server-side singleton.

import { eq, isNull, sql } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { openrouter } from "../llm/openrouter.ts";
import { withLlmRetry } from "../llm/retry.ts";

const BATCH_SIZE = 100; // text-embedding-3-small accepts up to 2048 inputs per call; 100 is plenty for sane batching.

export async function embedMissingIntents(model: string): Promise<{ embedded: number }> {
  const pending = await db
    .select({ intent: schema.intents.intent })
    .from(schema.intents)
    .where(isNull(schema.intents.embedding));

  if (pending.length === 0) return { embedded: 0 };

  let embedded = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const inputs = batch.map((r) => r.intent);

    const resp = await withLlmRetry(() =>
      openrouter().embeddings.create({
        model,
        input: inputs,
      }),
    );

    // OpenAI guarantees response order matches input order.
    if (resp.data.length !== batch.length) {
      throw new Error(
        `Embedding response length mismatch: sent ${batch.length}, got ${resp.data.length}`,
      );
    }

    // Updates need to run individually because Drizzle doesn't expose a clean
    // batch-update-with-different-values primitive. Each is fast — a single
    // UPDATE WHERE intent = $1.
    for (let j = 0; j < batch.length; j++) {
      const vec = resp.data[j]!.embedding;
      const intent = batch[j]!.intent;
      await db
        .update(schema.intents)
        .set({
          embedding: vec,
          embeddedAt: sql`now()`,
        })
        .where(eq(schema.intents.intent, intent));
      embedded++;
    }
  }

  return { embedded };
}
