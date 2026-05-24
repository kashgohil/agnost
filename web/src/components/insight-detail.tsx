// Shared insight detail body — used by /insights/[id] and the Clusters drawer.
// Takes the insight as a prop so the caller controls fetching strategy
// (server component vs client fetch). No layout chrome (nav, breadcrumb).

import type { Insight } from "@/lib/types";
import { DistributionBars } from "./distribution-bars";
import { EvalSetSection } from "./eval-set-section";
import { SentimentIndicator } from "./sentiment-indicator";
import { Sparkline } from "./sparkline";
import { TagBadges } from "./tag-badges";

export function InsightDetail({ insight }: { insight: Insight }) {
  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <TagBadges tags={insight.tags} />
        <h1 className="text-3xl leading-tight font-medium tracking-tight">
          {insight.headline}
        </h1>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-mute">Cluster</dt>
          <dd className="text-ink-soft">{insight.cluster_label}</dd>

          <dt className="text-ink-mute">Outcome</dt>
          <dd className="text-ink-soft">{insight.partition.replaceAll("_", " ")}</dd>

          <dt className="text-ink-mute">Generated</dt>
          <dd className="text-ink-soft">
            {new Date(insight.generated_at).toLocaleDateString()}
            <span className="text-ink-mute"> · taxonomy v{insight.taxonomy_version}</span>
          </dd>
        </dl>
      </header>

      {/* The actionable layer — what to do, plus any specific finding the
          aggregates don't reveal. Distinct from the supporting metrics below. */}
      <section className="border-ink space-y-5 border-l-2 pl-6">
        <div>
          <div className="text-ink-soft mb-1.5 text-xs font-medium">
            What to do
          </div>
          <p className="text-ink text-base leading-relaxed">
            {insight.recommendation}
          </p>
        </div>
        {insight.key_observation && (
          <div>
            <div className="text-ink-soft mb-1.5 text-xs font-medium">
              Notable in the data
            </div>
            <p className="text-ink-soft text-base leading-relaxed">
              {insight.key_observation}
            </p>
          </div>
        )}
      </section>

      <section className="border-rule grid grid-cols-2 gap-x-8 gap-y-6 border-y py-6 md:grid-cols-4">
        <Stat
          label="Volume"
          value={`${Math.round(insight.volume_pct * 100)}%`}
          sub={`${insight.conversation_count} conversations`}
        />
        <Stat
          label="Sentiment"
          value={<SentimentIndicator value={insight.sentiment_avg} size="lg" />}
        />
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
    </div>
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
