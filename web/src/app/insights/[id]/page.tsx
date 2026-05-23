import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchInsight } from "@/lib/api";
import { DistributionBars } from "@/components/distribution-bars";
import { EvalSetSection } from "@/components/eval-set-section";
import { PageNav } from "@/components/page-nav";
import { SentimentIndicator } from "@/components/sentiment-indicator";
import { Sparkline } from "@/components/sparkline";
import { TagBadges } from "@/components/tag-badges";

export default async function InsightDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const insight = await fetchInsight(id);
  if (!insight) notFound();

  return (
    <article className="space-y-10">
      <PageNav />
      <Link
        href="/"
        className="text-ink-mute hover:text-ink inline-block text-xs"
      >
        ← All insights
      </Link>

      <header className="space-y-4">
        <TagBadges tags={insight.tags} />
        <h1 className="text-3xl leading-tight font-medium tracking-tight">
          {insight.headline}
        </h1>
        <div className="text-ink-mute text-sm">
          Cluster <span className="text-ink-soft">{insight.cluster_label}</span>
          {" · "}
          Generated {new Date(insight.generated_at).toLocaleDateString()}
          {" · "}
          Taxonomy v{insight.taxonomy_version}
        </div>
      </header>

      <section className="border-rule grid grid-cols-2 gap-x-8 gap-y-6 border-y py-6 md:grid-cols-4">
        <Stat label="Volume" value={`${Math.round(insight.volume_pct * 100)}%`}
              sub={`${insight.conversation_count} conversations`} />
        <Stat label="Sentiment" value={<SentimentIndicator value={insight.sentiment_avg} size="lg" />} />
        <Stat
          label="Weekly volume"
          value={
            <Sparkline
              data={insight.weekly_volume}
              width={140}
              height={36}
              className="text-ink"
            />
          }
        />
        <Stat
          label="Attributed cause"
          value={
            insight.attributed_cause ? (
              <div className="space-y-1">
                <div className="font-mono text-sm">{insight.attributed_cause.tool}</div>
                <div className="text-ink-soft text-sm">
                  {Math.round(insight.attributed_cause.failure_rate * 100)}% failure rate
                </div>
              </div>
            ) : (
              <span className="text-ink-mute text-sm">No single tool</span>
            )
          }
        />
      </section>

      <section className="grid grid-cols-1 gap-12 md:grid-cols-2">
        <DistributionBars title="Frustration markers" data={insight.marker_distribution} />
        <DistributionBars title="Conversation outcomes" data={insight.end_reason_distribution} />
      </section>

      <section className="border-rule space-y-4 border-t pt-8">
        <div>
          <h2 className="text-lg font-medium">Conversation set</h2>
          <p className="text-ink-soft mt-1 max-w-xl text-sm">
            Conversations that produced this insight. Useful as an eval set when shipping a fix.
          </p>
        </div>
        <EvalSetSection insightId={insight.id} />
      </section>
    </article>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-ink-mute text-xs">{label}</div>
      <div className="text-2xl font-medium tabular-nums">{value}</div>
      {sub && <div className="text-ink-soft text-xs">{sub}</div>}
    </div>
  );
}
