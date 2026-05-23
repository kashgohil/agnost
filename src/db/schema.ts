// Database schema for ingestion-side tables. Signal/cluster/insight tables
// land alongside their respective pipeline tasks — keeping this file scoped
// to what's actually wired up avoids dead schema.

import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    endReason: text("end_reason").notNull(),
    // Original payload retained verbatim so the pipeline can be re-run without
    // re-ingesting upstream. Cheap insurance; storage is not the bottleneck.
    raw: jsonb("raw").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("conversations_started_at_idx").on(t.startedAt),
    index("conversations_agent_id_idx").on(t.agentId),
  ],
);

export const turns = pgTable(
  "turns",
  {
    id: text("id").primaryKey(), // e.g. "conv_0001_xxx:t3"
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    turnIndex: integer("turn_index").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("turns_conversation_idx").on(t.conversationId),
    index("turns_role_idx").on(t.role),
  ],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: text("id").primaryKey(), // e.g. "conv_0001_xxx:t3:tc1"
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    toolCallIndex: integer("tool_call_index").notNull(),
    toolName: text("tool_name").notNull(),
    inputSummary: text("input_summary").notNull(),
    status: text("status", { enum: ["success", "error", "empty_result"] }).notNull(),
    output: text("output").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("tool_calls_turn_idx").on(t.turnId),
    index("tool_calls_tool_name_status_idx").on(t.toolName, t.status),
  ],
);

// One row per USER turn that has been processed by the signal extractor.
// Assistant turns are skipped — signals are about user intent/sentiment, not
// agent output. `intent` is a short canonical phrase (e.g. "refund_old_order")
// — what gets clustered later. See REASONING.md for why we cluster on
// structured intents instead of raw text embeddings.
//
// `frustration_markers` is text[] (not jsonb) so we can put a GIN index on it
// and run queries like "clusters with high `escalation_request` marker density"
// directly in SQL.
export const turnSignals = pgTable(
  "turn_signals",
  {
    turnId: text("turn_id")
      .primaryKey()
      .references(() => turns.id, { onDelete: "cascade" }),
    intent: text("intent").notNull(),
    sentiment: doublePrecision("sentiment").notNull(), // -1 (very negative) to 1 (very positive)
    frustrationMarkers: text("frustration_markers").array().notNull(),
    isRepeat: boolean("is_repeat").notNull(),
    extractedAt: timestamp("extracted_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("turn_signals_intent_idx").on(t.intent),
    index("turn_signals_frustration_markers_idx").using("gin", t.frustrationMarkers),
  ],
);

// One row per cluster — the actual PM/engineer-facing analytics output.
// `tags` is a fixed-vocabulary multi-axis label set (see src/insights/typology.ts).
// `taxonomy_version` records which vocab generated this row so historical
// insights remain comparable when the taxonomy evolves.
export const insights = pgTable(
  "insights",
  {
    id: text("id").primaryKey(), // "insight_0001"
    clusterId: text("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    tags: text("tags").array().notNull(),
    taxonomyVersion: integer("taxonomy_version").notNull(),
    headline: text("headline").notNull(),
    // The insight content beyond the headline. Recommendation tells the PM
    // what to consider doing; key_observation is an optional specific finding
    // from the cluster's samples that wouldn't be obvious from aggregates.
    recommendation: text("recommendation").notNull(),
    keyObservation: text("key_observation"),
    volumePct: doublePrecision("volume_pct").notNull(),
    conversationCount: integer("conversation_count").notNull(),
    sentimentAvg: doublePrecision("sentiment_avg").notNull(),
    weeklyVolume: integer("weekly_volume").array().notNull(),
    attributedCause: jsonb("attributed_cause").$type<{ tool: string; failure_rate: number } | null>(),
    markerDistribution: jsonb("marker_distribution").$type<Record<string, number>>().notNull(),
    endReasonDistribution: jsonb("end_reason_distribution").$type<Record<string, number>>().notNull(),
    exampleConversationIds: text("example_conversation_ids").array().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("insights_tags_idx").using("gin", t.tags),
    index("insights_cluster_id_idx").on(t.clusterId),
  ],
);

// Clusters of semantically-related intents. Re-clusterable: TRUNCATE clusters
// then re-run; intent embeddings on `intents` are preserved. `member_count` is
// denormalized for fast filtering.
export const clusters = pgTable("clusters", {
  id: text("id").primaryKey(), // "cluster_0001"
  label: text("label").notNull(),
  memberCount: integer("member_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// One row per UNIQUE intent string across the corpus. Embedded once, then
// reused across re-clustering runs. cluster_id is nullable: HDBSCAN noise
// points and not-yet-clustered intents both sit at NULL.
export const intents = pgTable(
  "intents",
  {
    intent: text("intent").primaryKey(),
    embedding: vector("embedding", { dimensions: 1536 }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    clusterId: text("cluster_id").references(() => clusters.id, { onDelete: "set null" }),
    probability: doublePrecision("probability"),
    clusteredAt: timestamp("clustered_at", { withTimezone: true }),
    // 2D UMAP projection of the embedding, used by the Clusters view scatter.
    // Computed during clustering; nulled if the run skips UMAP for any reason.
    positionX: doublePrecision("position_x"),
    positionY: doublePrecision("position_y"),
  },
  (t) => [
    index("intents_cluster_id_idx").on(t.clusterId),
    // HNSW index for ANN lookups if we ever need them. cosine distance to match
    // our cluster-time distance metric.
    index("intents_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);
