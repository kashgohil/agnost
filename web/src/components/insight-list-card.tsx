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
      className="group border-rule hover:bg-paper block border-b py-5 transition-colors"
    >
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-8">
        <div className="space-y-2">
          <h3 className="text-ink text-base leading-snug font-medium">
            {insight.headline}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <TagBadges tags={insight.tags} />
            {insight.attributed_cause && (
              <span className="text-ink-mute text-xs">
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
          className="text-ink-soft"
        />

        <div className="min-w-16 text-right">
          <div className="text-lg font-medium tabular-nums">
            {Math.round(insight.volume_pct * 100)}%
          </div>
          <div className="text-ink-mute text-xs">
            {insight.conversation_count} convs
          </div>
        </div>
      </div>
    </Link>
  );
}
