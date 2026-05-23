// Per-conversation generation: invoke the LLM, attach timestamps, write the
// file. Resumable - skips conversations whose output file already exists.

import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type OpenAI from "openai";

import { expandConversation } from "./llm.ts";
import { attachTimestamps, randomTimestamp } from "./timestamps.ts";
import type {
  AttributedCause,
  ConversationRecord,
  GroundTruthRow,
  Scenario,
  Skeleton,
} from "./types.ts";

export function conversationId(scenarioName: string, idx: number): string {
  const h = createHash("sha256")
    .update(`${scenarioName}:${idx}`)
    .digest("hex")
    .slice(0, 10);
  return `conv_${String(idx).padStart(4, "0")}_${h}`;
}

function groundTruthRow(
  convId: string,
  sk: Skeleton,
  weekIdx: number,
): GroundTruthRow {
  return {
    conversation_id: convId,
    mode_id: sk.mode_id,
    skeleton_index: sk.skeleton_index,
    week_idx: weekIdx,
    expected_insight_type: sk.expected_insight_type,
    expected_attributed_cause:
      sk.expected_attributed_cause as AttributedCause | null,
    expected_user_sentiment: sk.expected_user_sentiment,
    expected_end_reason: sk.expected_end_reason,
  };
}

export async function generateOne(args: {
  client: OpenAI;
  model: string;
  scenario: Scenario;
  skeleton: Skeleton;
  weekIdx: number;
  windowStart: Date;
  convId: string;
  rng: () => number;
  outDir: string;
}): Promise<GroundTruthRow> {
  const {
    client,
    model,
    scenario,
    skeleton,
    weekIdx,
    windowStart,
    convId,
    rng,
    outDir,
  } = args;
  const outPath = join(outDir, `${convId}.json`);
  if (existsSync(outPath)) {
    return groundTruthRow(convId, skeleton, weekIdx);
  }

  const raw = await expandConversation(client, model, scenario, skeleton);
  const startedAt = randomTimestamp(weekIdx, windowStart, rng);
  const { turns, endedAt } = attachTimestamps(raw.turns, startedAt, rng);

  const record: ConversationRecord = {
    conversation_id: convId,
    agent_id: scenario.agent_id,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    end_reason: skeleton.expected_end_reason,
    turns,
  };
  writeFileSync(outPath, JSON.stringify(record, null, 2));
  return groundTruthRow(convId, skeleton, weekIdx);
}
