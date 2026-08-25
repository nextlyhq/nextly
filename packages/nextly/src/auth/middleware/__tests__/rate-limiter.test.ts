/**
 * The auth limiter's numbers must not change, and its store must be reachable.
 *
 * Two separate claims, and each needs its own control. "The default still
 * behaves as it did" is satisfied by a limiter that never refuses anything, so
 * every test below also shows a refusal at the configured limit. "A store can
 * be supplied" is satisfied by a limiter that ignores the store and happens to
 * agree with it, so the injected store here DISAGREES with what memory would
 * have said.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RateLimitRecord,
  RateLimitStore,
} from "../../../middleware/rate-limit";
import { RateLimiter } from "../rate-limiter";
import { SlidingWindowMemoryStore } from "../sliding-window-store";

const WINDOW = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the default in-memory path", () => {
  it("allows exactly the limit and refuses the next", async () => {
    const limiter = new RateLimiter(new SlidingWindowMemoryStore());

    const allowed = [];
    for (let i = 0; i < 3; i++) {
      allowed.push((await limiter.check("k", 3, WINDOW)).allowed);
    }
    // The population control. Without it, `refused` below would pass against a
    // limiter that refuses EVERYTHING — which is also not the old behaviour.
    expect(allowed).toEqual([true, true, true]);

    const refused = await limiter.check("k", 3, WINDOW);
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
  });

  it("counts down `remaining` as budget is spent", async () => {
    const limiter = new RateLimiter(new SlidingWindowMemoryStore());
    expect((await limiter.check("k", 3, WINDOW)).remaining).toBe(2);
    expect((await limiter.check("k", 3, WINDOW)).remaining).toBe(1);
    expect((await limiter.check("k", 3, WINDOW)).remaining).toBe(0);
  });

  it("slides: budget returns once the oldest entry ages out", async () => {
    const limiter = new RateLimiter(new SlidingWindowMemoryStore());
    await limiter.check("k", 1, WINDOW);
    expect((await limiter.check("k", 1, WINDOW)).allowed).toBe(false);

    vi.advanceTimersByTime(WINDOW + 1);
    expect((await limiter.check("k", 1, WINDOW)).allowed).toBe(true);
  });

  it("does not let a refused attempt extend its own window", async () => {
    // The property `decrement` exists for. Without it a caller who keeps
    // hammering keeps pushing the window forward and can never drain it — a
    // self-inflicted permanent lockout, and a denial-of-service an attacker
    // can aim at someone else's key.
    const limiter = new RateLimiter(new SlidingWindowMemoryStore());
    await limiter.check("k", 1, WINDOW); // fills the budget at t0

    // Hammer for most of the window. Each is refused, and none may count.
    vi.advanceTimersByTime(WINDOW - 1_000);
    for (let i = 0; i < 5; i++) {
      expect((await limiter.check("k", 1, WINDOW)).allowed).toBe(false);
    }

    // t0's entry now ages out. If the refusals had been recorded, the window
    // would still be full and this would be refused.
    vi.advanceTimersByTime(1_001);
    expect((await limiter.check("k", 1, WINDOW)).allowed).toBe(true);
  });

  it("reports resetAt as the moment the oldest entry ages out", async () => {
    const limiter = new RateLimiter(new SlidingWindowMemoryStore());
    const first = await limiter.check("k", 2, WINDOW);
    expect(first.resetAt.getTime()).toBe(Date.now() + WINDOW);

    vi.advanceTimersByTime(10_000);
    const second = await limiter.check("k", 2, WINDOW);
    // Still keyed to the FIRST entry, which is what ages out first.
    expect(second.resetAt.getTime()).toBe(Date.now() - 10_000 + WINDOW);
  });
});

describe("the store seam", () => {
  it("uses a supplied store instead of process memory", async () => {
    // Deliberately DISAGREES with memory: it refuses the very first request,
    // which the in-memory store would have allowed. If the limiter ignored the
    // store, this would pass as `true` and the seam would be decorative.
    const calls: string[] = [];
    const alwaysOver: RateLimitStore = {
      async increment(key: string): Promise<RateLimitRecord> {
        calls.push(key);
        return { count: 999, resetTime: Date.now() + WINDOW };
      },
      async reset(): Promise<void> {},
    };

    const limiter = new RateLimiter(alwaysOver);
    const result = await limiter.check("k", 100, WINDOW);

    expect(result.allowed).toBe(false);
    expect(calls).toEqual(["k"]);
  });

  it("still refuses when a store cannot take an increment back", async () => {
    // `decrement` is optional. A store that omits it must not crash the
    // request path — the attempt simply stays counted, which is the safe
    // direction to degrade in.
    const noDecrement: RateLimitStore = {
      async increment(): Promise<RateLimitRecord> {
        return { count: 5, resetTime: Date.now() + WINDOW };
      },
      async reset(): Promise<void> {},
    };

    const limiter = new RateLimiter(noDecrement);
    await expect(limiter.check("k", 1, WINDOW)).resolves.toMatchObject({
      allowed: false,
    });
  });

  it("takes the increment back on refusal when the store supports it", async () => {
    // Asserted on the STORE rather than on a later allow, so it cannot pass
    // because the window happened to be long enough.
    const decremented: string[] = [];
    const store: RateLimitStore = {
      async increment(): Promise<RateLimitRecord> {
        return { count: 9, resetTime: Date.now() + WINDOW };
      },
      async reset(): Promise<void> {},
      async decrement(key: string): Promise<void> {
        decremented.push(key);
      },
    };

    const limiter = new RateLimiter(store);
    await limiter.check("k", 1, WINDOW);
    expect(decremented).toEqual(["k"]);
  });

  it("does NOT take it back when the request was allowed", async () => {
    // The mirror of the case above. Without it, a limiter that decremented on
    // every call would pass the previous test and silently never count anything.
    const decremented: string[] = [];
    const store: RateLimitStore = {
      async increment(): Promise<RateLimitRecord> {
        return { count: 1, resetTime: Date.now() + WINDOW };
      },
      async reset(): Promise<void> {},
      async decrement(key: string): Promise<void> {
        decremented.push(key);
      },
    };

    const limiter = new RateLimiter(store);
    const result = await limiter.check("k", 10, WINDOW);
    expect(result.allowed).toBe(true);
    expect(decremented).toEqual([]);
  });
});
