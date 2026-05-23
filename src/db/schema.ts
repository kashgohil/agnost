// Database schema for ingestion-side tables. Signal/cluster/insight tables
// land alongside their respective pipeline tasks — keeping this file scoped
// to what's actually wired up avoids dead schema.

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
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
  (t) => ({
    startedAtIdx: index("conversations_started_at_idx").on(t.startedAt),
    agentIdIdx: index("conversations_agent_id_idx").on(t.agentId),
  }),
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
  (t) => ({
    conversationIdx: index("turns_conversation_idx").on(t.conversationId),
    roleIdx: index("turns_role_idx").on(t.role),
  }),
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
  (t) => ({
    turnIdx: index("tool_calls_turn_idx").on(t.turnId),
    toolNameStatusIdx: index("tool_calls_tool_name_status_idx").on(t.toolName, t.status),
  }),
);
