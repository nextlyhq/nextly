/**
 * The one bounded race: a read's answer, or word that its time ran out, with
 * no timer left behind either way.
 *
 * @module within-time.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { TIMED_OUT, within, withinTime } from "./within-time";

/** A read that answers `value` after `ms` of the (fake) clock. */
const after = <T>(ms: number, value: T) =>
  new Promise<T>(resolve => setTimeout(() => resolve(value), ms));

describe("a read held to a time box", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers the read's value when it comes first, and its time out when it does not", async () => {
    vi.useFakeTimers();
    const fast = within(after(1_000, "read"), 2_000);
    const slow = within(after(3_000, "read"), 2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(fast).resolves.toBe("read");
    await expect(slow).resolves.toBe(TIMED_OUT);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits on an unbounded box rather than taking it as spent", async () => {
    vi.useFakeTimers();
    // A delay past what a timer holds fires after 1 ms unless it is capped.
    const read = within(after(10, "read"), Number.POSITIVE_INFINITY);
    await vi.advanceTimersByTimeAsync(10);
    await expect(read).resolves.toBe("read");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refuses with the caller's own error once the time runs out", async () => {
    vi.useFakeTimers();
    const late = new Error("late");
    const read = withinTime(after(3_000, "read"), 2_000, () => late);
    const refused = expect(read).rejects.toBe(late);
    await vi.advanceTimersByTimeAsync(2_000);
    await refused;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
