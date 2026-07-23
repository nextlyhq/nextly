/**
 * Pure cache-tag computation. Given the facts of a content change, produce the
 * `nextly:*` tags it invalidates. No `next/*` import, no I/O — this runs in
 * Node-safe core and is exhaustively unit-testable in isolation.
 *
 * Tag scheme (tagged by immutable id, not only slug, so invalidation survives a
 * slug rename or a status change):
 *   nextly:{collection}                     collection-wide (lists, sitemaps)
 *   nextly:{collection}:id:{id}             one entry, across locales
 *   nextly:{collection}:id:{id}:{locale}    one entry in one locale
 *   nextly:{collection}:slug:{slug}         one entry by slug (old AND new on rename)
 *   nextly:single:{slug}                    a singleton / global
 */
import { NextlyError } from "../errors/nextly-error";

import type {
  EntryRevalidationInput,
  RevalidationIntent,
  SingleRevalidationInput,
} from "./types";

/** The shared namespace prefix, so consumer reads and busts never collide with app tags. */
const NAMESPACE = "nextly";

/**
 * Reject an empty/blank tag segment: a malformed tag would either over-invalidate
 * (a bare `nextly:` tag) or silently never match, so a blank id/collection/slug
 * is a programming error at the call site, not something to paper over.
 */
function requireSegment(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw NextlyError.internal({
      logContext: { reason: "empty-cache-tag-segment", field },
    });
  }
  return trimmed;
}

/** `nextly:{collection}` — busted by any change within the collection. */
export function collectionTag(collection: string): string {
  return `${NAMESPACE}:${requireSegment(collection, "collection")}`;
}

/** `nextly:{collection}:id:{id}` — the entity across all locales. */
export function entryIdTag(collection: string, id: string): string {
  return `${collectionTag(collection)}:id:${requireSegment(id, "id")}`;
}

/** `nextly:{collection}:id:{id}:{locale}` — the entity in one locale. */
export function entryIdLocaleTag(
  collection: string,
  id: string,
  locale: string
): string {
  return `${entryIdTag(collection, id)}:${requireSegment(locale, "locale")}`;
}

/** `nextly:{collection}:slug:{slug}` — the entity addressed by slug. */
export function entrySlugTag(collection: string, slug: string): string {
  return `${collectionTag(collection)}:slug:${requireSegment(slug, "slug")}`;
}

/** `nextly:single:{slug}` — a singleton / global, consumed sitewide. */
export function singleTag(slug: string): string {
  return `${NAMESPACE}:single:${requireSegment(slug, "slug")}`;
}

/** Order-preserving de-duplication, so a tag list never carries a repeat. */
function unique(tags: string[]): string[] {
  return [...new Set(tags)];
}

/**
 * The tags an entry write invalidates: the collection tag, the id tag (plus its
 * locale variant when localized), the current-slug tag, and — on a rename — the
 * previous-slug tag so a read cached under the old URL clears. Configured extra
 * tags are merged in verbatim.
 */
export function computeEntryRevalidation(
  input: EntryRevalidationInput
): RevalidationIntent {
  const { collection, id, slug, previousSlug, locale, extraTags } = input;

  const tags = [collectionTag(collection), entryIdTag(collection, id)];

  // Locale variant only when the write actually applied to a locale, so a
  // non-localized collection never emits a stray `:{locale}` tag.
  if (locale !== undefined && locale.trim().length > 0) {
    tags.push(entryIdLocaleTag(collection, id, locale));
  }

  // Current slug, and the previous slug when it differs, so a rename busts both
  // the new and the now-stale URL.
  if (slug !== undefined && slug.trim().length > 0) {
    tags.push(entrySlugTag(collection, slug));
  }
  if (
    previousSlug !== undefined &&
    previousSlug.trim().length > 0 &&
    previousSlug !== slug
  ) {
    tags.push(entrySlugTag(collection, previousSlug));
  }

  if (extraTags) tags.push(...extraTags);

  return { tags: unique(tags) };
}

/**
 * The tags a singleton write invalidates: its single tag plus any configured
 * extra tags. A global is consumed on every page, so its one tag is the whole
 * cascade.
 */
export function computeSingleRevalidation(
  input: SingleRevalidationInput
): RevalidationIntent {
  const { slug, extraTags } = input;
  const tags = [singleTag(slug)];
  if (extraTags) tags.push(...extraTags);
  return { tags: unique(tags) };
}
