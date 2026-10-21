/**
 * Every limit store call is answered within its time, and a store's own
 * failure is answered as unavailable: a limit sits in front of the work it
 * guards, so a store that stops answering must not hold every request.
 */
import { describe, expect, it } from "vitest";

import type { RateLimitStore } from "../../../middleware/rate-limit";
import {
  LIMIT_STORE_HARD_CAP_MULTIPLE,
  withCallDeadline,
  withRateLimitStoreDeadline,
} from "../call-deadline";
import { limitStoreUnavailableReason, type LimitStore } from "../limit-store";
import { createMemoryLimitStore } from "../memory-limit-store";

/** A store whose every call never settles. */
const silentStore: LimitStore = {
  shared: true,
  update: () => new Promise(() => undefined),
  read: () => new Promise(() => undefined),
  sweep: () => new Promise(() => undefined),
};

/** A store whose every call fails as an unreachable client would. */
const failingStore: LimitStore = {
  shared: true,
  update: () => Promise.reject(new Error("connection refused")),
  read: () => Promise.reject(new Error("connection refused")),
  sweep: () => Promise.reject(new Error("connection refused")),
};

/** What `promise` settled with, and how long it took. */
async function settled(promise: Promise<unknown>) {
  const started = performance.now();
  try {
    return { value: await promise, ms: performance.now() - started };
  } catch (error) {
    return { error, ms: performance.now() - started };
  }
}

describe("a limit store call held to a time", () => {
  it("answers each call to a store that never answers as unavailable, within the time", async () => {
    const store = withCallDeadline(silentStore, 50);

    const outcomes = await Promise.all([
      settled(store.update(["k"], () => ({ write: new Map(), result: 1 }))),
      settled(store.read(["k"])),
      settled(store.sweep()),
    ]);

    for (const outcome of outcomes) {
      expect(limitStoreUnavailableReason(outcome.error)).toBe("timeout");
      expect(outcome.ms).toBeLessThan(500);
    }
  });

  it("starts nothing past its calls in flight, answering at once until the store settles them", async () => {
    let started = 0;
    const settleAll: Array<() => void> = [];
    const hanging: LimitStore = {
      shared: true,
      update: () => {
        started += 1;
        return new Promise(resolve =>
          settleAll.push(() => resolve(undefined as never))
        );
      },
      read: () => Promise.resolve(new Map()),
      sweep: () => Promise.resolve(0),
    };
    const store = withCallDeadline(hanging, 30, 3);
    const update = () =>
      settled(store.update(["k"], () => ({ write: new Map(), result: 1 })));

    const timedOut = await Promise.all([update(), update(), update()]);
    const fourth = await update();

    expect(
      timedOut.map(outcome => limitStoreUnavailableReason(outcome.error))
    ).toEqual(["timeout", "timeout", "timeout"]);
    expect(limitStoreUnavailableReason(fourth.error)).toBe("timeout");
    expect(fourth.ms).toBeLessThan(25);
    expect(started).toBe(3);

    // Once the store settles them, calls start again.
    for (const settle of settleAll) settle();
    await new Promise(resolve => setTimeout(resolve, 0));
    await update();
    expect(started).toBe(4);
  });

  it("answers a store's own failure as unreachable", async () => {
    const store = withCallDeadline(failingStore, 1000);

    const outcome = await settled(store.read(["k"]));

    expect(limitStoreUnavailableReason(outcome.error)).toBe("unreachable");
  });

  it("hands back what the caller's apply threw, unchanged", async () => {
    const store = withCallDeadline(createMemoryLimitStore(), 1000);
    const thrown = new Error("the caller's own");

    const outcome = await settled(
      store.update(["k"], () => {
        throw thrown;
      })
    );

    expect(outcome.error).toBe(thrown);
  });

  it("passes through what an answering store answers", async () => {
    const store = withCallDeadline(createMemoryLimitStore(), 1000);

    const result = await store.update(["k"], (_current, now) => ({
      write: new Map([["k", { value: 7, expiresAt: now + 1000 }]]),
      result: "done",
    }));

    expect(result).toBe("done");
    expect((await store.read(["k"])).get("k")?.value).toBe(7);
    expect(store.shared).toBe(false);
  });
});

describe("withRateLimitStoreDeadline after calls that never settle", () => {
  it("lets calls reach the store again once the store answers, rather than refusing for good", async () => {
    // Calls that time out and never settle used to hold their places under
    // the cap forever, so the store, healthy again, was never asked: sign-in
    // refused and the API went uncounted until the process restarted.
    let hanging = true;
    const store: RateLimitStore = {
      increment: (_key, windowMs) =>
        hanging
          ? new Promise(() => {})
          : Promise.resolve({ count: 1, resetTime: Date.now() + windowMs }),
      reset: () => Promise.resolve(),
    };
    const guarded = withRateLimitStoreDeadline(store, 20, 2);

    // Two calls hang and time out, filling the cap.
    await expect(guarded.increment("a", 1_000)).rejects.toThrow();
    await expect(guarded.increment("b", 1_000)).rejects.toThrow();
    // At the cap, a call is answered as unavailable without asking the store.
    await expect(guarded.increment("c", 1_000)).rejects.toThrow();

    // The store recovers; after the abandoned calls stop holding places, a
    // call reaches it and is counted.
    hanging = false;
    await new Promise(resolve => setTimeout(resolve, 250));
    await expect(guarded.increment("d", 1_000)).resolves.toMatchObject({
      count: 1,
    });
  });
});

describe("withRateLimitStoreDeadline against a store that never answers", () => {
  it("starts at most one call a round once its hard cap is full, however long it runs", async () => {
    // Calls past their deadline stop holding a place so the store can be
    // asked again once it answers, but each still runs in the store. Once the
    // hard cap's worth are unsettled, only one recovery call at a time starts,
    // and each round here outlasts the abandon window (ten 5ms deadlines), so
    // a round starts at most one call where the in-flight cap alone admits two.
    let started = 0;
    const store: RateLimitStore = {
      increment: () => {
        started += 1;
        return new Promise(() => {});
      },
      reset: () => Promise.resolve(),
    };
    const guarded = withRateLimitStoreDeadline(store, 5, 2);
    const hardCap = 2 * LIMIT_STORE_HARD_CAP_MULTIPLE;
    const pastCap: number[] = [];

    for (let round = 0; round < 12; round += 1) {
      const before = started;
      await Promise.allSettled([
        guarded.increment("a", 1_000),
        guarded.increment("b", 1_000),
        guarded.increment("c", 1_000),
      ]);
      if (before >= hardCap) pastCap.push(started - before);
      await new Promise(resolve => setTimeout(resolve, 60));
    }

    expect(pastCap.length).toBeGreaterThan(3);
    expect(Math.max(...pastCap)).toBe(1);
  });

  it("still reaches a store that answers again once the hard cap is full of calls that never settle", async () => {
    // A strict bound and guaranteed recovery cannot both hold when calls
    // never settle; one recovery call at a time is let through past the cap.
    let hanging = true;
    const store: RateLimitStore = {
      increment: (_key, windowMs) =>
        hanging
          ? new Promise(() => {})
          : Promise.resolve({ count: 1, resetTime: Date.now() + windowMs }),
      reset: () => Promise.resolve(),
    };
    const guarded = withRateLimitStoreDeadline(store, 5, 2);

    // Fill the hard cap (eight) with calls that never settle.
    for (let round = 0; round < 6; round += 1) {
      await Promise.allSettled([
        guarded.increment("a", 1_000),
        guarded.increment("b", 1_000),
      ]);
      await new Promise(resolve => setTimeout(resolve, 60));
    }

    hanging = false;
    await new Promise(resolve => setTimeout(resolve, 60));
    await expect(guarded.increment("c", 1_000)).resolves.toMatchObject({
      count: 1,
    });
  });
});
