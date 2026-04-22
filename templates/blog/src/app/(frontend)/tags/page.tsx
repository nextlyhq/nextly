/**
 * Tags Index Page
 *
 * Renders every tag as a cloud of chips sized by post count. See the
 * TagCloud component for the bucket thresholds.
 */

import type { Metadata } from "next";

import { ListingHeader } from "@/components/ListingHeader";
import { TagCloud } from "@/components/TagCloud";
import { getAllTagsWithCounts, getSiteSettings } from "@/lib/queries";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  const title = "Tags";
  const description = `All topics covered on ${settings.siteName}.`;
  return {
    title,
    description,
    alternates: { canonical: "/tags" },
    openGraph: { title, description, type: "website", url: "/tags" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function TagsIndexPage() {
  const tags = await getAllTagsWithCounts();

  // Sort by count desc, ties broken alphabetically. Empty-count tags
  // still appear so the schema is discoverable before content arrives.
  const sorted = [...tags].sort((a, b) => {
    if (b.postCount !== a.postCount) return b.postCount - a.postCount;
    return a.item.name.localeCompare(b.item.name);
  });

  return (
    <>
      <ListingHeader
        title="All tags"
        description="Browse posts by topic. Tag size reflects how often it's been written about."
      />
      <TagCloud tags={sorted} />
    </>
  );
}
