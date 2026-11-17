/**
 * The release screens' clock: moved on once a minute while it ticks, and
 * still, with no timer at all, while it does not; reading the time at once
 * when it starts.
 *
 * @module components/features/releases/__tests__/useMinuteClock.test
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMinuteClock } from "../useMinuteClock";

afterEach(() => {
  vi.useRealTimers();
});

describe("the minute clock", () => {
  it("moves on once a minute while it ticks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { result } = renderHook(() => useMinuteClock());
    expect(result.current).toBe(0);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(60_000);
  });

  it("sets no timer and stays still while it does not tick", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const started = vi.spyOn(window, "setInterval");
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useMinuteClock(false);
    });
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(started).not.toHaveBeenCalled();
    expect(renders).toBe(1);
    expect(result.current).toBe(0);
  });

  it("reads the time at once when it starts ticking", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { result, rerender } = renderHook(
      ({ ticking }: { ticking: boolean }) => useMinuteClock(ticking),
      { initialProps: { ticking: false } }
    );
    vi.setSystemTime(90_000);
    rerender({ ticking: true });
    expect(result.current).toBe(90_000);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(150_000);
  });
});
