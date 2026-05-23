"use client";

import { useState } from "react";

import type { ClusterRow, IntentRow } from "@/lib/types";
import { ClusterList } from "./cluster-list";
import { ClusterScatter } from "./cluster-scatter";

// Stateful wrapper: shared focus between scatter and list.
export function ClustersView({
  clusters,
  intents,
}: {
  clusters: ClusterRow[];
  intents: IntentRow[];
}) {
  const [focused, setFocused] = useState<string | null>(null);
  return (
    <div className="space-y-8">
      <ClusterScatter
        clusters={clusters}
        intents={intents}
        focusedClusterId={focused}
        onFocus={setFocused}
      />
      <ClusterList clusters={clusters} focusedClusterId={focused} onFocus={setFocused} />
    </div>
  );
}
