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

describe("createReleaseCacheBound", () => {
  it("bounds the lifetime by the next scheduled transition", async () => {
    const bound = createReleaseCacheBound({
      cache: {
        nextTransition: async () =>
          new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
      },
    });

    expect(await bound.maxCacheSeconds(NOW)).toBe(2 * 60 * 60);
  });

  it("is tag-only when nothing is scheduled", async () => {
    // The common case, and the one that must not change behaviour for a site
    // that has never scheduled a release.
    const bound = createReleaseCacheBound({
      cache: { nextTransition: async () => null },
    });

    expect(await bound.maxCacheSeconds(NOW)).toBe(false);
  });

  it("asks the shared memo, not a fresh query", async () => {
    // The control that keeps this off the hot path. A seam that loaded its own
    // answer would satisfy both cases above while issuing a query per read of
    // every collection.
    const nextTransition = vi.fn(async (_now: Date) => null);
    const bound = createReleaseCacheBound({ cache: { nextTransition } });

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
