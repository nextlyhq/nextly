/**
 * Read-side tag builder. A cached read attaches the tags a write later busts, so
 * both sides go through the same `nextly:*` scheme (`revalidation/compute-tags`):
 * a change to an entry busts `nextly:{collection}:id:{id}`, which invalidates any
 * read tagged with it.
 *
 * @module runtime/cache/nextly-tags
 */
import {
  collectionTag,
  entryIdLocaleTag,
  entryIdTag,
  singleTag,
} from "../../revalidation/compute-tags";

/**
 * The tags a content read should carry so an on-write bust invalidates it.
 *
 * - `nextlyTags("posts")` → the collection tag: for a listing / index / sitemap
 *   read, invalidated by any change in the collection.
 * - `nextlyTags("posts", id)` → the collection tag + the entry-id tag: for an
 *   entry detail read, invalidated when that entry changes in any locale (tag by
 *   the immutable id, not the slug, so a rename still invalidates).
 * - `nextlyTags("posts", id, locale)` → adds the per-locale id tag, so a
 *   publish-one-locale busts only that locale's read.
 *
 * Tag reads by the entry's immutable id (available after the fetch resolves),
 * not its slug: the write busts the id tag on every change, so the read stays
 * invalidatable across slug and status changes.
 */
export function nextlyTags(
  collection: string,
  id?: string,
  locale?: string
): string[] {
  const tags = [collectionTag(collection)];
  if (id !== undefined && id.trim().length > 0) {
    tags.push(entryIdTag(collection, id));
    if (locale !== undefined && locale.trim().length > 0) {
      tags.push(entryIdLocaleTag(collection, id, locale));
    }
  }
  return tags;
}

/**
 * The tag a singleton / global read should carry, so a write to that single
 * invalidates every page that consumed it.
 */
export function nextlySingleTags(slug: string): string[] {
  return [singleTag(slug)];
}
