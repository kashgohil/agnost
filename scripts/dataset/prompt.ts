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

This specific conversation must follow this scenario:
  User's underlying goal: ${sk.user_goal}
  Narrative arc: ${sk.narrative}
  Expected user sentiment: ${sk.expected_user_sentiment}
  Expected end reason: ${sk.expected_end_reason}

HARD REQUIREMENTS - the output is invalid if any of these are violated:
1. The conversation must include EVERY tool call listed below, in this exact order, with these exact outcomes. Do not stop after the first tool call - produce the full sequence:
${patternBlock}
2. Tool calls appear ONLY inside assistant turns. User turns must always have an empty tool_calls array.
3. After each tool call, the assistant must produce a user-facing response based on the tool result (in the same turn as the tool call).

How the conversation should end (this varies — match the expected end reason naturally):
- "resolved" → typically ends with a user thanks or an agent confirmation. Either role can be last.
- "escalated" → often ends with the agent offering escalation, sometimes the user accepting. Either role can be last.
- "user_dropped" → user stops responding mid-conversation. Will usually end on an assistant turn (the user simply doesn't reply).
- "agent_gave_up" → agent's final refusal or "I cannot help with that" — typically ends on the assistant.

Style hints for natural surface variation:
- Vary user phrasing. Some of these phrases may appear but do not force all of them: ${sk.key_phrases.join(", ")}
- Invent realistic product names, order IDs, prices appropriate to the domain.
- Conversations should run 5-10 turns total.
- Each assistant turn may include zero, one, or several tool_calls.
- For tool calls marked 'error', the output should contain a realistic error message. For 'empty_result', the output should reflect that the tool returned no data.
- input_summary should be a short human-readable description of what was passed to the tool (e.g., "order_id: ORD-48201").
- latency_ms should be a realistic integer between 80 and 2500.

Generate the conversation as a sequence of turns. Do not include any preamble or explanation - only the structured JSON matching the schema.`;
}
