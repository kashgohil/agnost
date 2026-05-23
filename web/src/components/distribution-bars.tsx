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
      <div className="text-ink-soft mb-4 text-xs font-medium">{title}</div>
      {entries.length === 0 ? (
        <div className="text-ink-mute text-sm">No data</div>
      ) : (
        <div className="space-y-2.5">
          {entries.map(([label, value]) => {
            const pct = Math.min(100, value * 100);
            return (
              <div key={label} className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
                <div className="space-y-1.5">
                  <div className="text-ink-soft text-[13px]">
                    {label.replaceAll("_", " ")}
                  </div>
                  <div className="bg-rule-soft relative h-1 w-full overflow-hidden rounded-full">
                    <div
                      className="bg-ink absolute top-0 left-0 h-full rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className="text-ink-soft w-10 text-right text-sm tabular-nums">
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
