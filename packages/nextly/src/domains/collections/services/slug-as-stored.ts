/**
 * A slug as a collection stores it, the one rule for core's own writes and
 * for a plugin that says where an entry will land before it is written.
 *
 * @module domains/collections/services/slug-as-stored
 */
import { collectionDbOptions } from "./collection-id";
import { generateSlug, normalizeSlugPath } from "./collection-utils";

/**
 * `value` as `collection` stores a slug: one segment, normalised by
 * {@link generateSlug}, so a `/` is dropped; or, where the collection's
 * `db.slugPaths` is on, a path of several, each normalised alike
 * ({@link normalizeSlugPath}), with the reason where it can't be one.
 */
export function slugAsStored(
  collection: string,
  value: string
): { readonly slug: string } | { readonly problem: string } {
  if (collectionDbOptions(collection).slugPaths !== true) {
    return { slug: generateSlug(value) };
  }
  return normalizeSlugPath(value);
}
