// Scenario YAML shapes + derived types used across the dataset generator.

export type ToolFailureRule = {
  condition: string;
  outcome: "success" | "error" | "empty_result";
  error_message?: string;
  note?: string;
};

export type Tool = {
  name: string;
  description: string;
  failure_rules: ToolFailureRule[];
};

export type SkeletonToolCall = {
  tool: string;
  outcome: "success" | "error" | "empty_result";
  error_signature?: string;
};

export type SkeletonSpec = {
  user_goal: string;
  narrative: string;
  expected_user_sentiment: string;
  expected_end_reason: string;
  key_phrases: string[];
  tool_call_pattern: SkeletonToolCall[];
};

export type AttributedCause = { tool: string; failure_signature: string };

export type FailureMode = {
  id: string;
  target_count: number;
  expected_insight_type: string | null;
  expected_attributed_cause: AttributedCause | null;
  week_distribution: number[];
  skeletons: SkeletonSpec[];
};

export type Scenario = {
  domain: string;
  agent_id: string;
  agent_persona: string;
  tools: Tool[];
  time_window: { start: string; weeks: number };
  failure_modes: FailureMode[];
};

// A skeleton enriched with the mode-level fields needed by the generator and
// ground-truth output. Built by scenario.ts when flattening modes.
export type Skeleton = SkeletonSpec & {
  mode_id: string;
  skeleton_index: number;
  expected_insight_type: string | null;
  expected_attributed_cause: AttributedCause | null;
};

export type GroundTruthRow = {
  conversation_id: string;
  mode_id: string;
  skeleton_index: number;
  week_idx: number;
  expected_insight_type: string | null;
  expected_attributed_cause: AttributedCause | null;
  expected_user_sentiment: string;
  expected_end_reason: string;
};

// OTEL-shaped output written to disk per conversation.
export type EnrichedToolCall = {
  tool_call_id: string;
  tool_name: string;
  input_summary: string;
  status: string;
  output: string;
  latency_ms: number;
  timestamp: string;
};

export type EnrichedTurn = {
  turn_id: string;
  role: string;
  content: string;
  timestamp: string;
  tool_calls: EnrichedToolCall[];
};

export type ConversationRecord = {
  conversation_id: string;
  agent_id: string;
  started_at: string;
  ended_at: string;
  end_reason: string;
  turns: EnrichedTurn[];
};
