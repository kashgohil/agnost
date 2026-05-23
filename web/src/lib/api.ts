// Server-side data fetchers. Called from server components so the JSON
// round-trip stays inside the Next process — browser only sees fully-rendered
// HTML for the initial paint.

import type {
  ClustersResponse,
  EvalSetResponse,
  Insight,
  ListInsightsResponse,
} from "./types.ts";

// In server components we hit the proxy via the Next process; absolute base
// derived from env (set in next.config.ts AGNOST_API_BASE fallback). On the
// server we go direct to the backend, skipping the rewrite hop.
const SERVER_API_BASE = process.env.AGNOST_API_BASE ?? "http://localhost:3000";

export async function fetchInsights(searchParams: URLSearchParams): Promise<ListInsightsResponse> {
  const url = `${SERVER_API_BASE}/v1/insights?${searchParams.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetchInsights failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function fetchInsight(id: string): Promise<Insight | null> {
  const res = await fetch(`${SERVER_API_BASE}/v1/insights/${id}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchInsight failed: ${res.status}`);
  return res.json();
}

export async function fetchClusters(): Promise<ClustersResponse> {
  const res = await fetch(`${SERVER_API_BASE}/v1/clusters`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetchClusters failed: ${res.status}`);
  return res.json();
}

export async function fetchEvalSet(
  id: string,
  limit: number,
  offset: number,
): Promise<EvalSetResponse | null> {
  const res = await fetch(
    `${SERVER_API_BASE}/v1/insights/${id}/eval-set?limit=${limit}&offset=${offset}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchEvalSet failed: ${res.status}`);
  return res.json();
}
