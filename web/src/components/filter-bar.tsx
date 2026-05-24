"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { PROBLEM_TAGS, SEVERITY_TAGS, TRAJECTORY_TAGS } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Checkbox } from "./ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

const SORT_OPTIONS = [
  { value: "volume_desc", label: "Volume, high to low" },
  { value: "volume_asc", label: "Volume, low to high" },
  { value: "sentiment_asc", label: "Worst sentiment" },
  { value: "recent", label: "Most recent" },
] as const;

export function FilterBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const activeTags = new Set(params.getAll("tag"));
  const sort = params.get("sort") ?? "volume_desc";
  const includeUncategorized = params.get("include_uncategorized") === "true";
  const hasFilters =
    activeTags.size > 0 || sort !== "volume_desc" || includeUncategorized;

  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    startTransition(() => router.replace(`/?${next.toString()}`));
  };

  const toggleTag = (tag: string) => {
    update((p) => {
      const had = p.getAll("tag").includes(tag);
      const all = p.getAll("tag").filter((t) => t !== tag);
      p.delete("tag");
      for (const t of all) p.append("tag", t);
      if (!had) p.append("tag", tag);
    });
  };

  return (
    <div className="space-y-4">
      <FilterRow
        title="Problem"
        tags={PROBLEM_TAGS}
        active={activeTags}
        onToggle={toggleTag}
      />
      <FilterRow
        title="Trajectory"
        tags={TRAJECTORY_TAGS}
        active={activeTags}
        onToggle={toggleTag}
      />
      <FilterRow
        title="Severity"
        tags={SEVERITY_TAGS}
        active={activeTags}
        onToggle={toggleTag}
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
        <div className="flex items-center gap-3">
          <span className="text-ink-soft text-xs">Sort</span>
          <Select
            value={sort}
            onValueChange={(v) => update((p) => p.set("sort", v))}
          >
            <SelectTrigger className="min-w-45">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={includeUncategorized}
            onCheckedChange={(checked) =>
              update((p) => {
                if (checked) p.set("include_uncategorized", "true");
                else p.delete("include_uncategorized");
              })
            }
          />
          <span className="text-ink-soft text-xs">Include uncategorized</span>
        </label>
        {hasFilters && (
          <button
            type="button"
            onClick={() => startTransition(() => router.replace("/"))}
            className="text-ink-mute hover:text-ink ml-auto text-xs underline-offset-2 hover:underline"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function FilterRow({
  title,
  tags,
  active,
  onToggle,
}: {
  title: string;
  tags: readonly string[];
  active: Set<string>;
  onToggle: (tag: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <div className="text-ink-mute w-24 shrink-0 text-xs">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => {
          const isActive = active.has(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onToggle(tag)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                isActive
                  ? "border-ink bg-ink text-background"
                  : "border-rule text-ink-soft hover:border-ink hover:text-ink",
              )}
            >
              {tag.replaceAll("_", " ")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
