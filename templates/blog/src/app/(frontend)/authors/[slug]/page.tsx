/**
 * Author Profile Page
 *
 * Author card + their published posts, newest first.
 * Ships Person + BreadcrumbList JSON-LD.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AuthorCard } from "@/components/AuthorCard";
import { JsonLd } from "@/components/JsonLd";
import { PostGrid } from "@/components/PostGrid";
import {
  getAllAuthorSlugs,
  getAuthorBySlug,
  getPostsByAuthor,
} from "@/lib/queries";
import { absoluteUrl } from "@/lib/site-url";

export async function generateStaticParams() {
  const slugs = await getAllAuthorSlugs();
  return slugs.map(slug => ({ slug }));
}

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const author = await getAuthorBySlug(slug);
  if (!author) return { title: "Author Not Found" };

  const title = author.name;
  const description = author.bio ?? `Posts by ${author.name}.`;
  const canonical = `/authors/${slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "profile",
      url: canonical,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function AuthorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const author = await getAuthorBySlug(slug);
  if (!author) notFound();

  const posts = await getPostsByAuthor(author.id, { limit: 20 });

  const personSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: author.name,
    description: author.bio ?? undefined,
    image: author.avatarUrl ?? undefined,
    url: absoluteUrl(`/authors/${slug}`),
  };

  // Two-item breadcrumb (Home → Author). Intentionally no middle
  // "Authors" step because we don't ship a public /authors index route;
  // pointing a breadcrumb labeled "Authors" at /blog would mismatch the
  // destination page's H1 and fail Google's rich-result validation.
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
        name: author.name,
        item: absoluteUrl(`/authors/${slug}`),
      },
    ],
  };

  return (
    <>
      <JsonLd data={[personSchema, breadcrumbSchema]} />

      <div className="mb-12">
        <AuthorCard author={author} variant="full" />
      </div>

      <section>
        <h2 className="mb-8 text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Posts by {author.name}
        </h2>
        <PostGrid posts={posts.docs} />
      </section>
    </>
  );
}
