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
        "border-rule bg-background text-ink-soft inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
        className,
      )}
      {...props}
    />
  );
}
