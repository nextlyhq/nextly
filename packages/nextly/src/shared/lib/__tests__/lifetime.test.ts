/**
 * A value's lifetime is measured on the monotonic clock: it is within its
 * lifetime until exactly that long has passed, and never once a wall-clock
 * correction moves `Date` back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { isWithinLifetime, monotonicNow } from "../lifetime";

afterEach(() => {
  vi.useRealTimers();
});

describe("a value's lifetime", () => {
  it("lasts until exactly its length has passed", () => {
    expect(isWithinLifetime(100, 1000, 1099)).toBe(true);
    expect(isWithinLifetime(100, 1000, 1100)).toBe(false);
  });

  it("has not begun for a value never read", () => {
    expect(isWithinLifetime(undefined, 1000, 0)).toBe(false);
  });

  it("is timed on the monotonic clock, which a wall-clock correction does not move", () => {
    vi.useFakeTimers({ toFake: ["performance", "Date"] });
    const readAt = monotonicNow();
    vi.advanceTimersByTime(1500);
    // The wall clock is corrected back an hour; the lifetime is still over.
    vi.setSystemTime(Date.now() - 3_600_000);
    expect(isWithinLifetime(readAt, 1000)).toBe(false);
  });
});
