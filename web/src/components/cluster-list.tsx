"use client";

import Link from "next/link";

import type { ClusterRow } from "@/lib/types";
import { cn } from "@/lib/cn";

// List below the scatter. Each row shows label, member count, sample intents,
// and either a link to its insight or a "not surfaced" note. Clicking a row
// (anywhere but the link) toggles scatter focus.

const PALETTE = [
  "#2f6f4f", "#b13030", "#1a5fb4", "#7b3294", "#e08e0b",
  "#0d7377", "#9a4f00", "#5c5c8a", "#197278", "#922b21",
  "#1d3557", "#8b5e3c", "#385b53", "#a05fa3", "#7d6608",
];

function colorFor(clusterId: string): string {
  let h = 0;
  for (let i = 0; i < clusterId.length; i++) h = (h * 31 + clusterId.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

export function ClusterList({
  clusters,
  focusedClusterId,
  onFocus,
}: {
  clusters: ClusterRow[];
  focusedClusterId: string | null;
  onFocus: (id: string | null) => void;
}) {
  if (clusters.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-[var(--color-ink-mute)]">
        No clusters yet. Run <span className="font-mono">bun cluster</span>.
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--color-rule)]">
      {clusters.map((c) => {
        const focused = focusedClusterId === c.id;
        return (
          <div
            key={c.id}
            className={cn(
              "group cursor-pointer border-b border-[var(--color-rule)] py-5 transition-colors",
              focused ? "bg-[var(--color-paper)]" : "hover:bg-[var(--color-paper)]",
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
                  <h3 className="text-base font-medium leading-snug">{c.label}</h3>
                  <span className="font-mono text-xs text-[var(--color-ink-mute)]">
                    {c.id}
                  </span>
                </div>

                {c.sample_intents.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {c.sample_intents.map((i) => (
                      <span
                        key={i}
                        className="font-mono text-[11px] text-[var(--color-ink-soft)]"
                      >
                        {i}
                      </span>
                    )).reduce<React.ReactNode[]>((acc, el, i) => {
                      if (i > 0) acc.push(
                        <span key={`sep-${i}`} className="text-[var(--color-ink-mute)]">·</span>,
                      );
                      acc.push(el);
                      return acc;
                    }, [])}
                  </div>
                )}

                {c.sample_messages.length > 0 && (
                  <div className="space-y-1">
                    {c.sample_messages.slice(0, 2).map((msg, i) => (
                      <div
                        key={i}
                        className="line-clamp-1 text-sm text-[var(--color-ink-soft)]"
                      >
                        “{msg}”
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-right">
                <div className="text-lg font-medium tabular-nums">{c.member_count}</div>
                <div className="text-xs text-[var(--color-ink-mute)]">intents</div>
                <div className="mt-2 text-xs">
                  {c.insight_id ? (
                    <Link
                      href={`/insights/${c.insight_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[var(--color-ink-soft)] underline-offset-2 hover:text-[var(--color-ink)] hover:underline"
                    >
                      View insight →
                    </Link>
                  ) : (
                    <span className="text-[var(--color-ink-mute)]">Not surfaced</span>
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
