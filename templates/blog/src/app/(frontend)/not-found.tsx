/**
 * Custom 404 page for the frontend route group.
 *
 * Branded message + link back home + the latest posts as a "maybe you
 * meant one of these" grid. Using the frontend layout (header + footer)
 * via the route group.
 */

import Link from "next/link";

import { PostGrid } from "@/components/PostGrid";
import { getLatestPosts } from "@/lib/queries";

export default async function NotFound() {
  const latest = await getLatestPosts(3);

  return (
    <div>
      <div className="py-16 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          404
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-100">
          Page not found
        </h1>
        <p className="mt-4 text-neutral-600 dark:text-neutral-400">
          Sorry, we couldn&rsquo;t find the page you&rsquo;re looking for.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Back to home
        </Link>
      </div>

      {latest.length > 0 && (
        <section className="mt-12 border-t border-neutral-200 pt-12 dark:border-neutral-800">
          <h2 className="mb-8 text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Latest Posts
          </h2>
          <PostGrid posts={latest} />
        </section>
      )}
    </div>
  );
}
