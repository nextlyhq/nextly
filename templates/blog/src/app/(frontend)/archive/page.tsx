/**
 * Archive Page
 *
 * All published posts grouped by year, newest first. Compact "date →
 * title" rows for scanability. Ideal for long-running blogs — readers
 * can drop into any year without paginating the main listing.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/JsonLd";
import { getAllPublishedForArchive, getSiteSettings } from "@/lib/queries";
import { absoluteUrl } from "@/lib/site-url";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  const title = "Archive";
  const description = `All posts on ${settings.siteName}, organized by year.`;
  return {
    title,
    description,
    alternates: { canonical: "/archive" },
    openGraph: { title, description, type: "website", url: "/archive" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ArchivePage() {
  const posts = await getAllPublishedForArchive();

  // Bucket posts by publish year. Undated posts (no publishedAt) land
  // in the "Undated" bucket so they're still reachable from the archive.
  const byYear = new Map<number | "undated", typeof posts>();
  for (const post of posts) {
    const year = post.publishedAt
      ? new Date(post.publishedAt).getFullYear()
      : "undated";
    const bucket = byYear.get(year) ?? [];
    bucket.push(post);
    byYear.set(year, bucket);
  }

  // Sort years descending, keeping "undated" last. Guard for the both-
  // undated case so the comparator is a proper total order even though
  // Map keys can't actually duplicate in practice.
  const years = Array.from(byYear.keys()).sort((a, b) => {
    if (a === "undated") return b === "undated" ? 0 : 1;
    if (b === "undated") return -1;
    return (b as number) - (a as number);
  });

  const collectionSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Archive",
    description: `All posts, organized by year.`,
    url: absoluteUrl("/archive"),
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
        name: "Archive",
        item: absoluteUrl("/archive"),
      },
    ],
  };

  return (
    <>
      <JsonLd data={[collectionSchema, breadcrumbSchema]} />

      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          Archive
        </h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          {posts.length} post{posts.length === 1 ? "" : "s"}, newest first.
        </p>
      </div>

      {posts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 px-6 py-16 text-center dark:border-neutral-700">
          <p className="text-neutral-500 dark:text-neutral-400">
            No posts yet. Create your first post in the admin panel.
          </p>
        </div>
      ) : (
        years.map(year => (
          <section key={year} className="mb-10">
            <h2 className="mb-4 text-xl font-semibold tracking-tight text-neutral-700 dark:text-neutral-300">
              {year === "undated" ? "Undated" : year}
            </h2>
            <ul className="space-y-2">
              {byYear.get(year)!.map(post => {
                const date = post.publishedAt
                  ? new Date(post.publishedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  : "—";
                return (
                  <li key={post.id} className="flex gap-3 sm:gap-4">
                    <time
                      className="w-14 flex-none text-sm text-neutral-500 sm:w-16 dark:text-neutral-400"
                      dateTime={post.publishedAt ?? undefined}
                    >
                      {date}
                    </time>
                    <Link
                      href={`/blog/${post.slug}`}
                      className="text-neutral-900 hover:underline dark:text-neutral-100"
                    >
                      {post.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
