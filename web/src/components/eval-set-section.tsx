"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";

import type { EvalSetConversation, EvalSetResponse } from "@/lib/types";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";

const PAGE_SIZE = 5;

export function EvalSetSection({ insightId }: { insightId: string }) {
  const [opened, setOpened] = useState(false);
  const [items, setItems] = useState<EvalSetConversation[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;

    // State resets live inside the async closure so they don't sit in the
    // synchronous body of the effect — keeps the react-hooks lint happy and
    // makes the fetch lifecycle linear.
    const run = async () => {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch(
          `/api/v1/insights/${insightId}/eval-set?limit=${PAGE_SIZE}&offset=${offset}`,
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as EvalSetResponse;
        if (cancelled) return;
        setTotal(data.total);
        setItems((prev) =>
          offset === 0 ? data.conversations : [...prev, ...data.conversations],
        );
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
  }, [opened, offset, insightId]);

  if (!opened) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpened(true)}>
        Show conversations
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      {err && <div className="text-negative text-sm">Error: {err}</div>}
      <div className="border-rule border-t">
        {items.map((c) => (
          <ConversationCard key={c.conversation_id} conv={c} />
        ))}
      </div>
      {loading && <div className="text-ink-mute py-2 text-xs">Loading…</div>}
      <div className="flex items-center gap-4 pt-2">
        {total !== null && items.length < total && !loading && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(items.length)}
          >
            Load more
          </Button>
        )}
        {total !== null && (
          <span className="text-ink-mute text-xs">
            Showing {items.length} of {total}
          </span>
        )}
      </div>
    </div>
  );
}

function ConversationCard({ conv }: { conv: EvalSetConversation }) {
  return (
    <Collapsible className="group border-rule border-b">
      <CollapsibleTrigger className="hover:bg-paper flex w-full cursor-pointer items-center gap-3 py-3 text-left text-sm">
        <ChevronRight className="text-ink-mute h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
        <span className="text-ink-soft font-mono text-xs">
          {conv.conversation_id}
        </span>
        <span className="text-ink-mute text-xs">
          · {conv.end_reason.replaceAll("_", " ")} ·{" "}
          {new Date(conv.started_at).toLocaleDateString()}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 py-4 pr-4 pl-6">
          {conv.turns.map((t) => (
            <div key={t.turn_id} className="text-sm">
              <div className="text-ink-mute text-xs">{t.role}</div>
              <div className="text-ink mt-0.5">{t.content}</div>
              {t.tool_calls.map((tc) => (
                <div
                  key={tc.tool_call_id}
                  className="text-ink-mute mt-1.5 flex flex-wrap items-center gap-2 text-xs"
                >
                  <span className="font-mono">{tc.tool_name}</span>
                  <span
                    style={{
                      color:
                        tc.status === "success"
                          ? "var(--color-positive)"
                          : "var(--color-negative)",
                    }}
                  >
                    {tc.status}
                  </span>
                  <span>{tc.latency_ms}ms</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
