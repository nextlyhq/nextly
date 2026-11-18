// @vitest-environment jsdom
/**
 * Activity's clock moves on while the page is open, so its relative times
 * ("10 min ago", "Next attempt in 10 min") don't freeze when nothing else
 * renders the screen again.
 *
 * @module components/features/email-hub/activity/__tests__/useTickingNow.test
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTickingNow } from "../ActivityScreen";

afterEach(() => {
  vi.useRealTimers();
});

describe("useTickingNow", () => {
  it("reads the clock again every interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T12:00:00.000Z"));
    const { result } = renderHook(() => useTickingNow(30_000));
    expect(result.current.toISOString()).toBe("2026-11-16T12:00:00.000Z");

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.toISOString()).toBe("2026-11-16T12:00:30.000Z");
  });

  it("stops when the screen goes", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useTickingNow(30_000));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
