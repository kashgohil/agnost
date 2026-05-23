import { Badge } from "./ui/badge";
import { tagAxis } from "@/lib/types";

export function TagBadges({ tags }: { tags: string[] }) {
  // Problem → Trajectory → Severity reading order.
  const sorted = [...tags].sort((a, b) => axisOrder(a) - axisOrder(b));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {sorted.map((t) => (
        <Badge key={t}>{t.replaceAll("_", " ")}</Badge>
      ))}
    </div>
  );
}

function axisOrder(tag: string): number {
  const a = tagAxis(tag);
  return a === "problem" ? 0 : a === "trajectory" ? 1 : a === "severity" ? 2 : 3;
}
