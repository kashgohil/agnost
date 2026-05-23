import { fetchClusters } from "@/lib/api";
import { ClustersView } from "@/components/clusters-view";
import { PageNav } from "@/components/page-nav";

export default async function ClustersPage() {
  const data = await fetchClusters();
  const surfaced = data.clusters.filter((c) => c.insight_id !== null).length;
  const noise = data.intents.filter((i) => i.cluster_id === null).length;

  return (
    <div className="space-y-8">
      <PageNav />

      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-medium tracking-tight">Clusters</h1>
        <div className="text-ink-mute text-xs">
          {data.clusters.length} {data.clusters.length === 1 ? "cluster" : "clusters"}
          {" · "}
          {surfaced} surfaced as insights
          {" · "}
          {noise} noise {noise === 1 ? "point" : "points"}
        </div>
      </div>

      <p className="text-ink-soft max-w-2xl text-sm">
        Every group HDBSCAN found, including those that didn&apos;t cross insight thresholds.
        Each point on the scatter is one intent string projected to 2D via UMAP — same color
        means same cluster. Grey points are noise (intents too unique to group).
      </p>

      <ClustersView clusters={data.clusters} intents={data.intents} />
    </div>
  );
}
