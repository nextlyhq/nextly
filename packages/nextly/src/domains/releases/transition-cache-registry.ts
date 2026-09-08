/**
 * One transition memo per adapter, shared by everything that asks about it.
 *
 * ## Why this exists
 *
 * Two seams ask the same question of the same table: `release-visibility` asks
 * "is anything due?", and `release-cache-bound` asks "when could a page next go
 * stale?". Each used to build its own `PendingTransitionCache`, which gave them
 * independent 30-second windows over one schedule — so within a window the read
 * path could say nothing is due while the cache bound had already seen a
 * release, or the reverse. A page could then be cached tag-only against a
 * transition the other half already knew about, and stay stale until
 * materialisation finally wrote.
 *
 * They share one now, keyed by adapter. That also gives schedule and cancel
 * somewhere to invalidate: flushing document tags re-renders the page, but the
 * re-render reads the memo, and a stale memo hands it the same `false` bound it
 * had before.
 *
 * @module domains/releases/transition-cache-registry
 */

import { PendingTransitionCache } from "./pending-transition-cache";
import type { ScheduledTransitionsLoader } from "./pending-transition-cache";
// TYPE-ONLY. `releases-repository` imports the invalidator below, so a VALUE
// import here would close a cycle — and the registry has no business
// constructing a repository anyway: whoever asks for a cache already has one.
import type { ReleasesDbApi } from "./releases-repository";

/**
 * Held weakly so a torn-down runtime is not retained, and per adapter so two
 * databases never share a schedule.
 */
const cachesByDb = new WeakMap<object, PendingTransitionCache>();

export function transitionCacheFor(
  db: ReleasesDbApi,
  load: ScheduledTransitionsLoader
): PendingTransitionCache {
  const key = db as unknown as object;
  const existing = cachesByDb.get(key);
  if (existing !== undefined) return existing;

  // The loader comes from the caller, which already holds a repository. That
  // keeps this module free of any value dependency on `releases-repository` —
  // which imports the invalidator below, so importing it back would close a
  // cycle. The FIRST caller's loader wins; every caller supplies the same
  // query, and the point of the registry is that they share one answer.
  const cache = new PendingTransitionCache(load);
  cachesByDb.set(key, cache);
  return cache;
}

/**
 * Drop the memo for this adapter, so the next read reloads the schedule.
 *
 * Called by the writes that CHANGE the schedule. Without it, scheduling a
 * release flushes the affected pages and the immediate re-render caches them
 * again against a memo that still says nothing is due — the tag flush and the
 * bound would disagree for up to a full TTL.
 */
export function invalidateTransitionCacheFor(db: ReleasesDbApi): void {
  cachesByDb.get(db)?.invalidate();
}
