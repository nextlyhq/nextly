/**
 * Under Cache Components a cached read's lifetime comes from its caller alone:
 * no clock and no database read decides it, because both, taken outside the
 * cache scope, stop a prerender. With Cache Components off the release bound
 * still applies, which the second case holds so the first cannot pass against a
 * bound that was never consulted.
 *
 * @module runtime/cache/__tests__/release-cache-window-cache-components.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { maxCacheSeconds } = vi.hoisted(() => ({
  maxCacheSeconds: vi.fn(async () => 30),
}));

vi.mock("../../../di/container", () => ({
  container: { has: () => true, get: () => ({}) },
}));
vi.mock("../../../domains/releases/release-cache-bound", () => ({
  NO_RELEASE_CACHE_BOUND: { maxCacheSeconds: async () => false },
  releaseCacheBoundFor: () => ({ maxCacheSeconds }),
}));

import { releaseBoundedRevalidate } from "../release-cache-window";

/** Runs `body`, counting every `Date` it constructs. */
async function countingClockReads(body: () => Promise<unknown>) {
  const RealDate = globalThis.Date;
  let reads = 0;
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args: ConstructorParameters<DateConstructor>) {
      reads += 1;
      return new target(...args);
    },
  });
  try {
    await body();
  } finally {
    globalThis.Date = RealDate;
  }
  return reads;
}

afterEach(() => {
  vi.unstubAllEnvs();
  maxCacheSeconds.mockClear();
});

describe("releaseBoundedRevalidate under Cache Components", () => {
  it("keeps the caller's lifetime and reads neither the clock nor the database", async () => {
    vi.stubEnv("__NEXT_CACHE_COMPONENTS", "true");
    let answers: Array<number | false> = [];

    const reads = await countingClockReads(async () => {
      answers = [
        await releaseBoundedRevalidate(undefined),
        await releaseBoundedRevalidate(600),
      ];
    });

    expect(answers).toEqual([false, 600]);
    expect(reads).toBe(0);
    expect(maxCacheSeconds).not.toHaveBeenCalled();
  });

  it("still bounds the lifetime by the next release with Cache Components off", async () => {
    vi.stubEnv("__NEXT_CACHE_COMPONENTS", "false");

    expect(await releaseBoundedRevalidate(600)).toBe(30);
    expect(maxCacheSeconds).toHaveBeenCalledTimes(1);
  });
});
