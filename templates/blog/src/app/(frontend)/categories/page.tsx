/**
 * Categories Index Page
 *
 * Lists every category as a clickable card with its description and
 * post count. Parallel to /tags which uses the TagCloud pattern; the
 * card grid fits the smaller, richer category set better than a cloud.
 */

import type { Metadata } from "next";

import { CategoryCardGrid } from "@/components/CategoryCardGrid";
import { ListingHeader } from "@/components/ListingHeader";
import { getAllCategoriesWithCounts, getSiteSettings } from "@/lib/queries";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  const title = "Categories";
  const description = `All categories on ${settings.siteName}.`;
  return {
    title,
    description,
    alternates: { canonical: "/categories" },
    openGraph: { title, description, type: "website", url: "/categories" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CategoriesIndexPage() {
  const categories = await getAllCategoriesWithCounts();

  // Sort by post count desc, ties broken alphabetically. Empty
  // categories still appear so the IA is visible even before content.
  const sorted = [...categories].sort((a, b) => {
    if (b.postCount !== a.postCount) return b.postCount - a.postCount;
    return a.item.name.localeCompare(b.item.name);
  });

  return (
    <>
      <ListingHeader
        title="Categories"
        description="Posts grouped by topic. Each category has a dedicated feed and archive page."
      />
      <CategoryCardGrid categories={sorted} />
    </>
  );
}
