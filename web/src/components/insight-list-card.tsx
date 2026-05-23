import Link from "next/link";

import type { Insight } from "@/lib/types";
import { TagBadges } from "./tag-badges";
import { Sparkline } from "./sparkline";

// Quiet list row: headline, tags, metrics. Hairline divider between rows.
// Hover gently darkens the row.

export function InsightListCard({ insight }: { insight: Insight }) {
  return (
    <Link
      href={`/insights/${insight.id}`}
      className="group block border-b border-[var(--color-rule)] py-5 transition-colors hover:bg-[var(--color-paper)]"
    >
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-8">
        <div className="space-y-2">
          <h3 className="text-base font-medium leading-snug text-[var(--color-ink)]">
            {insight.headline}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <TagBadges tags={insight.tags} />
            {insight.attributed_cause && (
              <span className="text-xs text-[var(--color-ink-mute)]">
                · <span className="font-mono">{insight.attributed_cause.tool}</span> fails{" "}
                {Math.round(insight.attributed_cause.failure_rate * 100)}%
              </span>
            )}
          </div>
        </div>

        <Sparkline
          data={insight.weekly_volume}
          width={96}
          height={28}
          className="text-[var(--color-ink-soft)]"
        />

        <div className="min-w-[64px] text-right">
          <div className="text-lg font-medium tabular-nums">
            {Math.round(insight.volume_pct * 100)}%
          </div>
          <div className="text-xs text-[var(--color-ink-mute)]">
            {insight.conversation_count} convs
          </div>
        </div>
      </div>
    </Link>
  );
}
