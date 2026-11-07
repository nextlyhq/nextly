/**
 * Author query helpers.
 *
 * An author is a public profile in the `authors` collection: the byline a
 * post credits, with the page at `/authors/[slug]`. It is not the `users`
 * account that owns a post, which is private and which no page reads.
 *
 * Caching: reads are wrapped in `cachedFind` and tagged with the `authors`
 * collection, which busts its tags on write, so an edited profile appears on
 * the next visit. A time-based window stays as a safety net. The cached value
 * is the public `Author` projection, or the slug list.
 */

// Pass nextlyConfig (loaded via the -config path alias) so
// getNextly() bootstraps with this project's collections list.
// Registers Nextly's cached reads under Cache Components (see the file).
import "@/nextly/cached-read";
import { getNextly } from "nextly";
import { cachedFind, nextlyTags } from "nextly/runtime";
import nextlyConfig from "@nextly-config";

import { readOptionalString, toAuthor } from "./coerce";
import type { Author } from "./types";

/**
 * Time-based safety net for author reads (seconds). A profile write busts the
 * `authors` tags, so this only bounds a missed refresh.
 */
const AUTHOR_REVALIDATE_SECONDS = 3600;

export async function getAuthorBySlug(slug: string): Promise<Author | null> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "authors",
          where: { slug: { equals: slug } },
          limit: 1,
          depth: 0,
        });
        const match = result.items[0];
        return match ? toAuthor(match) : null;
      },
      {
        tags: nextlyTags("authors"),
        keyParts: ["authors", "detail", slug],
        revalidate: AUTHOR_REVALIDATE_SECONDS,
      }
    );
  } catch (error) {
    // Rethrow, don't return null: a genuine miss returns null above, but
    // swallowing a transient error into null would bake a timerless
    // notFound() on /authors/[slug] — a permanent 404 for a real author.
    console.error(`Error fetching author by slug ${slug}:`, error);
    throw error;
  }
}

export async function getAllAuthorSlugs(): Promise<string[]> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "authors",
          limit: 1000,
          depth: 0,
        });
        return result.items
          .map(d => readOptionalString(d, "slug"))
          .filter((s): s is string => typeof s === "string" && s.length > 0);
      },
      {
        tags: nextlyTags("authors"),
        keyParts: ["authors", "slugs"],
        revalidate: AUTHOR_REVALIDATE_SECONDS,
      }
    );
  } catch (error) {
    console.error("Error fetching all author slugs:", error);
    return [];
  }
}
