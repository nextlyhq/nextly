import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useDebounce } from "./useDebounce";

describe("useDebounce (callback debouncing)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a function", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebounce(callback, 300));

    expect(typeof result.current).toBe("function");
  });

  it("does not call callback immediately", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebounce(callback, 300));

    result.current("test");

    expect(callback).not.toHaveBeenCalled();
  });

  it("calls callback after delay", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebounce(callback, 300));

    result.current("test");

    // Fast-forward time
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(callback).toHaveBeenCalledWith("test");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("debounces multiple rapid calls", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebounce(callback, 300));

    // Rapid calls
    result.current("first");
    act(() => {
      vi.advanceTimersByTime(100);
    });

    result.current("second");
    act(() => {
      vi.advanceTimersByTime(100);
    });

    result.current("third");
    act(() => {
      vi.advanceTimersByTime(100);
    });

    result.current("final");

    // Callback should not have been called yet
    expect(callback).not.toHaveBeenCalled();

    // Fast-forward past debounce delay
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Should only be called once with the final value
    expect(callback).toHaveBeenCalledWith("final");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("cleans up timeout on unmount", () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useDebounce(callback, 300));

    result.current("test");

    // Unmount before delay expires
    unmount();

    // Fast-forward time
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Callback should not have been called
    expect(callback).not.toHaveBeenCalled();
  });

  it("uses latest callback reference (avoids stale closures)", () => {
    let count = 0;
    const callback1 = vi.fn(() => count++);
    const callback2 = vi.fn(() => (count += 10));

    const { result, rerender } = renderHook(({ cb }) => useDebounce(cb, 300), {
      initialProps: { cb: callback1 },
    });

    result.current();

    // Update the callback before delay expires
    rerender({ cb: callback2 });

    // Fast-forward time
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Should use the latest callback (callback2)
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(count).toBe(10);
  });

  it("handles multiple arguments", () => {
    const callback = vi.fn();
    const { result } = renderHook(() =>
      useDebounce((a: string, b: number, c: boolean) => callback(a, b, c), 300)
    );

    result.current("hello", 42, true);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(callback).toHaveBeenCalledWith("hello", 42, true);
  });

  it("creates new debounced function when delay changes", () => {
    const callback = vi.fn();
    const { result, rerender } = renderHook(
      ({ delay }) => useDebounce(callback, delay),
      { initialProps: { delay: 300 } }
    );

    const firstFunction = result.current;

    rerender({ delay: 500 });

    const secondFunction = result.current;

    expect(firstFunction).not.toBe(secondFunction);
  });

  it("maintains stable reference when delay is unchanged", () => {
    const callback = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useDebounce(cb, 300), {
      initialProps: { cb: callback },
    });

    const firstFunction = result.current;

    // Re-render with different callback but same delay
    const callback2 = vi.fn();
    rerender({ cb: callback2 });

    const secondFunction = result.current;

    // Function reference should be stable (same delay)
    expect(firstFunction).toBe(secondFunction);
  });
});
