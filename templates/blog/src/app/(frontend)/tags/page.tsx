/**
 * Tags Index Page
 *
 * All tags with their published-post counts. Acts as a topic directory
 * for the blog.
 */

import type { Metadata } from "next";
import Link from "next/link";

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

  // Sort by count descending, with ties broken alphabetically. Tags
  // with zero published posts are still shown — empty sections make
  // the schema discoverable even before content arrives.
  const sorted = [...tags].sort((a, b) => {
    if (b.postCount !== a.postCount) return b.postCount - a.postCount;
    return a.item.name.localeCompare(b.item.name);
  });

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          Tags
        </h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Browse posts by topic.
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 px-6 py-16 text-center dark:border-neutral-700">
          <p className="text-neutral-500 dark:text-neutral-400">
            No tags yet. Create tags in the admin panel.
          </p>
        </div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {sorted.map(({ item: tag, postCount }) => (
            <li key={tag.slug}>
              <Link
                href={`/tags/${tag.slug}`}
                className="inline-flex items-center gap-2 rounded-full border border-neutral-200 px-4 py-2 text-sm transition-colors hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:border-neutral-600 dark:hover:bg-neutral-900"
              >
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {tag.name}
                </span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {postCount}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
