/**
 * Blog Listing Page
 *
 * All published posts in a grid with URL-based pagination
 * (/blog?page=2). Uses the shared ListingHeader pattern for visual
 * consistency with category / tag / author archives.
 */

import type { Metadata } from "next";

import { ListingHeader } from "@/components/ListingHeader";
import { Pagination } from "@/components/Pagination";
import { PostGrid } from "@/components/PostGrid";
import { getPosts, getSiteSettings } from "@/lib/queries";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  const title = "Blog";
  const description = `All posts on ${settings.siteName}.`;
  return {
    title,
    description,
    alternates: { canonical: "/blog" },
    openGraph: { title, description, type: "website", url: "/blog" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const currentPage = Math.max(1, Number(pageParam) || 1);

  const { items, meta } = await getPosts({ page: currentPage, limit: 9 });

  return (
    <div className="mx-auto max-w-7xl px-6 py-20 md:py-32">
      <ListingHeader
        title="All posts"
        description="Every published post, newest first."
        stats={[
          {
            text: `${meta.total} ${meta.total === 1 ? "post" : "posts"}`,
          },
          { text: "RSS", href: "/feed.xml" },
        ]}
      />

      <PostGrid posts={items} />

      <div className="mt-12">
        <Pagination
          currentPage={currentPage}
          totalPages={meta.totalPages}
          basePath="/blog"
        />
      </div>
    </div>
  );
}
