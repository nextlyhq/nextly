/**
 * Author query helpers.
 *
 * "Authors" are users in this template (users-as-authors pattern).
 * These helpers go through `nextly.users` — the dedicated user
 * namespace backed by UserQueryService — because the generic
 * `nextly.find({ collection: "users" })` path routes through the
 * dynamic-collection registry and fails with
 *   NotFoundError: Schema for collection "users" not found in registry
 * since `users` is a static system table, not a dynamic collection.
 *
 * We keep the `getAuthorBySlug` / `getAllAuthorSlugs` names to match
 * the frontend mental model and the `/authors/[slug]` URL.
 *
 * Caching: reads are wrapped in `cachedFind`. Authors are the built-in
 * `users` collection, whose writes do not emit revalidation tags today — so
 * unlike posts/categories/tags, an edit to an author's profile cannot bust a
 * tag. These reads therefore carry a time-based safety net
 * (`AUTHOR_REVALIDATE_SECONDS`) so a profile change becomes visible within
 * that window; the `nextlyTags("users")` tag is kept so busting kicks in
 * automatically should user writes gain tag emission later. The cached value
 * is the public `Author` projection / slug list only — email, password, and
 * role fields are stripped before caching.
 */

// Pass nextlyConfig (loaded via the -config path alias) so
// getNextly() bootstraps with this project's collections list.
import { getNextly } from "nextly";
import { cachedFind, nextlyTags } from "nextly/runtime";
import nextlyConfig from "@nextly-config";

import { readOptionalString, toAuthor } from "./coerce";
import type { Author } from "./types";

/**
 * Time-based revalidation for author reads (seconds). Author profiles change
 * rarely and the `users` collection does not emit revalidation tags today, so
 * this window is how a profile edit eventually becomes visible. Lower it for
 * fresher author pages at a higher DB cost.
 */
const AUTHOR_REVALIDATE_SECONDS = 3600;

export async function getAuthorBySlug(slug: string): Promise<Author | null> {
  try {
    return await cachedFind(
      async () => {
        // nextly.users.find() doesn't support a `where` filter - it only exposes
        // full-text `search`. For a slug (which must be exact) we list users
        // and filter client-side. Author counts on a blog template are small
        // (typically <50) so the full page fetch is cheap.
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.users.find({ limit: 1000 });
        // User carries an index signature for its extension fields, so a user
        // doc is already readable as a record — no cast needed to narrow it.
        const match = result.items.find(
          d => readOptionalString(d, "slug") === slug
        );
        return match ? toAuthor(match) : null;
      },
      {
        tags: nextlyTags("users"),
        keyParts: ["users", "author", "detail", slug],
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
        const result = await nextly.users.find({ limit: 1000 });
        return result.items
          .map(d => readOptionalString(d, "slug"))
          .filter((s): s is string => typeof s === "string" && s.length > 0);
      },
      {
        tags: nextlyTags("users"),
        keyParts: ["users", "author", "slugs"],
        revalidate: AUTHOR_REVALIDATE_SECONDS,
      }
    );
  } catch (error) {
    console.error("Error fetching all author slugs:", error);
    return [];
  }
}
