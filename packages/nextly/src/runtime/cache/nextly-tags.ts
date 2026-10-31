/**
 * Read-side tag builder. A cached read attaches the tags a write later busts, so
 * both sides go through the same `nextly:*` scheme (`revalidation/compute-tags`):
 * a change to an entry busts `nextly:{collection}:id:{id}`, which invalidates any
 * read tagged with it.
 *
 * @module runtime/cache/nextly-tags
 */
import { getNextlyLogger } from "../../observability/logger";
import {
  MAX_TAG_LENGTH,
  collectionTag,
  entryIdLocaleTag,
  entryIdTag,
  singleTag,
} from "../../revalidation/compute-tags";

/**
 * `nextly:{collection}:id:{id}` on its own — the entity, without its collection.
 *
 * Published beside {@link nextlyTags} rather than instead of it, because the
 * two answer different questions and the collection tag is the wrong answer
 * for some reads. A read that names ONE record it already knows the id of —
 * a page inlining the components it embeds, say — wants to regenerate when
 * that record changes and not when any of its siblings do. Tagged with the
 * collection, publishing one component would rebuild every page on the site
 * that embeds any component.
 *
 * A read that DISCOVERS which records it wants still needs the collection tag:
 * a listing has no id to name until it runs, so nothing narrower can tell it
 * that a newly created row belongs in it.
 */
export { entryIdTag };

/**
 * The tags a content read should carry so an on-write bust invalidates it.
 *
 * - `nextlyTags("posts")` → the collection tag: for a listing / index / sitemap
 *   read, invalidated by any change in the collection.
 * - `nextlyTags("posts", id)` → the collection tag + the entry-id tag: for an
 *   entry detail read, invalidated when that entry changes in any locale (tag by
 *   the immutable id, not the slug, so a rename still invalidates).
 * - `nextlyTags("posts", id, locale)` → also adds the per-locale id tag.
 *
 * Tag reads by the entry's immutable id (available after the fetch resolves),
 * not its slug: the write busts the id tag on every change, so the read stays
 * invalidatable across slug and status changes.
 *
 * A detail read intentionally carries the collection tag too, so it also
 * refreshes when the collection changes around it (a new sibling, a reorder).
 * Because a match on ANY tag invalidates the entry, that broadens invalidation:
 * a change to one entry (which busts `nextly:{collection}`) refreshes every
 * detail read in the collection. That is safe — a stale read is never served,
 * only re-fetched more often. A high-traffic site that wants strictly per-entry
 * (or per-locale) granularity should tag with the entry/locale tag alone rather
 * than this helper's broad, safe default.
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
 * Next.js keeps at most 128 tags on one cached read and drops the rest, with a
 * warning naming them. The limit is per read: a write may expire any number.
 */
export const MAX_TAGS_PER_READ = 128;

/** Whether a read past the limit has been reported, so a busy page logs once. */
let readTagsDropReported = false;

/**
 * The tags one cached read carries: its own (the collection's or Single's)
 * first, then the caller's, each once, and no more than Next.js keeps. Its own
 * come first so the tag every write to it expires is never the one dropped.
 * A tag longer than Next.js accepts is left out before the count, since Next.js
 * would drop it anyway and it must not push a valid tag past the limit.
 */
export function readTags(
  own: readonly string[],
  extra: readonly string[] = []
): string[] {
  const tags = [...new Set([...own, ...extra])].filter(
    tag => tag.length <= MAX_TAG_LENGTH
  );
  if (tags.length <= MAX_TAGS_PER_READ) return tags;
  if (!readTagsDropReported) {
    readTagsDropReported = true;
    getNextlyLogger().warn({
      kind: "read-tags-dropped",
      message: `A cached read named ${tags.length} tags, more than the ${MAX_TAGS_PER_READ} Next.js keeps; the last ${tags.length - MAX_TAGS_PER_READ} were left off, so a write that expires only those leaves it cached until its own collection or Single changes.`,
      kept: MAX_TAGS_PER_READ,
      named: tags.length,
    });
  }
  return tags.slice(0, MAX_TAGS_PER_READ);
}

/**
 * The tag a singleton / global read should carry, so a write to that single
 * invalidates every page that consumed it.
 */
export function nextlySingleTags(slug: string): string[] {
  return [singleTag(slug)];
}
