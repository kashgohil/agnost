// Insights pipeline: aggregate → classify → generate-content → persist.
//
// Reports an `uncategorized_rate` because tag-staleness is the operational
// signal that the taxonomy needs maintenance (see typology.ts changelog).

import { Semaphore } from "../lib/concurrency.ts";
import { aggregateAllClusters } from "./aggregate.ts";
import { generateContent } from "./content.ts";
import { persistInsights, type InsightRecord } from "./persist.ts";
import { TAXONOMY_VERSION, classifyCluster } from "./typology.ts";

export type InsightsStats = {
  clusters_processed: number;
  insights_written: number;
  uncategorized_count: number;
  uncategorized_rate: number;
  taxonomy_version: number;
};

export async function runInsightsPipeline(opts: {
  contentModel: string;
  contentConcurrency: number;
  onProgress?: (stage: string, info?: string) => void;
}): Promise<InsightsStats> {
  const log = (stage: string, info?: string) => opts.onProgress?.(stage, info);

  log("aggregate");
  const metrics = await aggregateAllClusters();

  if (metrics.length === 0) {
    return {
      clusters_processed: 0,
      insights_written: 0,
      uncategorized_count: 0,
      uncategorized_rate: 0,
      taxonomy_version: TAXONOMY_VERSION,
    };
  }

  log("classify", `${metrics.length} clusters`);
  const classified = metrics.map((m) => ({ metrics: m, tags: classifyCluster(m) }));
  const uncategorized = classified.filter((c) => c.tags.problem === "uncategorized").length;

  log("content");
  const sem = new Semaphore(opts.contentConcurrency);
  const insights: InsightRecord[] = await Promise.all(
    classified.map((c, i) =>
      sem.run(async () => {
        const content = await generateContent(
          c.metrics,
          c.tags,
          c.metrics.sample_messages,
          opts.contentModel,
        );
        return {
          id: `insight_${String(i + 1).padStart(4, "0")}`,
          cluster_id: c.metrics.cluster_id,
          tags: [c.tags.problem, c.tags.trajectory, c.tags.severity],
          taxonomy_version: TAXONOMY_VERSION,
          headline: content.headline,
          recommendation: content.recommendation,
          key_observation: content.key_observation,
          volume_pct: c.metrics.volume_pct,
          conversation_count: c.metrics.conversation_count,
          sentiment_avg: c.metrics.sentiment_avg,
          weekly_volume: c.metrics.weekly_volume,
          attributed_cause: c.metrics.attributed_cause,
          marker_distribution: c.metrics.marker_distribution,
          end_reason_distribution: c.metrics.end_reason_distribution,
          example_conversation_ids: c.metrics.example_conversation_ids,
        };
      }),
    ),
  );

  log("persist");
  await persistInsights(insights);

  return {
    clusters_processed: metrics.length,
    insights_written: insights.length,
    uncategorized_count: uncategorized,
    uncategorized_rate: metrics.length > 0 ? uncategorized / metrics.length : 0,
    taxonomy_version: TAXONOMY_VERSION,
  };
}
