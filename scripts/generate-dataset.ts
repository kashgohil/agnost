/**
 * Generate synthetic conversation dataset from a scenario YAML.
 *
 * The generator itself is domain-agnostic — swap scenarios/<other>.yaml to
 * produce a dataset for a different domain without changing this code.
 *
 * Output:
 *   data/conversations/<scenario>/<conversation_id>.json   OTEL-shaped traces
 *   data/conversations/<scenario>/_ground_truth.json       Seeded labels (not exposed to pipeline)
 *
 * Usage:
 *   OPENROUTER_API_KEY=... bun scripts/generate-dataset.ts \
 *       --scenario data/scenarios/shopco.yaml \
 *       --out data/conversations/shopco \
 *       --concurrency 10
 *
 * LLM provider:
 *   OpenRouter (OpenAI-compatible). Default model openai/gpt-4o-mini routed
 *   through OpenRouter — chosen because it reliably supports strict JSON-schema
 *   structured outputs. Swap via --model. Not all models support strict
 *   `response_format` schemas; verify on the model's OpenRouter page first.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import OpenAI from "openai";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const EXPANSION_TEMPERATURE = 0.9; // high — surface variation across the cluster

// ---------- Scenario types ----------

type ToolFailureRule = {
  condition: string;
  outcome: "success" | "error" | "empty_result";
  error_message?: string;
  note?: string;
};

type Tool = {
  name: string;
  description: string;
  failure_rules: ToolFailureRule[];
};

type SkeletonToolCall = {
  tool: string;
  outcome: "success" | "error" | "empty_result";
  error_signature?: string;
};

type SkeletonSpec = {
  user_goal: string;
  narrative: string;
  expected_user_sentiment: string;
  expected_end_reason: string;
  key_phrases: string[];
  tool_call_pattern: SkeletonToolCall[];
};

type FailureMode = {
  id: string;
  target_count: number;
  expected_insight_type: string | null;
  expected_attributed_cause: { tool: string; failure_signature: string } | null;
  week_distribution: number[];
  skeletons: SkeletonSpec[];
};

type Scenario = {
  domain: string;
  agent_id: string;
  agent_persona: string;
  tools: Tool[];
  time_window: { start: string; weeks: number };
  failure_modes: FailureMode[];
};

type Skeleton = SkeletonSpec & {
  mode_id: string;
  skeleton_index: number;
  expected_insight_type: string | null;
  expected_attributed_cause: { tool: string; failure_signature: string } | null;
};

// ---------- Conversation schema (LLM structured output) ----------
//
// Note on the `input_summary` choice: OpenAI strict-mode JSON schemas require
// additionalProperties: false on every object, which makes a free-form
// `input: object` impossible. Modeling tool input as a freeform string here is
// fine — for the synthetic dataset we only need it to feel realistic, not be
// machine-parsable. The real ingestion endpoint accepts structured input.

const ToolCallSchema = z
  .object({
    tool_name: z.string(),
    input_summary: z.string(),
    status: z.enum(["success", "error", "empty_result"]),
    output: z.string(),
    latency_ms: z.number().int(),
  })
  .strict();

const TurnSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    tool_calls: z.array(ToolCallSchema),
  })
  .strict();

const ConversationSchema = z
  .object({
    turns: z.array(TurnSchema),
  })
  .strict();

type GeneratedConversation = z.infer<typeof ConversationSchema>;

// ---------- Deterministic seeded RNG (mulberry32) ----------

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng: () => number, lo: number, hi: number) =>
  lo + Math.floor(rng() * (hi - lo + 1));

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------- Helpers ----------

function flattenSkeletons(scenario: Scenario): Array<[Skeleton, number]> {
  const out: Array<[Skeleton, number]> = [];
  for (const mode of scenario.failure_modes) {
    const n = mode.skeletons.length;
    const base = Math.floor(mode.target_count / n);
    const remainder = mode.target_count - base * n;
    mode.skeletons.forEach((sk, i) => {
      const count = base + (i === n - 1 ? remainder : 0);
      out.push([
        {
          ...sk,
          mode_id: mode.id,
          skeleton_index: i,
          expected_insight_type: mode.expected_insight_type ?? null,
          expected_attributed_cause: mode.expected_attributed_cause ?? null,
        },
        count,
      ]);
    });
  }
  return out;
}

function assignWeeks(scenario: Scenario): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const mode of scenario.failure_modes) {
    const weeks: number[] = [];
    mode.week_distribution.forEach((count, weekIdx) => {
      for (let i = 0; i < count; i++) weeks.push(weekIdx);
    });
    out[mode.id] = weeks;
  }
  return out;
}

function randomTimestamp(weekIdx: number, windowStart: Date, rng: () => number): Date {
  const dayOffset = randInt(rng, 0, 6);
  const hour = randInt(rng, 8, 20);
  const minute = randInt(rng, 0, 59);
  const second = randInt(rng, 0, 59);
  const ts = new Date(windowStart);
  ts.setUTCDate(ts.getUTCDate() + weekIdx * 7 + dayOffset);
  ts.setUTCHours(hour, minute, second, 0);
  return ts;
}

function conversationId(scenarioName: string, idx: number): string {
  const h = createHash("sha256").update(`${scenarioName}:${idx}`).digest("hex").slice(0, 10);
  return `conv_${String(idx).padStart(4, "0")}_${h}`;
}

// ---------- Prompt ----------

function buildPrompt(scenario: Scenario, sk: Skeleton): string {
  const toolsSummary = scenario.tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
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

// ---------- OpenAI call ----------

// Pre-compute the JSON Schema once. zod-to-json-schema produces a draft-07 schema
// with $ref; we strip the wrapper to match OpenAI's expected shape.
const conversationJsonSchema = (() => {
  const full = zodToJsonSchema(ConversationSchema, {
    name: "conversation",
    $refStrategy: "none",
  }) as { definitions?: Record<string, unknown> };
  // zod-to-json-schema wraps in definitions when given a name; unwrap.
  return full.definitions?.conversation ?? full;
})();

async function expandConversation(
  client: OpenAI,
  model: string,
  scenario: Scenario,
  sk: Skeleton,
): Promise<GeneratedConversation> {
  const resp = await client.chat.completions.create({
    model,
    temperature: EXPANSION_TEMPERATURE,
    messages: [{ role: "user", content: buildPrompt(scenario, sk) }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "conversation",
        strict: true,
        schema: conversationJsonSchema as Record<string, unknown>,
      },
    },
  });
  const content = resp.choices[0]?.message.content;
  if (!content) throw new Error("Empty response from model");
  return ConversationSchema.parse(JSON.parse(content));
}

// ---------- Timestamp attachment ----------

type EnrichedToolCall = {
  tool_call_id: string;
  tool_name: string;
  input_summary: string;
  status: string;
  output: string;
  latency_ms: number;
  timestamp: string;
};

type EnrichedTurn = {
  turn_id: string;
  role: string;
  content: string;
  timestamp: string;
  tool_calls: EnrichedToolCall[];
};

function attachTimestamps(
  turns: GeneratedConversation["turns"],
  startedAt: Date,
  rng: () => number,
): { turns: EnrichedTurn[]; endedAt: Date } {
  let cursor = new Date(startedAt);
  const enriched: EnrichedTurn[] = [];
  turns.forEach((turn, i) => {
    const gapSeconds = turn.role === "user" ? randInt(rng, 15, 90) : randInt(rng, 2, 8);
    cursor = new Date(cursor.getTime() + gapSeconds * 1000);
    const turnId = `t${i + 1}`;
    const enrichedToolCalls: EnrichedToolCall[] = [];
    turn.tool_calls.forEach((tc, j) => {
      cursor = new Date(cursor.getTime() + tc.latency_ms);
      enrichedToolCalls.push({
        tool_call_id: `${turnId}_tc${j + 1}`,
        tool_name: tc.tool_name,
        input_summary: tc.input_summary,
        status: tc.status,
        output: tc.output,
        latency_ms: tc.latency_ms,
        timestamp: cursor.toISOString(),
      });
    });
    enriched.push({
      turn_id: turnId,
      role: turn.role,
      content: turn.content,
      timestamp: cursor.toISOString(),
      tool_calls: enrichedToolCalls,
    });
  });
  return { turns: enriched, endedAt: cursor };
}

// ---------- Per-conversation generation ----------

type GroundTruthRow = {
  conversation_id: string;
  mode_id: string;
  skeleton_index: number;
  week_idx: number;
  expected_insight_type: string | null;
  expected_attributed_cause: { tool: string; failure_signature: string } | null;
  expected_user_sentiment: string;
  expected_end_reason: string;
};

function groundTruthRow(convId: string, sk: Skeleton, weekIdx: number): GroundTruthRow {
  return {
    conversation_id: convId,
    mode_id: sk.mode_id,
    skeleton_index: sk.skeleton_index,
    week_idx: weekIdx,
    expected_insight_type: sk.expected_insight_type,
    expected_attributed_cause: sk.expected_attributed_cause,
    expected_user_sentiment: sk.expected_user_sentiment,
    expected_end_reason: sk.expected_end_reason,
  };
}

async function generateOne(
  client: OpenAI,
  model: string,
  scenario: Scenario,
  sk: Skeleton,
  weekIdx: number,
  windowStart: Date,
  convId: string,
  rng: () => number,
  outDir: string,
): Promise<GroundTruthRow> {
  const outPath = join(outDir, `${convId}.json`);
  if (existsSync(outPath)) {
    // Resumable: skip if already generated.
    return groundTruthRow(convId, sk, weekIdx);
  }

  const raw = await expandConversation(client, model, scenario, sk);
  const startedAt = randomTimestamp(weekIdx, windowStart, rng);
  const { turns, endedAt } = attachTimestamps(raw.turns, startedAt, rng);

  const record = {
    conversation_id: convId,
    agent_id: scenario.agent_id,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    end_reason: sk.expected_end_reason,
    turns,
  };
  writeFileSync(outPath, JSON.stringify(record, null, 2));
  return groundTruthRow(convId, sk, weekIdx);
}

// ---------- Semaphore for concurrency ----------

class Semaphore {
  private q: Array<() => void> = [];
  constructor(private permits: number) {}
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    await new Promise<void>((resolve) => this.q.push(resolve));
  }
  release(): void {
    const next = this.q.shift();
    if (next) next();
    else this.permits++;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// ---------- Main ----------

async function main() {
  const { values } = parseArgs({
    options: {
      scenario: { type: "string" },
      out: { type: "string" },
      concurrency: { type: "string", default: "10" },
      seed: { type: "string", default: "42" },
      model: { type: "string", default: DEFAULT_MODEL },
    },
  });

  if (!values.scenario || !values.out) {
    console.error("Usage: --scenario <path> --out <dir> [--concurrency N] [--seed N] [--model SLUG]");
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY not set");
    process.exit(1);
  }

  const scenarioPath = values.scenario;
  const scenarioName = scenarioPath.split("/").pop()!.replace(/\.ya?ml$/, "");
  const scenario = parseYaml(readFileSync(scenarioPath, "utf-8")) as Scenario;

  const outDir = values.out;
  mkdirSync(outDir, { recursive: true });

  const seed = Number(values.seed);
  const rng = makeRng(seed);
  const windowStart = new Date(`${scenario.time_window.start}T00:00:00.000Z`);

  // Build the work list: each item is [skeleton, week_idx].
  const skeletonCounts = flattenSkeletons(scenario);
  const weeksByMode = assignWeeks(scenario);

  const byMode: Record<string, Skeleton[]> = {};
  const countsBySkeleton: Map<string, number> = new Map();
  for (const [sk, count] of skeletonCounts) {
    (byMode[sk.mode_id] ||= []).push(sk);
    countsBySkeleton.set(`${sk.mode_id}:${sk.skeleton_index}`, count);
  }

  let workList: Array<[Skeleton, number]> = [];
  for (const [modeId, skeletons] of Object.entries(byMode)) {
    const weeks = shuffle(weeksByMode[modeId]!, rng);
    const instances: Skeleton[] = [];
    for (const sk of skeletons) {
      const count = countsBySkeleton.get(`${sk.mode_id}:${sk.skeleton_index}`)!;
      for (let i = 0; i < count; i++) instances.push(sk);
    }
    if (instances.length !== weeks.length) {
      throw new Error(
        `mode ${modeId}: ${instances.length} skeletons vs ${weeks.length} weeks`,
      );
    }
    const shuffledInstances = shuffle(instances, rng);
    workList.push(...shuffledInstances.map((sk, i) => [sk, weeks[i]!] as [Skeleton, number]));
  }
  workList = shuffle(workList, rng);

  const client = new OpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/local/agnost-takehome",
      "X-Title": "agnost-takehome",
    },
  });

  const sem = new Semaphore(Number(values.concurrency));
  let done = 0;
  const total = workList.length;

  const tasks = workList.map(([sk, weekIdx], i) =>
    sem.run(async () => {
      const convId = conversationId(scenarioName, i);
      try {
        const row = await generateOne(
          client,
          values.model!,
          scenario,
          sk,
          weekIdx,
          windowStart,
          convId,
          rng,
          outDir,
        );
        done++;
        if (done % 10 === 0 || done === total) {
          process.stderr.write(`\rgenerating: ${done}/${total}`);
        }
        return row;
      } catch (err) {
        process.stderr.write(`\n[error] ${convId}: ${(err as Error).message}\n`);
        throw err;
      }
    }),
  );

  const groundTruth = await Promise.all(tasks);
  process.stderr.write("\n");

  const gtPath = join(outDir, "_ground_truth.json");
  writeFileSync(gtPath, JSON.stringify(groundTruth, null, 2));
  console.log(`Wrote ${groundTruth.length} conversations to ${outDir}`);
  console.log(`Ground truth at ${gtPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
