import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchInsight } from "@/lib/api";
import { InsightDetail } from "@/components/insight-detail";
import { PageNav } from "@/components/page-nav";

export default async function InsightDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const insight = await fetchInsight(id);
  if (!insight) notFound();

  return (
    <article className="space-y-10">
      <PageNav />
      <Link href="/" className="text-ink-mute hover:text-ink inline-block text-xs">
        ← All insights
      </Link>
      <InsightDetail insight={insight} />
    </article>
  );
}
