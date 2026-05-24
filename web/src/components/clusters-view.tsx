"use client";

import { useState } from "react";

import type { ClusterRow, IntentRow } from "@/lib/types";
import { ClusterList } from "./cluster-list";
import { ClusterScatter } from "./cluster-scatter";
import { InsightDrawer } from "./insight-drawer";

// Stateful wrapper: scatter and list share a focused cluster. Clicking an
// insight chip from a cluster row opens the insight drawer.
export function ClustersView({
  clusters,
  intents,
}: {
  clusters: ClusterRow[];
  intents: IntentRow[];
}) {
  const [focused, setFocused] = useState<string | null>(null);
  const [openInsightId, setOpenInsightId] = useState<string | null>(null);

  return (
    <>
      <div className="space-y-8">
        <ClusterScatter
          clusters={clusters}
          intents={intents}
          focusedClusterId={focused}
          onFocus={setFocused}
          onOpenInsight={(clusterId) => {
            // From the scatter, the user picks a cluster but no specific partition.
            // Open the first insight on that cluster, if any.
            if (!clusterId) return;
            const cluster = clusters.find((c) => c.id === clusterId);
            const first = cluster?.insights[0];
            if (first) setOpenInsightId(first.id);
          }}
        />
        <ClusterList
          clusters={clusters}
          focusedClusterId={focused}
          onFocus={setFocused}
          onOpenInsight={(insightId) => setOpenInsightId(insightId)}
        />
      </div>
      <InsightDrawer
        insightId={openInsightId}
        onOpenChange={(open) => !open && setOpenInsightId(null)}
      />
    </>
  );
}
