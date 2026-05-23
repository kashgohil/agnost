// Atomic replace of all insights for the current taxonomy. Wraps in a
// transaction so partial state is impossible — either the new generation is
// fully visible or the old one remains.

import { db, schema } from "../db/client.ts";

export type InsightRecord = {
  id: string;
  cluster_id: string;
  tags: string[];
  taxonomy_version: number;
  headline: string;
  volume_pct: number;
  conversation_count: number;
  sentiment_avg: number;
  weekly_volume: number[];
  attributed_cause: { tool: string; failure_rate: number } | null;
  marker_distribution: Record<string, number>;
  end_reason_distribution: Record<string, number>;
  example_conversation_ids: string[];
};

export async function persistInsights(insights: InsightRecord[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.insights);
    if (insights.length === 0) return;
    await tx.insert(schema.insights).values(
      insights.map((i) => ({
        id: i.id,
        clusterId: i.cluster_id,
        tags: i.tags,
        taxonomyVersion: i.taxonomy_version,
        headline: i.headline,
        volumePct: i.volume_pct,
        conversationCount: i.conversation_count,
        sentimentAvg: i.sentiment_avg,
        weeklyVolume: i.weekly_volume,
        attributedCause: i.attributed_cause,
        markerDistribution: i.marker_distribution,
        endReasonDistribution: i.end_reason_distribution,
        exampleConversationIds: i.example_conversation_ids,
      })),
    );
  });
}
