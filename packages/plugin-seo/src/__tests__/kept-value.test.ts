/**
 * The value the Proxy's handlers keep in memory: read once, answered from
 * memory after that, read again in the background once old, and read afresh
 * once forgotten.
 */
import { describe, expect, it } from "vitest";

import { keptValue } from "../kept-value";

/** A read answering 1, 2, 3, ... in turn, each held until `release` is called. */
function reads() {
  const pending: (() => void)[] = [];
  let count = 0;
  const read = () => {
    count += 1;
    const value = count;
    return new Promise<number>(resolve => pending.push(() => resolve(value)));
  };
  return {
    read,
    count: () => count,
    /** Answer the oldest held read, or with `last` the newest. */
    release: async (last = false) => {
      (last ? pending.pop() : pending.shift())?.();
      await new Promise(resolve => setTimeout(resolve, 0));
    },
  };
}

describe("a kept value", () => {
  it("is read by the first get only, and answered from memory after that", async () => {
    const source = reads();
    const kept = keptValue(source.read, 1000, () => 0);
    const first = kept.get();
    const second = kept.get();
    await source.release();
    expect(await first).toBe(1);
    expect(await second).toBe(1);
    expect(await kept.get()).toBe(1);
    expect(source.count()).toBe(1);
  });

  it("once old, answers the old value at once and reads again in the background", async () => {
    const source = reads();
    let now = 0;
    const kept = keptValue(source.read, 1000, () => now);
    const first = kept.get();
    await source.release();
    await first;
    now = 1500;
    // The second read is held: the get must not wait for it.
    expect(await kept.get()).toBe(1);
    expect(source.count()).toBe(2);
    // Asked again while it runs, no third read is started.
    expect(await kept.get()).toBe(1);
    expect(source.count()).toBe(2);
    await source.release();
    expect(await kept.get()).toBe(2);
  });

  it("once forgotten, makes the next get wait for a fresh read", async () => {
    const source = reads();
    const kept = keptValue(source.read, 1000, () => 0);
    const first = kept.get();
    await source.release();
    await first;
    kept.forget();
    const next = kept.get();
    await source.release();
    expect(await next).toBe(2);
  });

  it("never keeps a read that began before it was forgotten", async () => {
    const source = reads();
    const kept = keptValue(source.read, 1000, () => 0);
    const early = kept.get();
    kept.forget();
    const late = kept.get();
    // The fresh read answers first, then the one from before the forget.
    await source.release(true);
    await source.release();
    expect(await early).toBe(1);
    expect(await late).toBe(2);
    expect(await kept.get()).toBe(2);
  });

  it("keeps the old value where a background read fails, and waits a full interval to try again", async () => {
    let now = 0;
    let count = 0;
    const kept = keptValue(
      async () => {
        count += 1;
        if (count === 2) throw new Error("the database is down");
        return count;
      },
      1000,
      () => now
    );
    expect(await kept.get()).toBe(1);
    now = 1500;
    expect(await kept.get()).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await kept.get()).toBe(1);
    expect(count).toBe(2);
    now = 2600;
    await kept.get();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await kept.get()).toBe(3);
  });
});
