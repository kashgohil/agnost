// Minimal sparkline. Single thin stroke, no decoration.

export function Sparkline({
  data,
  width = 120,
  height = 28,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (data.length === 0) {
    return <div className={className} style={{ width, height }} />;
  }

  const max = Math.max(...data, 1);
  const step = data.length > 1 ? width / (data.length - 1) : 0;
  const padding = 2;
  const usableH = height - padding * 2;

  const path = data
    .map((v, i) => {
      const x = i * step;
      const y = padding + (usableH - (v / max) * usableH);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      aria-label="weekly volume"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
