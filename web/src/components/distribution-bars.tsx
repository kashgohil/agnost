// Quiet horizontal bars. Label on the left, thin track, percent on the right.

export function DistributionBars({
  title,
  data,
}: {
  title: string;
  data: Record<string, number>;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <div className="mb-4 text-xs font-medium text-[var(--color-ink-soft)]">{title}</div>
      {entries.length === 0 ? (
        <div className="text-sm text-[var(--color-ink-mute)]">No data</div>
      ) : (
        <div className="space-y-2.5">
          {entries.map(([label, value]) => {
            const pct = Math.min(100, value * 100);
            return (
              <div key={label} className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
                <div className="space-y-1.5">
                  <div className="text-[13px] text-[var(--color-ink-soft)]">
                    {label.replaceAll("_", " ")}
                  </div>
                  <div className="relative h-1 w-full overflow-hidden rounded-full bg-[var(--color-rule-soft)]">
                    <div
                      className="absolute left-0 top-0 h-full rounded-full bg-[var(--color-ink)]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className="w-10 text-right text-sm tabular-nums text-[var(--color-ink-soft)]">
                  {pct.toFixed(0)}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
