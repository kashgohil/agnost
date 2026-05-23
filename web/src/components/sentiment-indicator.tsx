// Compact sentiment readout. Color carries the polarity, value carries the magnitude.

export function SentimentIndicator({ value, size = "sm" }: { value: number; size?: "sm" | "lg" }) {
  const color =
    value <= -0.3
      ? "var(--color-negative)"
      : value >= 0.3
        ? "var(--color-positive)"
        : "var(--color-ink-mute)";
  const cls = size === "lg" ? "text-2xl" : "text-sm";
  return (
    <span className={`${cls} tabular-nums`} style={{ color }}>
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}
    </span>
  );
}
