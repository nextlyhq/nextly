/**
 * `cachedFind` — cache a content read and tag it so an on-write bust makes it
 * fresh. A thin wrapper over Next's `unstable_cache`, the tagging mechanism
 * supported across the whole `next` peer range (`^14 || ^15 || ^16`). Outside a
 * Next runtime (or when `next/cache` is unavailable) it runs the reader directly
 * so the same code works in tests and non-Next callers.
 *
 * `next/cache` is resolved lazily via `createRequire` (Node's CommonJS resolver,
 * opaque to bundlers) — the same pattern the write-side adapter uses.
 *
 * @module runtime/cache/cached-find
 */
import { createRequire } from "node:module";

/** The subset of `unstable_cache` this helper uses. */
export type UnstableCache = <T>(
  cb: () => Promise<T>,
  keyParts: string[],
  options: { tags?: string[]; revalidate?: number | false }
) => () => Promise<T>;

let cachedUnstableCache: UnstableCache | null | undefined;

function loadUnstableCache(): UnstableCache | null {
  if (cachedUnstableCache !== undefined) return cachedUnstableCache;
  try {
    const require = createRequire(import.meta.url);
    const mod = require("next/cache") as { unstable_cache?: UnstableCache };
    cachedUnstableCache =
      typeof mod.unstable_cache === "function" ? mod.unstable_cache : null;
  } catch {
    cachedUnstableCache = null;
  }
  return cachedUnstableCache;
}

/** Options for {@link cachedFind}. */
export interface CachedFindOptions {
  /**
   * The cache tags this read carries — use {@link nextlyTags} so a write's bust
   * invalidates it. A change matching any tag makes the next request re-run the
   * reader.
   */
  tags: string[];
  /**
   * The parts that make this cache entry unique, e.g. `["posts", slug]`. Beyond
   * the query itself, **include anything the result varies by**.
   *
   * SECURITY: if the read applies per-caller access rules (owner-only scoping,
   * role-based visibility, an API-key's narrowed scope), EVERY dimension those
   * rules read MUST be in `keyParts` — not merely who the caller is. A user id
   * alone survives a role change, a claim change and a narrower key scope, so
   * the same person can fill an entry while privileged and read it back after
   * being downgraded: tags bust on CONTENT changes, and a permission change is
   * not one. Two different
   * users share one cache entry when their `keyParts` match, so caching an
   * owner-filtered list under a stable key would serve one user's rows to
   * another — a cross-tenant leak, not a stale-cache annoyance. For genuinely
   * public content (the same for every reader) a stable key is correct and gives
   * the full ISR benefit.
   */
  keyParts: string[];
  /**
   * Optional time-based revalidation in seconds (a safety net on top of
   * tag-based busting). `false` (the default) means the entry only ever
   * revalidates on a tag bust.
   */
  revalidate?: number | false;
}

/**
 * Run `reader` behind Next's tagged cache. On a cache hit the reader is skipped;
 * on a miss (or after a bust of any of `tags`) it runs and the result is cached
 * under `keyParts` + `tags`.
 *
 * @example
 * // Public entry detail — cached and busted when any post changes. Tag with the
 * // collection tag; a slug-routed read has no entry id until the fetch resolves.
 * //
 * // Two independent hazards, and `status` answers only one. `find()` defaults to
 * // `overrideAccess: true`, so a slug filter alone can return a DRAFT —
 * // `status: "published"` is enforced even on a trusted read and fixes that.
 * // It does NOT evaluate per-row ACCESS rules: a published row only its owner
 * // may read is still returned. A shared key is correct only for a collection
 * // with no read rules; otherwise use the per-user form below.
 * const post = await cachedFind(
 *   () =>
 *     nextly.find({
 *       collection: "posts",
 *       where: { slug: { equals: slug } },
 *       status: "published",
 *     }),
 *   { tags: nextlyTags("posts"), keyParts: ["posts", slug] }
 * );
 *
 * @example
 * // Per-user list — access rules evaluated AS the caller, and the caller's id in
 * // the key so the entry never leaks to another reader.
 * const mine = await cachedFind(
 *   () => nextly.find({ collection: "orders", user, overrideAccess: false }),
 *   { tags: nextlyTags("orders"), keyParts: ["orders", "list", user.id] }
 * );
 */
export function cachedFind<T>(
  reader: () => Promise<T>,
  options: CachedFindOptions
): Promise<T> {
  return applyCache(loadUnstableCache(), reader, options);
}

/**
 * The pure caching step, separated from module resolution so it is testable with
 * a fake `unstable_cache`. Runs `reader` behind `unstableCache` keyed by
 * `keyParts` and tagged with `tags`; when `unstableCache` is null (no Next
 * runtime), runs the reader directly. Not part of the public API.
 */
export function applyCache<T>(
  unstableCache: UnstableCache | null,
  reader: () => Promise<T>,
  options: CachedFindOptions
): Promise<T> {
  if (!unstableCache) return reader();
  const cached = unstableCache(reader, options.keyParts, {
    tags: options.tags,
    revalidate: options.revalidate ?? false,
  });
  return runCachedOrDirect(cached, reader);
}

/**
 * `unstable_cache` throws an "incrementalCache missing" invariant when invoked
 * outside a Next request/build scope (a standalone script, a test, a non-Next
 * caller that still has `next` installed). Run the reader UNCACHED there rather
 * than surfacing a cryptic framework error — inside a Next scope the cache is
 * present and this fallback never runs. A genuine reader error is rethrown so
 * callers that rethrow-on-error keep working.
 */
async function runCachedOrDirect<T>(
  cached: () => Promise<T>,
  reader: () => Promise<T>
): Promise<T> {
  try {
    return await cached();
  } catch (error) {
    if (isMissingCacheScopeError(error)) return reader();
    throw error;
  }
}

/** True for the `unstable_cache` "no incremental cache in this scope" invariant. */
function isMissingCacheScopeError(error: unknown): boolean {
  // Match Next's specific invariant phrase, not a bare `incrementalCache`
  // substring — an unrelated reader error mentioning the cache must propagate
  // rather than be retried uncached.
  return (
    error instanceof Error && error.message.includes("incrementalCache missing")
  );
}
