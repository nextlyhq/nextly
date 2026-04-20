/**
 * Blog Listing Page
 *
 * All published posts in a grid with URL-based pagination (/blog?page=2).
 */

import type { Metadata } from "next";

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

  const result = await getPosts({ page: currentPage, limit: 9 });

  return (
    <>
      <h1 className="mb-8 text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
        Blog
      </h1>

      <PostGrid posts={result.docs} />

      <div className="mt-12">
        <Pagination
          currentPage={currentPage}
          totalPages={result.totalPages}
          basePath="/blog"
        />
      </div>
    </>
  );
}
