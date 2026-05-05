/**
 * Category Archive Page
 *
 * Posts in a category with URL-based pagination.
 * Ships CollectionPage + BreadcrumbList JSON-LD.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/JsonLd";
import { ListingHeader } from "@/components/ListingHeader";
import { Pagination } from "@/components/Pagination";
import { PostGrid } from "@/components/PostGrid";
import {
  getAllCategorySlugs,
  getCategoryBySlug,
  getPostsByCategory,
} from "@/lib/queries";
import { absoluteUrl } from "@/lib/site-url";

export async function generateStaticParams() {
  const slugs = await getAllCategorySlugs();
  return slugs.map(slug => ({ slug }));
}

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: "Category Not Found" };

  const title = category.name;
  const description = category.description ?? `Posts in ${category.name}.`;
  const canonical = `/categories/${slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, type: "website", url: canonical },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const currentPage = Math.max(1, Number(pageParam) || 1);

  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const posts = await getPostsByCategory(category.id, {
    page: currentPage,
    limit: 9,
  });

  const collectionSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: category.name,
    description: category.description ?? undefined,
    url: absoluteUrl(`/categories/${slug}`),
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
        name: "Blog",
        item: absoluteUrl("/blog"),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: category.name,
        item: absoluteUrl(`/categories/${slug}`),
      },
    ],
  };

  return (
    <>
      <JsonLd data={[collectionSchema, breadcrumbSchema]} />
      <div className="mx-auto max-w-7xl px-6 py-20 md:py-32">
        <ListingHeader
          label="Category"
          title={category.name}
          description={category.description ?? undefined}
          stats={[
            {
              text: `${posts.meta.total} ${posts.meta.total === 1 ? "post" : "posts"}`,
            },
            { text: "RSS", href: `/categories/${slug}/feed.xml` },
          ]}
        />

        <PostGrid posts={posts.items} />

        <div className="mt-12">
          <Pagination
            currentPage={currentPage}
            totalPages={posts.meta.totalPages}
            basePath={`/categories/${slug}`}
          />
        </div>
      </div>
    </>
  );
}
