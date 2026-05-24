"use client";

import type { ClusterRow } from "@/lib/types";
import { cn } from "@/lib/cn";

// Each cluster row shows its insights as partition chips. Clicking a chip
// opens that insight in the drawer; clicking elsewhere on the row toggles
// scatter focus.

const PALETTE = [
  "#2f6f4f",
  "#b13030",
  "#1a5fb4",
  "#7b3294",
  "#e08e0b",
  "#0d7377",
  "#9a4f00",
  "#5c5c8a",
  "#197278",
  "#922b21",
  "#1d3557",
  "#8b5e3c",
  "#385b53",
  "#a05fa3",
  "#7d6608",
];

function colorFor(clusterId: string): string {
  let h = 0;
  for (let i = 0; i < clusterId.length; i++)
    h = (h * 31 + clusterId.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

export function ClusterList({
  clusters,
  focusedClusterId,
  onFocus,
  onOpenInsight,
}: {
  clusters: ClusterRow[];
  focusedClusterId: string | null;
  onFocus: (id: string | null) => void;
  onOpenInsight: (insightId: string) => void;
}) {
  if (clusters.length === 0) {
    return (
      <div className="text-ink-mute py-12 text-center text-sm">
        No clusters yet. Run <span className="font-mono">bun cluster</span>.
      </div>
    );
  }

  return (
    <div className="border-rule border-t">
      {clusters.map((c) => {
        const focused = focusedClusterId === c.id;
        return (
          <div
            key={c.id}
            className={cn(
              "group border-rule cursor-pointer border-b p-5 transition-colors",
              focused ? "bg-paper" : "hover:bg-paper",
            )}
            onClick={() => onFocus(focused ? null : c.id)}
          >
            <div className="grid grid-cols-[12px_1fr_auto] items-start gap-4">
              <span
                className="mt-1.5 inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: colorFor(c.id) }}
              />

              <div className="min-w-0 space-y-2">
                <div className="flex items-baseline gap-3">
                  <h3 className="text-base leading-snug font-medium">
                    {c.label}
                  </h3>
                  <span className="text-ink-mute font-mono text-xs">
                    {c.id}
                  </span>
                </div>

                {c.sample_intents.length > 0 && (
                  <div className="flex flex-wrap gap-x-2 gap-y-1">
                    {c.sample_intents.map((i, idx) => (
                      <span
                        key={i}
                        className="text-ink-soft font-mono text-[11px]"
                      >
                        {idx > 0 && (
                          <span className="text-ink-mute mr-2">·</span>
                        )}
                        {i}
                      </span>
                    ))}
                  </div>
                )}

                {c.sample_messages.length > 0 && (
                  <div className="space-y-1">
                    {c.sample_messages.slice(0, 2).map((msg, i) => (
                      <div
                        key={i}
                        className="text-ink-soft line-clamp-1 text-sm"
                      >
                        “{msg}”
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-right">
                <div className="text-lg font-medium tabular-nums">
                  {c.member_count}
                </div>
                <div className="text-ink-mute text-xs">intents</div>
                <div className="mt-2 flex flex-col items-end gap-1">
                  {c.insights.length === 0 ? (
                    <span className="text-ink-mute text-xs">Not surfaced</span>
                  ) : (
                    c.insights.map((ins) => (
                      <button
                        key={ins.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenInsight(ins.id);
                        }}
                        className="border-rule hover:border-ink rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-ink-soft hover:text-ink transition-colors"
                        title={`Open insight: ${ins.partition.replaceAll("_", " ")}`}
                      >
                        {ins.partition.replaceAll("_", " ")}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
