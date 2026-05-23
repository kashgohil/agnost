import * as React from "react";

import { cn } from "@/lib/cn";

// Uniform tag treatment. Differentiation comes from the text, not the chrome.
export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[var(--color-rule)] bg-[var(--color-background)] px-2 py-0.5 text-xs text-[var(--color-ink-soft)]",
        className,
      )}
      {...props}
    />
  );
}
