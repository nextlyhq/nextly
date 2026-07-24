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
 * Next silently drops a cache tag longer than 256 characters, so a tag built
 * from an over-long slug would never match and its read could never be
 * invalidated. Bound the slug tag below this and fall back to a hash.
 */
const MAX_TAG_LENGTH = 256;

/**
 * FNV-1a (32-bit), a small deterministic, dependency-free hash that runs the
 * same in Node, edge, and browser runtimes. Used to shorten an over-long tag
 * segment; both the write (bust) and the read (tag) call the same builder, so a
 * hashed tag stays consistent between them. A rare collision only over-
 * invalidates, which is harmless.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

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

/**
 * `nextly:{collection}:slug:{slug}` — the entity addressed by slug. A slug long
 * enough to push the tag past Next's 256-char cap is hashed instead, so the tag
 * stays matchable (Next drops an over-long tag, which would make the read
 * uninvalidatable).
 */
export function entrySlugTag(collection: string, slug: string): string {
  const prefix = `${collectionTag(collection)}:slug:`;
  const value = requireSegment(slug, "slug");
  const tag = `${prefix}${value}`;
  return tag.length <= MAX_TAG_LENGTH ? tag : `${prefix}h:${fnv1a(value)}`;
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
 * Trim configured extra tags and drop blank ones. Extra tags come from
 * user-supplied `revalidate.tags`, so a config typo (an empty or whitespace-only
 * entry, or a stray surrounding space) must never reach the adapter as a
 * malformed tag — it would over-invalidate or silently mismatch the read.
 */
function normalizeExtraTags(extraTags?: string[]): string[] {
  if (!extraTags) return [];
  return extraTags.map(tag => tag.trim()).filter(tag => tag.length > 0);
}

/**
 * The tags an entry write invalidates: the collection tag, the id tag (plus its
 * locale variant when localized), the current-slug tag, and — on a rename — the
 * previous-slug tag so a read cached under the old URL clears. Configured extra
 * tags are merged in (trimmed; blank entries dropped).
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

  tags.push(...normalizeExtraTags(extraTags));

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
  const tags = [singleTag(slug), ...normalizeExtraTags(extraTags)];
  return { tags: unique(tags) };
}
