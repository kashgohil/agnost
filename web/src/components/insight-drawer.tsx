"use client";

import { useEffect, useState } from "react";

import type { Insight } from "@/lib/types";
import { InsightDetail } from "./insight-detail";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "./ui/sheet";

// Client-side drawer for viewing an insight in context (currently from the
// Clusters view). Fetches on open; replaces fetch when insightId changes.

export function InsightDrawer({
  insightId,
  onOpenChange,
}: {
  insightId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // All state updates live inside the async closure so the synchronous body
    // of the effect doesn't call setState — react-hooks/set-state-in-effect.
    const run = async () => {
      if (!insightId) {
        setData(null);
        setErr(null);
        return;
      }
      setLoading(true);
      setErr(null);
      setData(null);
      try {
        const r = await fetch(`/api/v1/insights/${insightId}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as Insight;
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [insightId]);

  return (
    <Sheet open={insightId !== null} onOpenChange={onOpenChange}>
      <SheetContent>
        <div className="px-8 pt-12 pb-8">
          {/* a11y: dialog requires a Title + Description even if visually muted */}
          <SheetTitle className="sr-only">
            {data?.headline ?? "Insight detail"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Detailed view of the selected insight including metrics, tags, and the
            conversations that produced it.
          </SheetDescription>

          {err && (
            <div className="text-negative text-sm">Failed to load: {err}</div>
          )}
          {loading && (
            <div className="space-y-4">
              <div className="bg-rule h-3 w-20 rounded" />
              <div className="bg-rule h-7 w-3/4 rounded" />
              <div className="bg-rule h-7 w-1/2 rounded" />
              <div className="bg-paper mt-8 h-24 rounded" />
            </div>
          )}
          {data && <InsightDetail insight={data} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
