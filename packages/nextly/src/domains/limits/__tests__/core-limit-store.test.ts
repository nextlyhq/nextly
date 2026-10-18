import { describe, expect, it } from "vitest";

import { RateLimiter } from "../../../auth/middleware/rate-limiter";
import type { RateLimitStore } from "../../../middleware/rate-limit";
import { coreLimitStore, coreRateLimitStoreFor } from "../core-limit-store";
import type { LimitStore, StoredLimit } from "../limit-store";
import { createMemoryLimitStore } from "../memory-limit-store";

/**
 * Core's own limits on the limit store contract, through the old contract
 * their limiters speak: counts in a rolling window, keys stored only as keyed
 * hashes, and entries that lapse by the end of their window.
 */

const SECRET = "a-throwaway-secret-for-these-tests-0123456789";
const WINDOW = 60_000;

/** A memory store whose clock the test moves, and a peek at what it holds. */
function clocked() {
  let now = 1_000_000;
  const store = createMemoryLimitStore({ clock: () => now });
  const seen: string[] = [];
  const watched: LimitStore = {
    shared: store.shared,
    update: (keys, apply) => {
      seen.push(...keys);
      return store.update(keys, apply);
    },
    read: keys => store.read(keys),
    sweep: () => store.sweep(),
  };
  return {
    store: watched,
    seen,
    advance: (ms: number) => {
      now += ms;
    },
    read: (
      keys: readonly string[]
    ): Promise<ReadonlyMap<string, StoredLimit>> => store.read(keys),
    now: () => now,
  };
}

describe("coreLimitStore", () => {
  it("admits up to the limit in a window and refuses the next, recording no refusal", async () => {
    const { store } = clocked();
    const limiter = new RateLimiter(coreLimitStore(store, SECRET));

    for (let i = 0; i < 3; i += 1) {
      expect(
        (await limiter.check("auth-ip:203.0.113.7", 3, WINDOW)).allowed
      ).toBe(true);
    }
    expect(
      (await limiter.check("auth-ip:203.0.113.7", 3, WINDOW)).allowed
    ).toBe(false);
    // A refusal records nothing: the count stays at the limit.
    expect(await limiter.peek("auth-ip:203.0.113.7", WINDOW)).toBe(3);
  });

  it("forgets attempts once their window has passed", async () => {
    const { store, advance } = clocked();
    const limiter = new RateLimiter(coreLimitStore(store, SECRET));

    for (let i = 0; i < 3; i += 1) await limiter.check("k", 3, WINDOW);
    expect((await limiter.check("k", 3, WINDOW)).allowed).toBe(false);
    advance(WINDOW + 1);
    expect((await limiter.check("k", 3, WINDOW)).allowed).toBe(true);
  });

  it("rolls the window rather than resetting it all at once", async () => {
    // Two attempts early, one late: once the early ones age out, the late one
    // still counts, which a fixed window starting at the first would forget.
    const { store, advance } = clocked();
    const limiter = new RateLimiter(coreLimitStore(store, SECRET));

    await limiter.check("k", 3, WINDOW);
    await limiter.check("k", 3, WINDOW);
    advance(WINDOW / 2);
    await limiter.check("k", 3, WINDOW);
    advance(WINDOW / 2 + 1);
    expect(await limiter.peek("k", WINDOW)).toBe(1);
  });

  it("stores no key as given, only a keyed hash of it", async () => {
    const { store, seen } = clocked();
    const limiter = new RateLimiter(coreLimitStore(store, SECRET));

    await limiter.check("auth-ip:203.0.113.7", 3, WINDOW);
    await limiter.check("ratelimit:session:user_42:read", 3, WINDOW);

    expect(seen.length).toBeGreaterThan(0);
    for (const key of seen) {
      expect(key).not.toContain("203.0.113.7");
      expect(key).not.toContain("user_42");
    }
    // Keyed: another secret stores the same key under another name.
    const other = clocked();
    await new RateLimiter(coreLimitStore(other.store, `${SECRET}-other`)).check(
      "auth-ip:203.0.113.7",
      3,
      WINDOW
    );
    expect(other.seen[0]).not.toBe(seen[0]);
  });

  it("gives an entry an expiry no later than the end of its newest attempt's window", async () => {
    const { store, seen, advance, read, now } = clocked();
    const limiter = new RateLimiter(coreLimitStore(store, SECRET));

    await limiter.check("k", 3, WINDOW);
    advance(10_000);
    const last = now();
    await limiter.check("k", 3, WINDOW);

    const [entry] = [...(await read([seen[0]])).values()];
    expect(entry.expiresAt).toBeLessThanOrEqual(last + WINDOW);
    expect(entry.expiresAt).toBeGreaterThan(last);
  });

  it("counts every attempt through increment, and reset clears the key", async () => {
    const { store } = clocked();
    const limits = coreLimitStore(store, SECRET);

    expect((await limits.increment("k", WINDOW)).count).toBe(1);
    expect((await limits.increment("k", WINDOW)).count).toBe(2);
    await limits.reset("k");
    expect((await limits.increment("k", WINDOW)).count).toBe(1);
  });

  it("keeps each key's count apart", async () => {
    const { store } = clocked();
    const limiter = new RateLimiter(coreLimitStore(store, SECRET));

    for (let i = 0; i < 3; i += 1) await limiter.check("a", 3, WINDOW);
    expect((await limiter.check("a", 3, WINDOW)).allowed).toBe(false);
    expect((await limiter.check("b", 3, WINDOW)).allowed).toBe(true);
  });

  it("passes a store's unavailable answer on rather than admitting", async () => {
    const failing: LimitStore = {
      shared: true,
      update: () => Promise.reject(new Error("connection refused")),
      read: () => Promise.reject(new Error("connection refused")),
      sweep: () => Promise.resolve(0),
    };
    const limiter = new RateLimiter(coreLimitStore(failing, SECRET));

    await expect(limiter.check("k", 3, WINDOW)).rejects.toThrow(
      "connection refused"
    );
  });
});

describe("coreRateLimitStoreFor", () => {
  it("keeps an app's store of the older contract serving core's own limits", async () => {
    const calls: string[] = [];
    const appStore: RateLimitStore = {
      increment: async (key, windowMs) => {
        calls.push(`increment ${key}`);
        return { count: 1, resetTime: Date.now() + windowMs };
      },
      reset: async () => {},
      consume: async (key, limit, windowMs) => {
        calls.push(`consume ${key}`);
        return { count: 1, resetTime: Date.now() + windowMs, allowed: true };
      },
    };
    let selectedAsked = false;
    const counts = coreRateLimitStoreFor(
      appStore,
      () => {
        selectedAsked = true;
        return createMemoryLimitStore();
      },
      SECRET
    );

    await new RateLimiter(counts).check("auth-ip:203.0.113.7", 3, WINDOW);

    // The app's store is asked, under the key as core names it, as before.
    expect(calls).toEqual(["consume auth-ip:203.0.113.7"]);
    expect(selectedAsked).toBe(false);
  });

  it("counts in the selected store, under keyed hashes, when the app configured none", async () => {
    const { store, seen } = clocked();
    const counts = coreRateLimitStoreFor(undefined, () => store, SECRET);

    await new RateLimiter(counts).check("auth-ip:203.0.113.7", 3, WINDOW);

    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain("203.0.113.7");
  });
});
