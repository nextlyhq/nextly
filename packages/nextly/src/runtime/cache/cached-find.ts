/**
 * `cachedFind` — cache a content read and tag it so an on-write bust makes it
 * fresh. A thin wrapper over Next's `unstable_cache`. Where Next.js is not
 * installed (tests, non-Next callers) it runs the reader directly; that is a
 * context, not a version.
 *
 * `next/cache` is loaded through {@link loadNextModule}, the one lazy loader
 * every Next.js API nextly uses goes through.
 *
 * @module runtime/cache/cached-find
 */
import { container } from "../../di/container";
import type { LanguageRegistry } from "../../domains/i18n/language-registry";
import { NextlyError } from "../../errors/nextly-error";
import type { PublicData } from "../../errors/public-data";
import { loadNextModule, requireNextApi } from "../next-api";
import { isReadRefusal } from "../routing/miss-or-denied";

import { readTags } from "./nextly-tags";
import {
  readThroughRegistered,
  registeredCachedRead,
  reportUnregisteredUnderCacheComponents,
} from "./registered-read";
import { noteCachedRead, publicReadLifetime } from "./shared-handlers";

/** The subset of `unstable_cache` this helper uses. */
export type UnstableCache = <T>(
  cb: () => Promise<T>,
  keyParts: string[],
  options: { tags?: string[]; revalidate?: number | false }
) => () => Promise<T>;

let cachedUnstableCache: UnstableCache | null | undefined;

function loadUnstableCache(): UnstableCache | null {
  if (cachedUnstableCache !== undefined) return cachedUnstableCache;
  const mod = loadNextModule("next/cache");
  // No Next.js installed: run uncached (context, not version).
  cachedUnstableCache = mod
    ? requireNextApi<UnstableCache>(mod, "next/cache", "unstable_cache")
    : null;
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
   * SECURITY: if the read applies per-caller access rules (role-based
   * visibility, an API-key's narrowed scope), EVERY dimension those
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
 * A read refused by access (`isReadRefusal`) is cached too, as the refusal, and
 * every read of the entry throws it again until a bust or the entry's lifetime
 * reads it afresh. So a read that comes to be refused, when its entry is read
 * again, replaces the answer it gave while it was allowed.
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
 * // `find()` returns `{ items, meta }`, so a detail route takes the first item.
 * const post = await cachedFind(
 *   async () =>
 *     (
 *       await nextly.find({
 *         collection: "posts",
 *         where: { slug: { equals: slug } },
 *         status: "published",
 *         limit: 1,
 *       })
 *     ).items[0] ?? null,
 *   { tags: nextlyTags("posts"), keyParts: ["posts", slug] }
 * );
 *
 * @example
 * // Per-user list — access rules evaluated AS the caller, and EVERY dimension
 * // those rules read in the key, not merely who the caller is.
 * //
 * // Roles are in the key because the identity outlives the permission: tags bust
 * // on CONTENT changes and a role change is not one, so keying on the id alone
 * // lets the same person fill an entry while privileged and read it back after
 * // being downgraded.
 * //
 * // The set is built the way `evaluateRoleBasedAccess` builds the one it decides
 * // with — the many-to-many `roles` UNIONED with the singular `role` — because a
 * // key that reads fewer dimensions than the rule cannot notice a change in the
 * // ones it skipped. Both fields are optional on `UserContext`, so both are
 * // guarded; `[...user.roles]` alone throws for a valid `{ id, role }` caller.
 * // Deduped and sorted last, because the key is compared as text and one role
 * // set spelled two ways would otherwise be two entries.
 * const roleKey = [...new Set([...(user.roles ?? []), user.role ?? []].flat())]
 *   .sort()
 *   .join(",");
 *
 * const mine = await cachedFind(
 *   () => nextly.find({ collection: "orders", user, overrideAccess: false }),
 *   { tags: nextlyTags("orders"), keyParts: ["orders", "list", user.id, roleKey] }
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
  // Each path's lifetime is bounded in production while nextly's cache
  // handlers do not serve it, so a write from elsewhere shows within a minute
  // of a visit.
  // Under Cache Components, through the app's `"use cache"` function when it
  // registered one: `unstable_cache` is the model Cache Components replaces,
  // and a page read right after a write can be served its previous entry once.
  const cachedRead = registeredCachedRead();
  const read = afterLanguagesRead(keepingRefusal(reader));
  const keyParts = [...options.keyParts, KEPT_KEY_PART];
  if (cachedRead) {
    return readThroughRegistered(
      cachedRead,
      JSON.stringify(keyParts),
      read,
      readTags(options.tags),
      publicReadLifetime(options.revalidate ?? false, true),
      () => noteCachedRead(true)
    ).then(answerOf);
  }
  reportUnregisteredUnderCacheComponents();
  if (!unstableCache) return reader();
  const cached = unstableCache(read, keyParts, {
    // Each once, none longer than Next.js accepts, and no more than it keeps,
    // in the order given: the routes put their own collection's or Single's
    // tag first, and a caller's own `cachedFind` keeps its order.
    tags: readTags(options.tags),
    revalidate: publicReadLifetime(options.revalidate ?? false, false),
  });
  return runCachedOrDirect(cached, reader, () => noteCachedRead(false));
}

/**
 * The key part every entry is filed under after the caller's: what an entry
 * holds is a {@link Kept} envelope, where an earlier release filed the bare
 * answer under the caller's parts alone. Kept apart, so neither release reads
 * the other's shape from a cache two releases share during a deployment.
 */
const KEPT_KEY_PART = "nextly:kept-v1";

/**
 * A read as either cache keeps it: its answer, or the refusal it met, in an envelope the reader's
 * own answer can never be mistaken for, whatever keys that answer has. The refusal is kept as its
 * public parts and the reason it was logged with, all plain values, so either cache stores it as
 * it stores an answer.
 */
type Kept<T> =
  | { readonly kept: "answer"; readonly answer: T }
  | {
      readonly kept: "refusal";
      readonly refusal: {
        readonly code: string;
        readonly statusCode: number;
        readonly publicMessage: string;
        readonly publicData?: PublicData;
        readonly messageKey?: string;
        readonly reason?: string;
      };
    };

/**
 * `reader`, answering a refusal by access with the refusal as a value rather
 * than by throwing it.
 *
 * Neither cache keeps a throw. When an entry is read again in the background,
 * as its lifetime ends, a read that throws leaves the earlier answer in place
 * and Next keeps serving it: a read the public was allowed before an owner took
 * its permission away went on being served to the public, until some write
 * busted one of its tags. Kept as a value, the refusal replaces that answer.
 * Every other error still throws, so a fault is never kept as an answer.
 */
function keepingRefusal<T>(reader: () => Promise<T>): () => Promise<Kept<T>> {
  return async () => {
    try {
      return { kept: "answer", answer: await reader() };
    } catch (error) {
      if (!isReadRefusal(error)) throw error;
      const reason = error.logContext?.reason;
      return {
        kept: "refusal",
        refusal: {
          code: String(error.code),
          statusCode: error.statusCode,
          publicMessage: error.publicMessage,
          ...(error.publicData === undefined
            ? {}
            : { publicData: error.publicData }),
          ...(error.messageKey === undefined
            ? {}
            : { messageKey: error.messageKey }),
          ...(typeof reason === "string" ? { reason } : {}),
        },
      };
    }
  };
}

/**
 * A cached entry's answer, throwing the refusal it kept as the refusal it was.
 *
 * Only what a cache handed back is read here, never a reader's own answer, so
 * the envelope is the outermost value and an answer is returned without being
 * looked into. A value that is no envelope comes from a cache that holds
 * something this function did not write (a test's stand-in) and is returned
 * as it is.
 */
function answerOf<T>(value: Kept<T> | T): T {
  if (!isKept(value)) return value;
  if (value.kept === "answer") return value.answer;
  const { reason, ...refusal } = value.refusal;
  throw new NextlyError({
    ...refusal,
    logContext: { kept: true, ...(reason === undefined ? {} : { reason }) },
  });
}

function isKept<T>(value: Kept<T> | T): value is Kept<T> {
  if (typeof value !== "object" || value === null) return false;
  const kept = (value as { kept?: unknown }).kept;
  return (
    (kept === "answer" && "answer" in value) ||
    (kept === "refusal" && "refusal" in value)
  );
}

/**
 * `reader`, run once the site's languages have been read afresh. Only a miss runs it, and what it
 * returns is cached until a tag is flushed: a change to the languages flushes every content tag,
 * but this instance may still trust a list it read within its interval, and a read rendered on
 * that list would cache the former default language again. A failed read of the languages never
 * blocks the read itself, which then runs on the list this instance has.
 */
function afterLanguagesRead<T>(reader: () => Promise<T>): () => Promise<T> {
  return async () => {
    if (container.has("languageRegistry")) {
      await container
        .get<LanguageRegistry>("languageRegistry")
        .refresh({ force: true })
        .catch(() => undefined);
    }
    return reader();
  };
}

/**
 * `unstable_cache` throws an "incrementalCache missing" invariant when invoked
 * outside a Next request/build scope (a standalone script, a test, a non-Next
 * caller that still has `next` installed). Run the reader UNCACHED there rather
 * than surfacing a cryptic framework error — inside a Next scope the cache is
 * present and this fallback never runs. That is a context, not a version: only
 * that invariant is caught, and anything else, a genuine reader error included,
 * is rethrown.
 */
async function runCachedOrDirect<T>(
  cached: () => Promise<Kept<T>>,
  reader: () => Promise<T>,
  onCached: () => void
): Promise<T> {
  let kept: Kept<T>;
  try {
    kept = await cached();
  } catch (error) {
    if (isMissingCacheScopeError(error)) return reader();
    throw error;
  }
  // Only a read that was cached tells anything about the cache handlers.
  onCached();
  return answerOf(kept);
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
