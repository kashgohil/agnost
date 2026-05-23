// The expansion prompt: takes a scenario + skeleton and produces the message
// sent to the LLM. Isolated here so it can be tuned, swapped, or A/B'd
// without touching the generator pipeline.

import type { Scenario, Skeleton } from "./types.ts";

export function buildPrompt(scenario: Scenario, sk: Skeleton): string {
  const toolsSummary = scenario.tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");

  const patternLines = sk.tool_call_pattern.map((step) => {
    let line = `  - ${step.tool} -> ${step.outcome}`;
    if (step.error_signature) line += ` (error: ${step.error_signature})`;
    return line;
  });
  const patternBlock = patternLines.length
    ? patternLines.join("\n")
    : "  (no tool calls in this conversation)";

  return `You are generating a single synthetic conversation between a user and an AI customer-support agent for the purpose of building a test dataset. The conversation must feel natural — varied phrasing, realistic typos occasionally, different tones — not templated.

Domain: ${scenario.domain}
Agent persona: ${scenario.agent_persona}

Available tools the agent may call:
${toolsSummary}

This specific conversation should follow this scenario:
  User's underlying goal: ${sk.user_goal}
  Narrative arc: ${sk.narrative}
  Expected user sentiment: ${sk.expected_user_sentiment}
  Expected end reason: ${sk.expected_end_reason}

The conversation must include these tool calls in this order, with these outcomes:
${patternBlock}

Hints for natural surface variation:
- Vary user phrasing. Some of these phrases may appear but do not force all of them: ${sk.key_phrases.join(", ")}
- Invent realistic product names, order IDs, prices appropriate to the domain.
- Conversations typically run 4-10 turns. Short conversations are fine if the issue resolves or the user drops off quickly.
- Tool calls happen inside assistant turns (assistant decides to call a tool, then responds based on the result). Each assistant turn may include zero, one, or several tool_calls.
- For tool calls marked 'error', the output should contain a realistic error message. For 'empty_result', the output should reflect that the tool returned no data.
- input_summary should be a short human-readable description of what was passed to the tool (e.g., "order_id: ORD-48201").
- latency_ms should be a realistic integer between 80 and 2500.
- The user's last turn should reflect the expected end reason (frustrated drop-off, polite thanks, escalation request, etc.).

Generate the conversation as a sequence of turns. Do not include any preamble or explanation — only the structured JSON matching the schema.`;
}
