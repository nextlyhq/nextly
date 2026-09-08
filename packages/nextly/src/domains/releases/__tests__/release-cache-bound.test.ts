/**
 * The seam a read uses to ask how long it may be cached.
 *
 * @module domains/releases/__tests__/release-cache-bound.test
 */
import { describe, expect, it, vi } from "vitest";

import {
  NO_RELEASE_CACHE_BOUND,
  createReleaseCacheBound,
} from "../release-cache-bound";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const CEILING = 30;

/** A memo that knows `next` and admits it may be up to `CEILING` seconds old. */
function cacheOf(next: Date | null) {
  return {
    nextTransition: async () => next,
    stalenessCeilingSeconds: () => CEILING,
  };
}

describe("createReleaseCacheBound", () => {
  it("bounds the lifetime by the next scheduled transition", async () => {
    // A transition INSIDE the staleness window, so this asserts the schedule is
    // what bounds it. With a farther transition the ceiling would win and this
    // test would pass on an implementation that ignored the schedule entirely.
    const bound = createReleaseCacheBound({
      cache: cacheOf(new Date(NOW.getTime() + 5_000)),
    });

    expect(await bound.maxCacheSeconds(NOW)).toBe(5);
  });

  it("never exceeds the memo's staleness ceiling, even for a distant transition", async () => {
    // The memo cannot see a schedule written by another instance, so a
    // transition two hours out does not license a two-hour page: a release
    // scheduled remotely for five minutes from now is invisible here for the
    // whole ceiling window.
    const bound = createReleaseCacheBound({
      cache: cacheOf(new Date(NOW.getTime() + 2 * 60 * 60 * 1000)),
    });

    expect(await bound.maxCacheSeconds(NOW)).toBe(CEILING);
  });

  it("is bounded by the ceiling — NOT tag-only — when nothing is scheduled", async () => {
    // The defect this replaced. `false` means "cache until something flushes
    // this", and on a multi-instance deployment the flush has already happened
    // on the instance that wrote the schedule; the page then outlives the
    // release with no clock on it at all. Deliberately a behaviour change for
    // sites that have never scheduled a release.
    const bound = createReleaseCacheBound({ cache: cacheOf(null) });

    expect(await bound.maxCacheSeconds(NOW)).toBe(CEILING);
  });

  it("asks the shared memo, not a fresh query", async () => {
    // The control that keeps this off the hot path. A seam that loaded its own
    // answer would satisfy every case above while issuing a query per read of
    // every collection.
    const nextTransition = vi.fn(async (_now: Date) => null);
    const bound = createReleaseCacheBound({
      cache: { nextTransition, stalenessCeilingSeconds: () => CEILING },
    });

    await bound.maxCacheSeconds(NOW);

    expect(nextTransition).toHaveBeenCalledTimes(1);
    expect(nextTransition).toHaveBeenCalledWith(NOW);
  });
});

describe("NO_RELEASE_CACHE_BOUND", () => {
  it("answers tag-only, so a runtime without releases needs no special case", async () => {
    expect(await NO_RELEASE_CACHE_BOUND.maxCacheSeconds(NOW)).toBe(false);
  });
});
