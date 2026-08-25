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
      increment(key: string): Promise<RateLimitRecord> {
        calls.push(key);
        return Promise.resolve({ count: 999, resetTime: Date.now() + WINDOW });
      },
      reset(): Promise<void> {
        return Promise.resolve();
      },
    };

    const result = await new RateLimiter(alwaysOver).check("k", 100, WINDOW);

    expect(result.allowed).toBe(false);
    expect(calls).toEqual(["k"]);
  });

  it("prefers the store's ATOMIC decision over counting itself", async () => {
    // The store says allowed while the count is far over the limit. Only a
    // limiter that defers to `consume` produces `true` here; one that re-derived
    // the verdict from `count` would say false. That is the point — the store
    // owns the decision because only it can make it atomic.
    const store: RateLimitStore = {
      increment(): Promise<RateLimitRecord> {
        throw new Error("increment must not be used when consume exists");
      },
      reset(): Promise<void> {
        return Promise.resolve();
      },
      consume(): Promise<RateLimitRecord & { allowed: boolean }> {
        return Promise.resolve({
          allowed: true,
          count: 500,
          resetTime: Date.now() + WINDOW,
        });
      },
    };

    await expect(
      new RateLimiter(store).check("k", 1, WINDOW)
    ).resolves.toMatchObject({ allowed: true });
  });

  it("falls back to counting every attempt when the store is not atomic", async () => {
    // A store without `consume` gets the stricter path: refused attempts count.
    // Asserted as a REFUSAL at the boundary rather than as an absence, so it
    // cannot pass against a limiter that allows everything.
    let count = 0;
    const notAtomic: RateLimitStore = {
      increment(): Promise<RateLimitRecord> {
        count += 1;
        return Promise.resolve({ count, resetTime: Date.now() + WINDOW });
      },
      reset(): Promise<void> {
        return Promise.resolve();
      },
    };

    const limiter = new RateLimiter(notAtomic);
    expect((await limiter.check("k", 2, WINDOW)).allowed).toBe(true);
    expect((await limiter.check("k", 2, WINDOW)).allowed).toBe(true);
    expect((await limiter.check("k", 2, WINDOW)).allowed).toBe(false);
  });

  it("issues no rollback call when it refuses a request", async () => {
    // The property that closes the cross-window erasure: a rollback issued in
    // one window can land in the NEXT and delete an attempt that window had
    // legitimately budgeted, admitting logins nobody allowed for.
    //
    // Asserted by driving `check()` against a store that OFFERS a rollback and
    // recording every call it receives. Inspecting the store's method surface
    // instead would prove nothing about the limiter: a rollback reintroduced by
    // any other route would leave that surface untouched, and no break to the
    // limiter could ever turn such a test red.
    const calls: string[] = [];
    const offersRollback: RateLimitStore & {
      decrement(key: string): Promise<void>;
    } = {
      increment(): Promise<RateLimitRecord> {
        calls.push("increment");
        return Promise.resolve({ count: 9, resetTime: Date.now() + WINDOW });
      },
      reset(): Promise<void> {
        calls.push("reset");
        return Promise.resolve();
      },
      consume(): Promise<RateLimitRecord & { allowed: boolean }> {
        calls.push("consume");
        return Promise.resolve({
          allowed: false,
          count: 9,
          resetTime: Date.now() + WINDOW,
        });
      },
      decrement(): Promise<void> {
        calls.push("decrement");
        return Promise.resolve();
      },
    };

    const result = await new RateLimiter(offersRollback).check("k", 1, WINDOW);

    // The control. Without it, "no rollback happened" is satisfied by a request
    // that was never refused — and a limiter has no reason to roll back an
    // attempt it allowed.
    expect(result.allowed).toBe(false);

    // Exactly one call, and not the rollback the store was willing to accept.
    expect(calls).toEqual(["consume"]);
  });

  it("keeps sliding while every attempt is being refused", async () => {
    // A refused attempt is not recorded, but the window must still drain. If
    // the store returned early on refusal without keeping the pruned array, an
    // exhausted key would never recover.
    const limiter = new RateLimiter(new SlidingWindowMemoryStore());
    await limiter.check("k", 1, WINDOW);

    vi.advanceTimersByTime(WINDOW / 2);
    expect((await limiter.check("k", 1, WINDOW)).allowed).toBe(false);

    vi.advanceTimersByTime(WINDOW / 2 + 1);
    expect((await limiter.check("k", 1, WINDOW)).allowed).toBe(true);
  });
});
