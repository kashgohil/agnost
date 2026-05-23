// Stable pseudo-random sampling. Replaces ORDER BY random() + LIMIT with
// something deterministic across runs (good for debugging — same insight
// always shows the same examples) but still mixing across the dataset so
// callers don't always ground on the same first-by-id rows.

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pickStableShuffled<T>(
  rows: Array<{ key: string; value: T }>,
  perKey: number,
): Map<string, T[]> {
  // Hash by (key + value-as-string) so the ordering depends on both the
  // cluster identity AND the row content — same input always sorts the same
  // way, but different clusters get different orderings.
  const sorted = rows
    .map((r) => ({ ...r, h: fnv1a(`${r.key}::${String(r.value)}`) }))
    .sort((a, b) => (a.key === b.key ? a.h - b.h : a.key < b.key ? -1 : 1));

  const out = new Map<string, T[]>();
  for (const r of sorted) {
    const arr = out.get(r.key) ?? [];
    if (arr.length >= perKey) continue;
    arr.push(r.value);
    out.set(r.key, arr);
  }
  return out;
}
