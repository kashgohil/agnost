// Inbound payload schema for POST /v1/traces.
//
// The shape matches OpenInference-style agent conversation records (one
// document per agent run, turns inline with tool-call spans nested in
// assistant turns). REASONING.md defends the choice of conversation-as-document
// vs raw OTEL span stream — the conversion happens client-side and a real OTEL
// collector adapter is a v2 concern, not a weekend concern.

import { z } from "zod";

const Iso = z.string().datetime({ offset: true });

export const InboundToolCallSchema = z
  .object({
    tool_call_id: z.string().min(1),
    tool_name: z.string().min(1),
    input_summary: z.string(),
    status: z.enum(["success", "error", "empty_result"]),
    output: z.string(),
    latency_ms: z.number().int().nonnegative(),
    timestamp: Iso,
  })
  .strict();

export const InboundTurnSchema = z
  .object({
    turn_id: z.string().min(1),
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    timestamp: Iso,
    tool_calls: z.array(InboundToolCallSchema),
  })
  .strict();

export const InboundConversationSchema = z
  .object({
    conversation_id: z.string().min(1),
    agent_id: z.string().min(1),
    started_at: Iso,
    ended_at: Iso,
    end_reason: z.string().min(1),
    turns: z.array(InboundTurnSchema).min(1),
  })
  .strict();

export type InboundConversation = z.infer<typeof InboundConversationSchema>;
export type InboundTurn = z.infer<typeof InboundTurnSchema>;
export type InboundToolCall = z.infer<typeof InboundToolCallSchema>;
