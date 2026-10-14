/**
 * Every limit store call is answered within its time, and a store's own
 * failure is answered as unavailable: a limit sits in front of the work it
 * guards, so a store that stops answering must not hold every request.
 */
import { describe, expect, it } from "vitest";

import { withCallDeadline } from "../call-deadline";
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
