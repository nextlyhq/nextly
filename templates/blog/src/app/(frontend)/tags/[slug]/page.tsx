/**
 * Tag Archive Page
 *
 * Posts with a given tag, paginated. Mirrors the category archive's
 * layout and SEO wiring — CollectionPage + BreadcrumbList JSON-LD,
 * full Metadata API, and a link to the tag's RSS feed.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/JsonLd";
import { Pagination } from "@/components/Pagination";
import { PostGrid } from "@/components/PostGrid";
import { getAllTagSlugs, getPostsByTag, getTagBySlug } from "@/lib/queries";
import { absoluteUrl } from "@/lib/site-url";

export async function generateStaticParams() {
  const slugs = await getAllTagSlugs();
  return slugs.map(slug => ({ slug }));
}

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tag = await getTagBySlug(slug);
  if (!tag) return { title: "Tag Not Found" };

  const title = `#${tag.name}`;
  const description = tag.description ?? `Posts tagged ${tag.name}.`;
  const canonical = `/tags/${slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, type: "website", url: canonical },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function TagPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const currentPage = Math.max(1, Number(pageParam) || 1);

  const tag = await getTagBySlug(slug);
  if (!tag) notFound();

  const posts = await getPostsByTag(tag.id, {
    page: currentPage,
    limit: 9,
  });

  const collectionSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: tag.name,
    description: tag.description ?? undefined,
    url: absoluteUrl(`/tags/${slug}`),
  };

  const breadcrumbSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: absoluteUrl("/"),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Tags",
        item: absoluteUrl("/tags"),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: tag.name,
        item: absoluteUrl(`/tags/${slug}`),
      },
    ],
  };

  return (
    <>
      <JsonLd data={[collectionSchema, breadcrumbSchema]} />

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            #{tag.name}
          </h1>
          {tag.description && (
            <p className="mt-2 text-neutral-600 dark:text-neutral-400">
              {tag.description}
            </p>
          )}
        </div>
        <Link
          href={`/tags/${slug}/feed.xml`}
          className="text-sm font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          RSS
        </Link>
      </div>

      <PostGrid posts={posts.docs} />

      <div className="mt-12">
        <Pagination
          currentPage={currentPage}
          totalPages={posts.totalPages}
          basePath={`/tags/${slug}`}
        />
      </div>
    </>
  );
}
