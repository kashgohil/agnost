// API response types — mirrors the backend insight shape.
// Keep in sync with src/server/insights/queries.ts on the backend.

export type AttributedCause = { tool: string; failure_rate: number };

export type Insight = {
  id: string;
  cluster_id: string;
  cluster_label: string;
  tags: string[];
  taxonomy_version: number;
  headline: string;
  recommendation: string;
  key_observation: string | null;
  volume_pct: number;
  conversation_count: number;
  sentiment_avg: number;
  weekly_volume: number[];
  attributed_cause: AttributedCause | null;
  marker_distribution: Record<string, number>;
  end_reason_distribution: Record<string, number>;
  example_conversation_ids: string[];
  generated_at: string;
};

export type ListInsightsResponse = {
  insights: Insight[];
  total: number;
  taxonomy_version: number | null;
};

export type EvalSetConversation = {
  conversation_id: string;
  agent_id: string;
  started_at: string;
  ended_at: string;
  end_reason: string;
  turns: Array<{
    turn_id: string;
    role: string;
    content: string;
    timestamp: string;
    tool_calls: Array<{
      tool_call_id: string;
      tool_name: string;
      input_summary: string;
      status: string;
      output: string;
      latency_ms: number;
      timestamp: string;
    }>;
  }>;
};

export type EvalSetResponse = {
  insight_id: string;
  headline: string;
  tags: string[];
  attributed_cause: AttributedCause | null;
  total: number;
  limit: number;
  offset: number;
  conversations: EvalSetConversation[];
};

export type ClusterRow = {
  id: string;
  label: string;
  member_count: number;
  insight_id: string | null;
  insight_tags: string[] | null;
  sample_intents: string[];
  sample_messages: string[];
};

export type IntentRow = {
  intent: string;
  cluster_id: string | null;
  probability: number | null;
  position_x: number;
  position_y: number;
};

export type ClustersResponse = {
  clusters: ClusterRow[];
  intents: IntentRow[];
};

export const PROBLEM_TAGS = [
  "capability_gap",
  "tool_failure",
  "agent_reasoning_gap",
  "friction",
  "drop_off",
  "latency",
  "success_pattern",
  "uncategorized",
] as const;

export const TRAJECTORY_TAGS = ["emerging", "chronic", "declining", "stable"] as const;

export const SEVERITY_TAGS = ["high", "medium", "low"] as const;

export function tagAxis(tag: string): "problem" | "trajectory" | "severity" | "unknown" {
  if ((PROBLEM_TAGS as readonly string[]).includes(tag)) return "problem";
  if ((TRAJECTORY_TAGS as readonly string[]).includes(tag)) return "trajectory";
  if ((SEVERITY_TAGS as readonly string[]).includes(tag)) return "severity";
  return "unknown";
}
