// Generate the human-facing content of an insight: headline + recommendation
// + optional key observation. One LLM call producing structured JSON.
//
// Why three fields instead of one headline: a number on its own is data, not
// an insight. The PM gets metrics in the stat tower already; this layer adds
// the pattern (headline), the so-what (recommendation), and ideally a
// specific finding the aggregates don't immediately reveal (key observation).

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { openrouter } from "../llm/openrouter.ts";
import { withLlmRetry } from "../llm/retry.ts";
import type { ClusterMetrics } from "./typology.ts";

const ContentSchema = z
  .object({
    headline: z.string().min(1).max(120),
    recommendation: z.string().min(1).max(280),
    key_observation: z.string().max(280).nullable(),
  })
  .strict();

export type InsightContent = z.infer<typeof ContentSchema>;

const contentJsonSchema = (() => {
  const full = zodToJsonSchema(ContentSchema, {
    name: "content",
    $refStrategy: "none",
  }) as { definitions?: Record<string, unknown> };
  return (full.definitions?.content ?? full) as Record<string, unknown>;
})();

export async function generateContent(
  m: ClusterMetrics,
  tags: { problem: string; trajectory: string; severity: string },
  sampleMessages: string[],
  model: string,
): Promise<InsightContent> {
  const causeBlurb = m.attributed_cause
    ? `\nAttributed cause: tool "${m.attributed_cause.tool}" fails ${Math.round(m.attributed_cause.failure_rate * 100)}% of the time within this cluster's conversations. This IS the mechanism behind the cluster — name it and act on it.`
    : `\nNo tool failure is attributable to this cluster. Either no tool is being called (capability gap) or the failure isn't isolated to one tool.`;

  const samplesBlock = sampleMessages.length
    ? `\n\nReal user messages from this cluster (use to ground specifics — do not directly quote):\n${sampleMessages.map((s) => `- "${s}"`).join("\n")}`
    : "";

  // Top intents give the LLM a compact view of what's actually in the cluster
  // beyond the LLM-generated label. Helps it write more specific
  // recommendations grounded in the canonical intent strings, not just samples.
  const topIntentsBlock = m.top_intents.length
    ? `\n\nDominant intent strings in this cluster (canonical phrasings, with their turn counts):\n${m.top_intents.map((ti) => `- ${ti.intent} (${ti.turn_count} turns)`).join("\n")}`
    : "";

  const tagGuidance = guidanceFor(tags.problem);

  const partitionBlurb = partitionGuidance(m.partition);

  const prompt = `You are turning analytics into an actionable insight for a product manager. The PM has already seen the volume %, sentiment, trend, and tool attribution on the card. Your job is to produce the INSIGHT — not restate the metrics.

This insight is one *outcome slice* of a topic cluster. The cluster is the topic; the partition is what happened to users on this topic. There may be other insights from the same cluster covering different outcomes.

Cluster label (topic): ${m.cluster_label}
Outcome partition: ${m.partition} — ${partitionBlurb}
Problem tag: ${tags.problem} — ${tagGuidance}
Trajectory: ${tags.trajectory}
Severity: ${tags.severity}
Conversations in this partition: ${m.conversation_count} (${(m.volume_pct * 100).toFixed(0)}% of total conversations)
Average sentiment: ${m.sentiment_avg.toFixed(2)}
Drop-off rate: ${((m.end_reason_distribution["user_dropped"] ?? 0) * 100).toFixed(0)}%
Escalation rate: ${((m.end_reason_distribution["escalated"] ?? 0) * 100).toFixed(0)}%${causeBlurb}${topIntentsBlock}${samplesBlock}

Produce three pieces:

1. headline (max 120 chars): The pattern in one sentence. Insight-shaped, not metric-shaped. Do NOT start with a percentage or restate metric numbers — those are in the stat panel already. Examples of GOOD headlines:
   - "Refund policy is rejecting users with otherwise legitimate cases"
   - "Bulk CSV export is the agent's #1 emerging capability gap"
   - "Shipping changes are quietly stuck on a post-dispatch policy"
   - "Users searching for old orders give up silently when lookup returns empty"
   - "Product recommendations land cleanly — pattern worth templating"
   BAD: "37% of conversations: users ask about refunds (process_refund fails 70%)"

2. recommendation (max 280 chars): One or two sentences with a concrete suggested action AND rough impact framed as "X would resolve" or similar. Examples:
   - "Extend the refund window to 60 days, or default to store credit for orders past 30 days. ~183 conversations would resolve without policy abuse."
   - "Scope an \`export_orders\` tool returning CSV. ~70 users are blocked today, many small-business buyers; demand started week 4 and is rising."
   - "Either expand \`update_shipping_address\` to allow courier-redirect post-dispatch, or surface the limitation upfront so users don't loop."

3. key_observation (max 280 chars, OR null): A specific finding from the samples or distribution that aggregates alone don't reveal. Only include if you actually find something concrete. Use null otherwise — do not pad. Good examples:
   - "Many users explicitly mention bookkeeping or accountants — they need structured data export, not a UI report."
   - "Failures cluster around orders 31-60 days old — well within reach of the policy line, suggesting the cutoff is too aggressive."

Hard rules:
- Mention a tool name ONLY when "Attributed cause" above explicitly names one. Do not speculate.
- Do not describe a positive-sentiment cluster as a problem.
- The headline and recommendation must be different shapes. Headline = pattern. Recommendation = action.
- key_observation must be NULL unless you have something concrete to add.

Return strictly the structured JSON matching the schema.`;

  const resp = await withLlmRetry(() =>
    openrouter().chat.completions.create({
      model,
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "content", strict: true, schema: contentJsonSchema },
      },
    }),
  );

  const content = resp.choices[0]?.message.content;
  if (!content) throw new Error("Empty response from insight content generator");
  return ContentSchema.parse(JSON.parse(content));
}

function partitionGuidance(partition: string): string {
  switch (partition) {
    case "succeeded":
      return "These users got what they wanted on this topic. Treat as positive signal — recommendation is usually 'template / amplify' or 'no action'.";
    case "failed_at_tool":
      return "A tool failed in these conversations. Recommendation should target the tool / failure rule.";
    case "dropped_off":
      return "Users abandoned without resolution. Recommendation should reduce silent failures or make the dead-end visible to the user.";
    case "escalated":
      return "Agent handed off to a human. Recommendation should reduce the need to escalate.";
    case "agent_gave_up":
      return "Agent stopped trying. Likely a capability or reasoning gap. Recommendation should fill the gap.";
    case "unresolved":
      return "Mixed outcomes that don't fit cleanly elsewhere. Be honest in framing.";
    default:
      return "";
  }
}

function guidanceFor(tag: string): string {
  switch (tag) {
    case "capability_gap":
      return "Users want something the agent has no tool for. Headline around the missing capability. Recommendation should scope the tool.";
    case "tool_failure":
      return "A specific tool fails when users need it. Name the failure mode in the headline. Recommendation targets the tool or the rule causing failures.";
    case "agent_reasoning_gap":
      return "Tool exists but the agent doesn't use it correctly. Recommendation likely targets prompt or tool-selection guidance.";
    case "friction":
      return "Users retry, rephrase, or escalate. Headline describes the friction pattern. Recommendation targets the source.";
    case "drop_off":
      return "Users abandon. Headline captures why. Recommendation makes the failure mode less silent or fixes the underlying issue.";
    case "latency":
      return "Interactions drag. Recommendation targets the slow path.";
    case "success_pattern":
      return "This is a POSITIVE cluster. Headline neutral or positive. Recommendation is usually 'template / amplify' or 'no action — this is working.'";
    case "uncategorized":
      return "Doesn't fit the typology cleanly. Be honest in the headline; don't force a problem framing. Recommendation may be 'no action' or 'investigate further'.";
    default:
      return "";
  }
}
