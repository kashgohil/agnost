import { fetchInsights } from "@/lib/api";
import { FilterBar } from "@/components/filter-bar";
import { InsightListCard } from "@/components/insight-list-card";
import { PageNav } from "@/components/page-nav";

type SearchParams = { [k: string]: string | string[] | undefined };

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const usp = toUsp(params);
  const { insights, total, taxonomy_version } = await fetchInsights(usp);

  return (
    <div className="space-y-8">
      <PageNav />
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-medium tracking-tight">Insights</h1>
        <div className="text-xs text-[var(--color-ink-mute)]">
          {total} {total === 1 ? "insight" : "insights"}
          {taxonomy_version !== null && ` · taxonomy v${taxonomy_version}`}
        </div>
      </div>

      <FilterBar />

      {insights.length === 0 ? (
        <div className="border-t border-[var(--color-rule)] py-16 text-center text-sm text-[var(--color-ink-mute)]">
          No insights match these filters.
        </div>
      ) : (
        <div className="border-t border-[var(--color-rule)]">
          {insights.map((i) => (
            <InsightListCard key={i.id} insight={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function toUsp(params: SearchParams): URLSearchParams {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) usp.append(k, item);
    else usp.append(k, v);
  }
  return usp;
}
