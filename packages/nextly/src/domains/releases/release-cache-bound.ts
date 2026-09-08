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
   * A runtime with releases wired always answers with a NUMBER, reached from a
   * memo rather than a query. `false` — cache until something flushes it — is
   * reserved for {@link NO_RELEASE_CACHE_BOUND}, where there is no schedule to
   * be wrong about.
   */
  maxCacheSeconds(now: Date): Promise<number | false>;
}

/** Answers "tag-only", without asking. */
export const NO_RELEASE_CACHE_BOUND: ReleaseCacheBound = {
  maxCacheSeconds: () => Promise.resolve(false),
};

export function createReleaseCacheBound(deps: {
  cache: {
    nextTransition(now: Date): Promise<Date | null>;
    stalenessCeilingSeconds(): number;
  };
}): ReleaseCacheBound {
  return {
    async maxCacheSeconds(now: Date): Promise<number | false> {
      const scheduled = secondsToNextTransition(
        await deps.cache.nextTransition(now),
        now
      );
      // The memo cannot see a schedule written by another instance, so no page
      // derived from it may outlive it. `false` here would mean "cache until
      // something flushes this" — and on the deployment where that is wrong,
      // the flush has already happened, on the instance that made the schedule.
      // See the note in `pending-transition-cache`.
      const ceiling = deps.cache.stalenessCeilingSeconds();
      return scheduled === false ? ceiling : Math.min(scheduled, ceiling);
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
