/**
 * The cache lifetime a read may take, given what is scheduled.
 *
 * A companion to `release-visibility`: that seam answers "what does a due
 * release change about this read", and this one answers "how long may the
 * answer be cached". Both are the same question about the same table, asked by
 * a caller that must not have to know it.
 *
 * ## Why a null object again
 *
 * A runtime with no releases wired gets {@link NO_RELEASE_CACHE_BOUND}, which
 * answers `false` — tag-only, exactly the behaviour before releases existed —
 * without asking anything. An optional dependency would make every call site
 * write `?? false`, and one that forgot would cache a page past a transition
 * rather than fail visibly.
 *
 * @module domains/releases/release-cache-bound
 */

import { ReleasesRepository } from "./releases-repository";
import type { ReleasesDbApi } from "./releases-repository";
import { secondsToNextTransition } from "./seconds-to-next-transition";
import { transitionCacheFor } from "./transition-cache-registry";

export interface ReleaseCacheBound {
  /**
   * Seconds a read may be cached for, or `false` for tag-only busting.
   *
   * `false` is the overwhelmingly common answer — nothing scheduled — and is
   * reached from a memo rather than a query.
   */
  maxCacheSeconds(now: Date): Promise<number | false>;
}

/** Answers "tag-only", without asking. */
export const NO_RELEASE_CACHE_BOUND: ReleaseCacheBound = {
  maxCacheSeconds: () => Promise.resolve(false),
};

export function createReleaseCacheBound(deps: {
  cache: { nextTransition(now: Date): Promise<Date | null> };
}): ReleaseCacheBound {
  return {
    async maxCacheSeconds(now: Date): Promise<number | false> {
      return secondsToNextTransition(await deps.cache.nextTransition(now), now);
    },
  };
}

/**
 * One bound per adapter, held for the adapter's lifetime.
 *
 * Memoized here rather than left to the caller, because getting it wrong is
 * silent and expensive in the same direction: the memo inside
 * `PendingTransitionCache` is the entire reason this is not a query on every
 * content read, and a bound constructed per request reloads the instant every
 * time — turning the optimisation into a cost that only shows up under load.
 *
 * Keyed weakly so a torn-down runtime is not retained by this map.
 */
const boundsByDb = new WeakMap<object, ReleaseCacheBound>();

export function releaseCacheBoundFor(db: ReleasesDbApi): ReleaseCacheBound {
  const key = db as unknown as object;
  const existing = boundsByDb.get(key);
  if (existing !== undefined) return existing;

  const repository = new ReleasesRepository(db);
  const bound = createReleaseCacheBound({
    cache: transitionCacheFor(db, () => repository.findScheduledTransitions()),
  });
  boundsByDb.set(key, bound);
  return bound;
}
