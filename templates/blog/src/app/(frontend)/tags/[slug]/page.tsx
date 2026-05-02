/**
 * Tag Archive Page
 *
 * Posts with a given tag, paginated. Mirrors the category archive's
 * layout and SEO wiring: CollectionPage + BreadcrumbList JSON-LD,
 * full Metadata API, and a link to the tag's RSS feed.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/JsonLd";
import { ListingHeader } from "@/components/ListingHeader";
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

  const posts = await getPostsByTag(tag.id, { page: currentPage, limit: 9 });

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

      <ListingHeader
        label="Tag"
        title={`#${tag.name}`}
        description={tag.description ?? undefined}
        stats={[
          {
            // Phase 4 (Task 14): canonical envelope; total moved to meta.total.
            text: `${posts.meta.total} ${posts.meta.total === 1 ? "post" : "posts"}`,
          },
          { text: "RSS", href: `/tags/${slug}/feed.xml` },
        ]}
      />

      {/* Phase 4 (Task 14): canonical envelope; post slice is on `items`. */}
      <PostGrid posts={posts.items} />

      <div className="mt-12">
        <Pagination
          currentPage={currentPage}
          totalPages={posts.meta.totalPages}
          basePath={`/tags/${slug}`}
        />
      </div>
    </>
  );
}
