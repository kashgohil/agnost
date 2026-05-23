// The insight typology: three orthogonal tag axes.
//
// Fixed vocabulary — see REASONING.md for the "structured layer is closed,
// content layer is open" argument. Domain-specific richness lives in cluster
// labels (LLM-generated), not in invented tag strings.
//
// Adding a new tag:
//   1. Append to the relevant axis array below.
//   2. Add or update a classification rule in `classifyCluster`.
//   3. Bump TAXONOMY_VERSION.
//   4. Run `bun generate-insights --force` to re-tag historical insights.
//
// Removing a tag: same flow, but verify no insight queries depend on the
// removed tag string first.

export const TAXONOMY_VERSION = 1;

// Changelog (keep in sync with TAXONOMY_VERSION):
// v1 (2026-05-24): initial — 7 problem categories, 4 trajectories, 3 severities.

export const PROBLEM_TAGS = [
  "capability_gap",      // no tool exists for the user's intent
  "tool_failure",        // tool exists but consistently errors
  "agent_reasoning_gap", // tool exists, agent doesn't pick the right one
  "friction",            // repeated turns, retries, escalation
  "drop_off",            // users abandon without resolution
  "latency",             // interactions that drag on
  "success_pattern",     // positive clusters worth amplifying
  "uncategorized",       // didn't match any rule — visible breadcrumb that the taxonomy needs work
] as const;

export const TRAJECTORY_TAGS = [
  "emerging",  // sharp growth (>50% second-half vs first-half)
  "chronic",   // persistent across the window
  "declining", // shrinking
  "stable",    // minor fluctuation
] as const;

export const SEVERITY_TAGS = [
  "high",   // large volume AND (bad sentiment OR high drop-off)
  "medium", // moderate
  "low",    // small volume, edge cases
] as const;

export type ProblemTag = (typeof PROBLEM_TAGS)[number];
export type TrajectoryTag = (typeof TRAJECTORY_TAGS)[number];
export type SeverityTag = (typeof SEVERITY_TAGS)[number];
export type InsightTag = ProblemTag | TrajectoryTag | SeverityTag;

// Thresholds — exposed so REASONING.md can defend the numbers and a future
// config layer can override them per environment.
export const THRESHOLDS = {
  capabilityGapMaxToolCallsPerConv: 0.5,
  dropOffMinRate: 0.5,
  toolFailureMinRate: 0.5,
  complaintMaxSentiment: -0.3,
  frictionMinRepeatRate: 0.3,
  frictionMinTurnsPerConv: 1.5,
  successMinSentiment: 0.4,
  latencyMinAvgMs: 1500,
  emergingMinGrowth: 0.5, // 50% growth, second-half vs first-half
  decliningMinShrink: 0.3,
  trajectoryStableBand: 0.15,
  severityHighMinVolume: 0.05, // 5% of conversations
  severityHighMinSentimentBad: -0.3,
  severityHighMinDropOff: 0.3,
  severityLowMaxVolume: 0.02,
} as const;

// Everything aggregate.ts computes per cluster. Some fields drive classification
// (sentiment, repeat rate, etc.), others are pass-through for persistence
// (example_conversation_ids). One shape so pipeline.ts doesn't have to juggle
// multiple maps.
export type ClusterMetrics = {
  cluster_id: string;
  cluster_label: string;
  conversation_count: number;
  total_conversations: number;
  volume_pct: number;
  sentiment_avg: number;
  weekly_volume: number[];
  avg_tool_calls_per_conv: number;
  is_repeat_rate: number;
  end_reason_distribution: Record<string, number>;
  marker_distribution: Record<string, number>;
  attributed_cause: { tool: string; failure_rate: number } | null;
  avg_latency_ms: number;
  top_intents: Array<{ intent: string; turn_count: number }>;
  example_conversation_ids: string[];
  sample_messages: string[];
};

// Not every clustered user turn is a PM-worthy topic. These are common
// conversation mechanics that cut across many real problems and otherwise
// become noisy "insights" like "users provide order IDs".
const NON_TOPIC_INTENT_PATTERNS = [
  /^acknowledge$/,
  /^provide_/,
  /^accept_/,
  /^store_credit/,
  /^escalation_request$/,
  /^escalate_issue$/,
  /^negative_feedback$/,
  /^abandon(ment)?_/,
] as const;

export function shouldSurfaceCluster(m: ClusterMetrics): boolean {
  const topIntent = m.top_intents[0]?.intent;
  const isNonTopic = topIntent
    ? NON_TOPIC_INTENT_PATTERNS.some((pattern) => pattern.test(topIntent))
    : false;

  if (isNonTopic) return false;

  const dropOffRate = m.end_reason_distribution["user_dropped"] ?? 0;
  const escalationRate = m.end_reason_distribution["escalated"] ?? 0;
  const hasProblemSignal =
    m.sentiment_avg < 0 ||
    dropOffRate >= 0.2 ||
    escalationRate >= 0.2 ||
    m.attributed_cause !== null ||
    m.avg_tool_calls_per_conv < THRESHOLDS.capabilityGapMaxToolCallsPerConv;

  const hasSuccessSignal = m.sentiment_avg > THRESHOLDS.successMinSentiment;
  return hasProblemSignal || hasSuccessSignal;
}

// Returns the full tag set for a cluster across all three axes.
export function classifyCluster(m: ClusterMetrics): {
  problem: ProblemTag;
  trajectory: TrajectoryTag;
  severity: SeverityTag;
} {
  return {
    problem: classifyProblem(m),
    trajectory: classifyTrajectory(m),
    severity: classifySeverity(m),
  };
}

function classifyProblem(m: ClusterMetrics): ProblemTag {
  // Order matters — most specific rules first.

  if (m.avg_tool_calls_per_conv < THRESHOLDS.capabilityGapMaxToolCallsPerConv) {
    return "capability_gap";
  }

  const dropOffRate = m.end_reason_distribution["user_dropped"] ?? 0;
  if (dropOffRate > THRESHOLDS.dropOffMinRate) {
    return "drop_off";
  }

  if (
    m.attributed_cause !== null &&
    m.attributed_cause.failure_rate > THRESHOLDS.toolFailureMinRate &&
    m.sentiment_avg < THRESHOLDS.complaintMaxSentiment
  ) {
    return "tool_failure";
  }

  if (
    m.is_repeat_rate > THRESHOLDS.frictionMinRepeatRate ||
    (m.attributed_cause !== null &&
      m.attributed_cause.failure_rate > THRESHOLDS.toolFailureMinRate &&
      m.sentiment_avg < 0)
  ) {
    return "friction";
  }

  // Tool exists, agent calls it, but sentiment still bad and no clear single
  // tool failure → likely the agent is picking the wrong tool or going in
  // circles on its own reasoning. Heuristic; refine with eval data.
  if (m.sentiment_avg < THRESHOLDS.complaintMaxSentiment && m.attributed_cause === null) {
    return "agent_reasoning_gap";
  }

  if (m.avg_latency_ms > THRESHOLDS.latencyMinAvgMs && m.sentiment_avg < 0) {
    return "latency";
  }

  if (m.sentiment_avg > THRESHOLDS.successMinSentiment) {
    return "success_pattern";
  }

  return "uncategorized";
}

function classifyTrajectory(m: ClusterMetrics): TrajectoryTag {
  const n = m.weekly_volume.length;
  if (n < 2) return "stable";

  const half = Math.floor(n / 2);
  const firstHalf = m.weekly_volume.slice(0, half).reduce((a, b) => a + b, 0);
  const secondHalf = m.weekly_volume.slice(half).reduce((a, b) => a + b, 0);

  if (firstHalf === 0 && secondHalf > 0) return "emerging";
  if (firstHalf === 0) return "stable";

  const growth = (secondHalf - firstHalf) / firstHalf;
  if (growth > THRESHOLDS.emergingMinGrowth) return "emerging";
  if (growth < -THRESHOLDS.decliningMinShrink) return "declining";
  if (Math.abs(growth) < THRESHOLDS.trajectoryStableBand) return "chronic";
  // Moderate flux → also call it chronic. Distinguishing "stable" from
  // "chronic" is a domain call; "chronic" implies it's been around a while.
  return "chronic";
}

function classifySeverity(m: ClusterMetrics): SeverityTag {
  const dropOffRate = m.end_reason_distribution["user_dropped"] ?? 0;
  const isHighVolume = m.volume_pct >= THRESHOLDS.severityHighMinVolume;
  const isBadOutcome =
    m.sentiment_avg <= THRESHOLDS.severityHighMinSentimentBad ||
    dropOffRate >= THRESHOLDS.severityHighMinDropOff;

  if (isHighVolume && isBadOutcome) return "high";
  if (m.volume_pct <= THRESHOLDS.severityLowMaxVolume) return "low";
  return "medium";
}
