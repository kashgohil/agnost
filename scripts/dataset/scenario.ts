// Load a scenario YAML and flatten it into (skeleton, week_idx) work items.

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

import { shuffle } from "./rng.ts";
import type { Scenario, Skeleton } from "./types.ts";

export function loadScenario(path: string): Scenario {
  return parseYaml(readFileSync(path, "utf-8")) as Scenario;
}

// Splits target_count evenly across skeletons; last skeleton takes the remainder.
export function flattenSkeletons(
  scenario: Scenario,
): Array<[Skeleton, number]> {
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

// Modes are interleaved so partial runs still produce a representative sample.
export function buildWorkList(
  scenario: Scenario,
  rng: () => number,
): Array<[Skeleton, number]> {
  const skeletonCounts = flattenSkeletons(scenario);
  const weeksByMode = assignWeeks(scenario);

  const byMode: Record<string, Skeleton[]> = {};
  const countsBySkeleton = new Map<string, number>();
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
    const shuffled = shuffle(instances, rng);
    workList.push(
      ...shuffled.map((sk, i) => [sk, weeks[i]!] as [Skeleton, number]),
    );
  }
  return shuffle(workList, rng);
}
