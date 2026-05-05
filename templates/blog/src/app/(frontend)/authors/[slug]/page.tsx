/**
 * Author Profile Page
 *
 * Profile-centered layout:
 *   Big centered avatar
 *   Name (H1)
 *   Bio (centered, max-w-prose)
 *   Stats row (post count, RSS)
 *   Divider
 *   Posts by author in a 3-col grid
 *
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
  // "Authors" step because we don't ship a public /authors index.
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

      {/* Profile-centered header */}
      <div className="mx-auto mb-12 max-w-xl text-center">
        <AuthorCard author={author} variant="full" />
        <div
          className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm"
          style={{ color: "var(--color-fg-muted)" }}
        >
          <span>
            {posts.meta.total} {posts.meta.total === 1 ? "post" : "posts"}
          </span>
          <span aria-hidden="true">·</span>
          <a
            href={`/authors/${slug}/feed.xml`}
            className="transition-opacity hover:opacity-80"
            style={{ color: "var(--color-accent)" }}
          >
            RSS
          </a>
        </div>
      </div>

      <div
        className="mb-8 h-px"
        style={{ background: "var(--color-border)" }}
      />

      <section>
        <h2
          className="mb-6 text-xs font-semibold uppercase tracking-widest"
          style={{ color: "var(--color-fg-muted)" }}
        >
          Posts by {author.name}
        </h2>
        <PostGrid posts={posts.items} />
      </section>
    </>
  );
}
