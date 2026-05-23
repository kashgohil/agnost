"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/", label: "Insights" },
  { href: "/clusters", label: "Clusters" },
] as const;

export function PageNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-10 flex items-center gap-5 text-sm">
      {LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "transition-colors",
              active
                ? "text-[var(--color-ink)]"
                : "text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
