"use client";

import { useMemo, useState } from "react";

import type { ClusterRow, IntentRow } from "@/lib/types";

// 2D scatter of intent embeddings. Color = cluster. Hover = intent string.
// Click a point or a list row → focus a cluster (greys the rest).
// SVG only, no chart library.

const PALETTE = [
  "#2f6f4f", "#b13030", "#1a5fb4", "#7b3294", "#e08e0b",
  "#0d7377", "#9a4f00", "#5c5c8a", "#197278", "#922b21",
  "#1d3557", "#8b5e3c", "#385b53", "#a05fa3", "#7d6608",
];

function colorFor(clusterId: string | null): string {
  if (clusterId === null) return "var(--color-rule)";
  // Stable hash from cluster_id → palette index.
  let h = 0;
  for (let i = 0; i < clusterId.length; i++) h = (h * 31 + clusterId.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

export function ClusterScatter({
  clusters,
  intents,
  focusedClusterId,
  onFocus,
}: {
  clusters: ClusterRow[];
  intents: IntentRow[];
  focusedClusterId: string | null;
  onFocus: (clusterId: string | null) => void;
}) {
  const [hovered, setHovered] = useState<IntentRow | null>(null);

  const labelById = useMemo(
    () => new Map(clusters.map((c) => [c.id, c.label])),
    [clusters],
  );

  const bounds = useMemo(() => {
    if (intents.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of intents) {
      if (p.position_x < minX) minX = p.position_x;
      if (p.position_x > maxX) maxX = p.position_x;
      if (p.position_y < minY) minY = p.position_y;
      if (p.position_y > maxY) maxY = p.position_y;
    }
    const padX = (maxX - minX) * 0.05 || 1;
    const padY = (maxY - minY) * 0.05 || 1;
    return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
  }, [intents]);

  const W = 720, H = 380;

  const project = (x: number, y: number) => {
    const xPct = (x - bounds.minX) / (bounds.maxX - bounds.minX);
    const yPct = (y - bounds.minY) / (bounds.maxY - bounds.minY);
    // Invert y so up is up.
    return [xPct * W, (1 - yPct) * H] as const;
  };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="border-rule bg-paper w-full rounded-md border"
        role="img"
        aria-label="Cluster scatter plot"
      >
        {/* axes (subtle, just a reference) */}
        <line x1={0} y1={H - 0.5} x2={W} y2={H - 0.5} stroke="var(--color-rule)" />
        <line x1={0.5} y1={0} x2={0.5} y2={H} stroke="var(--color-rule)" />

        {/* render noise first so cluster points sit on top */}
        {intents
          .filter((p) => p.cluster_id === null)
          .map((p) => {
            const [px, py] = project(p.position_x, p.position_y);
            const dim = focusedClusterId !== null;
            return (
              <circle
                key={p.intent}
                cx={px}
                cy={py}
                r={2.5}
                fill={colorFor(null)}
                opacity={dim ? 0.2 : 0.6}
                onMouseEnter={() => setHovered(p)}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}

        {intents
          .filter((p) => p.cluster_id !== null)
          .map((p) => {
            const [px, py] = project(p.position_x, p.position_y);
            const isFocused = focusedClusterId === null || focusedClusterId === p.cluster_id;
            return (
              <circle
                key={p.intent}
                cx={px}
                cy={py}
                r={4}
                fill={colorFor(p.cluster_id)}
                opacity={isFocused ? 0.85 : 0.12}
                stroke={
                  hovered?.intent === p.intent ? "var(--color-ink)" : "transparent"
                }
                strokeWidth={1}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHovered(p)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onFocus(p.cluster_id === focusedClusterId ? null : p.cluster_id)}
              />
            );
          })}
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div className="border-rule bg-background pointer-events-none absolute top-3 left-3 rounded-md border px-2.5 py-1.5 text-xs shadow-sm">
          <div className="font-mono">{hovered.intent}</div>
          {hovered.cluster_id ? (
            <div className="text-ink-mute">
              {labelById.get(hovered.cluster_id) ?? hovered.cluster_id}
            </div>
          ) : (
            <div className="text-ink-mute">Noise — not assigned</div>
          )}
        </div>
      )}

      {focusedClusterId && (
        <button
          onClick={() => onFocus(null)}
          className="border-rule bg-background text-ink-soft hover:text-ink absolute top-3 right-3 rounded-md border px-2 py-1 text-xs"
        >
          Reset focus
        </button>
      )}
    </div>
  );
}
