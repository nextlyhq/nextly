/**
 * Types for the cache-revalidation primitive.
 *
 * A write computes a {@link RevalidationIntent} — the set of cache tags (and, as
 * a fallback, paths) that a content change invalidates — from data available at
 * the write. The intent is framework-neutral: it is a list of plain strings,
 * computed in Node-safe core with no `next/*` import. A {@link CacheRevalidator}
 * implementation (registered by the framework adapter) later turns those strings
 * into `revalidateTag`/`revalidatePath` calls; core never touches `next/cache`.
 */

/**
 * A single path target for path-based invalidation. Paths are a fallback for the
 * cases where a route must flip (a slug's old URL 404-ing after unpublish), used
 * only when the route pattern is known; tags are the primary mechanism.
 */
export interface RevalidatePathTarget {
  /** The route path or route pattern (e.g. `/blog/[slug]`). */
  path: string;
  /** Next.js `revalidatePath` type; `page` unless invalidating a whole layout. */
  type?: "page" | "layout";
}

/**
 * The invalidation a single content change produces: the cache tags to bust and
 * any path targets to revalidate. Tags are deduplicated and never empty-string.
 */
export interface RevalidationIntent {
  /** Cache tags to invalidate (deduplicated, all `nextly:`-prefixed). */
  tags: string[];
  /** Optional path targets; present only when a known route must be flipped. */
  paths?: RevalidatePathTarget[];
}

/**
 * Input to entry tag computation. All slug/locale fields are optional so the same
 * computation serves create (no previous), update (previous slug for a rename),
 * and delete.
 */
export interface EntryRevalidationInput {
  /** The collection slug. */
  collection: string;
  /** The entry's immutable id — tagged so invalidation survives slug/status changes. */
  id: string;
  /** The entry's current slug, if the collection has one. */
  slug?: string;
  /**
   * The entry's slug BEFORE this write. When it differs from `slug`, the old
   * slug tag is also busted so a read cached under the previous URL clears.
   */
  previousSlug?: string;
  /** The locale this write applied to, for a localized collection. */
  locale?: string;
  /** Extra tags from the collection's `revalidate.tags` config, merged in verbatim. */
  extraTags?: string[];
}

/**
 * Input to singleton (global) tag computation.
 */
export interface SingleRevalidationInput {
  /** The single's slug. */
  slug: string;
  /** Extra tags from the single's `revalidate.tags` config, merged in verbatim. */
  extraTags?: string[];
}

/**
 * Per-collection / per-single revalidation configuration. A typed peer of
 * `status`/`versions`, replacing the previously untyped `custom.revalidateTags`
 * convention.
 */
export interface RevalidateConfig {
  /**
   * Extra cache tags to bust on every write to this collection/single, merged
   * with the derived `nextly:*` tags. Use for a shared tag several reads carry
   * (for example a site-wide `navigation` tag).
   */
  tags?: string[];
  /**
   * Opt this collection/single OUT of automatic cache revalidation entirely.
   * @default false
   */
  disable?: boolean;
}

/**
 * The framework-neutral sink for revalidation intents. The default
 * implementation is a no-op (non-Next runtimes, the CLI, tests); the Next
 * adapter implements it by mapping tags/paths to `revalidateTag`/`revalidatePath`.
 * Never throws: a revalidation failure must not turn a committed write into an
 * error.
 */
export interface CacheRevalidator {
  /** Flush the given intents to the underlying cache. Best-effort, never throws. */
  flush(intents: RevalidationIntent[]): void | Promise<void>;
}
