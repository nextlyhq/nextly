/**
 * The unknown-source counters' rules, driven directly with a controlled clock.
 *
 * The ceiling's spend is read through what it still admits: a ceiling of N
 * admits exactly N fresh keys, so a refusal that spent it shows up as a fresh
 * key refused early, and one that did not as the Nth fresh key admitted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimitStore } from "../../../middleware/rate-limit";
import { RateLimiter } from "../rate-limiter";
import { SlidingWindowMemoryStore } from "../sliding-window-store";
import {
  MemoryUnknownSourceCounter,
  StoreUnknownSourceCounter,
  UNKNOWN_SOURCE_CEILING_KEY,
  type UnknownSourceCounter,
  type UnknownSourceLimits,
} from "../unknown-source-counter";

const W = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

function at(ms: number): void {
  vi.setSystemTime(T0 + ms);
}

/** How many of `keys`, each fresh, the counter admits right now. */
async function admittedFresh(
  counter: UnknownSourceCounter,
  limits: UnknownSourceLimits,
  keys: string[]
): Promise<number> {
  let admitted = 0;
  for (const key of keys) {
    if ((await counter.admit(key, limits)).allowed) admitted++;
  }
  return admitted;
}

const fresh = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

describe("MemoryUnknownSourceCounter", () => {
  it("a request its budget refuses leaves the ceiling's count unchanged", async () => {
    const counter = new MemoryUnknownSourceCounter();
    const limits = { budget: 2, ceiling: 5, windowMs: W };
    expect((await counter.admit("a", limits)).allowed).toBe(true);
    expect((await counter.admit("a", limits)).allowed).toBe(true);
    for (let i = 0; i < 10; i++) {
      expect(await counter.admit("a", limits)).toMatchObject({
        allowed: false,
        by: "budget",
      });
    }
    // Two spent, so exactly three remain: ten budget refusals spent none.
    expect(await admittedFresh(counter, limits, fresh("b", 4))).toBe(3);
  });

  it("a request the ceiling refuses leaves every bucket, its expiry and the ceiling untouched", async () => {
    const counter = new MemoryUnknownSourceCounter();
    const limits = { budget: 2, ceiling: 3, windowMs: W };
    await counter.admit("a", limits); // a@0
    at(1_000);
    await counter.admit("b", limits); // b@1000
    at(2_000);
    await counter.admit("c", limits); // c@2000; the ceiling is met
    const tracked = counter.trackedKeys;

    at(10_000);
    for (const key of ["a", "b", "c", "never-seen"]) {
      expect(await counter.admit(key, limits)).toMatchObject({
        allowed: false,
        by: "ceiling",
        resetAt: T0 + W,
      });
    }
    expect(counter.trackedKeys).toBe(tracked);

    // a's entry, and the ceiling entry it spent, end at exactly W: the
    // refusals above extended neither.
    at(W + 1);
    // One place freed, and `b` still has one of its two left.
    expect((await counter.admit("b", limits)).allowed).toBe(true);
    expect(await counter.admit("d", limits)).toMatchObject({
      allowed: false,
      by: "ceiling",
    });
  });

  it("a key first seen under a met ceiling is refused, creates no bucket, and starts unspent once it clears", async () => {
    const counter = new MemoryUnknownSourceCounter();
    const limits = { budget: 2, ceiling: 3, windowMs: W };
    await counter.admit("a", limits);
    await counter.admit("b", limits);
    await counter.admit("c", limits);
    expect(counter.trackedKeys).toBe(3);

    expect(await counter.admit("late", limits)).toMatchObject({
      allowed: false,
      by: "ceiling",
    });
    expect(counter.trackedKeys).toBe(3);

    at(W + 1);
    expect((await counter.admit("late", limits)).allowed).toBe(true);
    expect((await counter.admit("late", limits)).allowed).toBe(true);
    expect(await counter.admit("late", limits)).toMatchObject({
      by: "budget",
    });
  });

  it("stays within its bound under a flood, and never restores an exhausted budget", async () => {
    const counter = new MemoryUnknownSourceCounter();
    const limits = { budget: 3, ceiling: 60, windowMs: W };

    // Window one: every fresh key is admitted until the ceiling is met; the
    // victim's budget is spent halfway through the window.
    expect(await admittedFresh(counter, limits, fresh("one", 57))).toBe(57);
    at(W / 2);
    for (let i = 0; i < 3; i++) await counter.admit("victim", limits);
    expect(counter.trackedKeys).toBe(58);

    // Window two: the first keys have lapsed, the victim's entries have not.
    // The flood reaches the bound while the victim is live, so the bound has
    // to choose what to retire, and it must not be the victim.
    let admitted = 0;
    for (let i = 0; i < 200; i++) {
      at(W + 1 + i);
      if ((await counter.admit(`two-${i}`, limits)).allowed) admitted++;
      expect(await counter.admit("victim", limits)).toMatchObject({
        allowed: false,
      });
      expect(counter.trackedKeys).toBeLessThanOrEqual(limits.ceiling);
    }
    // No key was turned away for room before the ceiling was met: the 57
    // places the victim's three left all went to fresh keys.
    expect(admitted).toBe(57);

    // A met ceiling grows nothing; a fresh key is admitted once it clears.
    const tracked = counter.trackedKeys;
    for (let i = 0; i < 50; i++) await counter.admit(`blocked-${i}`, limits);
    expect(counter.trackedKeys).toBe(tracked);
    at(2 * W + 300);
    expect((await counter.admit("after", limits)).allowed).toBe(true);
  });

  it("spends the ceiling on a token's arrival, and refuses arrival once it is met", async () => {
    const counter = new MemoryUnknownSourceCounter();
    const limits = { budget: 1, ceiling: 2, windowMs: W };
    const first = await counter.arrive(limits);
    expect(first.allowed).toBe(true);
    if (!first.allowed) return;
    expect((await counter.admitArrived("a", limits, first.at)).allowed).toBe(
      true
    );

    // Arrival spends the ceiling even when the budget then refuses.
    const second = await counter.arrive(limits);
    if (!second.allowed) throw new Error("expected the second arrival in");
    expect(await counter.admitArrived("a", limits, second.at)).toMatchObject({
      by: "budget",
    });
    expect(await counter.arrive(limits)).toMatchObject({
      allowed: false,
      by: "ceiling",
    });
  });
});

describe("StoreUnknownSourceCounter", () => {
  /** A store of the contract's required methods only, recording its keys. */
  function incrementOnlyStore(): {
    store: RateLimitStore;
    keys: Set<string>;
  } {
    const inner = new SlidingWindowMemoryStore();
    const keys = new Set<string>();
    return {
      keys,
      store: {
        increment: (key, windowMs) => {
          keys.add(key);
          return inner.increment(key, windowMs);
        },
        reset: key => inner.reset(key),
      },
    };
  }

  it("creates no key past a met ceiling on a store without consume", async () => {
    const { store, keys } = incrementOnlyStore();
    const counter = new StoreUnknownSourceCounter(new RateLimiter(store));
    const limits = { budget: 2, ceiling: 2, windowMs: W };
    expect((await counter.admit("a", limits)).allowed).toBe(true);
    expect((await counter.admit("b", limits)).allowed).toBe(true);

    for (let i = 0; i < 20; i++) {
      expect(await counter.admit(`fresh-${i}`, limits)).toMatchObject({
        allowed: false,
        by: "ceiling",
      });
    }
    expect([...keys].sort()).toEqual(
      ["a", "b", UNKNOWN_SOURCE_CEILING_KEY].sort()
    );
  });

  it("creates a key only for a request the ceiling admitted, however many arrive at once", async () => {
    const store = new SlidingWindowMemoryStore();
    const counter = new StoreUnknownSourceCounter(new RateLimiter(store));
    const limits = { budget: 3, ceiling: 5, windowMs: W };

    // Fifty fresh addresses at once: every one reads the ceiling as open.
    const verdicts = await Promise.all(
      Array.from({ length: 50 }, (_, i) => counter.admit(`burst-${i}`, limits))
    );

    expect(verdicts.filter(v => v.allowed)).toHaveLength(5);
    // The five admitted keys and the ceiling's own; no loser left a key.
    expect(store.size).toBe(6);
  });

  it("refuses at a met ceiling without recording against the key", async () => {
    const store = new SlidingWindowMemoryStore();
    const limiter = new RateLimiter(store);
    const counter = new StoreUnknownSourceCounter(limiter);
    const limits = { budget: 2, ceiling: 1, windowMs: W };
    expect((await counter.admit("a", limits)).allowed).toBe(true);

    expect(await counter.admit("b", limits)).toMatchObject({
      allowed: false,
      by: "ceiling",
    });
    expect(await limiter.peek("b", W)).toBe(0);
    expect(store.size).toBe(2);
  });

  it("a request its budget refuses never reaches the ceiling", async () => {
    const limiter = new RateLimiter(new SlidingWindowMemoryStore());
    const counter = new StoreUnknownSourceCounter(limiter);
    const limits = { budget: 1, ceiling: 10, windowMs: W };
    await counter.admit("a", limits);
    for (let i = 0; i < 5; i++) {
      expect(await counter.admit("a", limits)).toMatchObject({ by: "budget" });
    }
    expect(await limiter.peek(UNKNOWN_SOURCE_CEILING_KEY, W)).toBe(1);
  });
});
