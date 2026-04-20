// What: tests for the minimum display time behaviour of RestartContext.
// Why: apply operations can finish in under 100 ms (metadata-only changes),
// and without a minimum display time React batches the isRestarting
// false -> true -> false transition in the same render cycle and the
// RestartOverlay never actually paints. These tests lock in the 800 ms
// minimum so users always get visual feedback.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RestartProvider, useRestart } from "./RestartContext";

// Minimal wrapper: RestartProvider uses useQueryClient for cache invalidation.
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <RestartProvider>{children}</RestartProvider>
      </QueryClientProvider>
    );
  };
}

describe("RestartContext minimum display time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps isRestarting true for at least 800ms after startRestart even if stopRestart is called immediately", () => {
    const { result } = renderHook(() => useRestart(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.startRestart();
    });
    expect(result.current.isRestarting).toBe(true);

    act(() => {
      result.current.stopRestart(true, "done");
    });
    // Still true right after stop: min display time has not elapsed.
    expect(result.current.isRestarting).toBe(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    // Still true at 500ms.
    expect(result.current.isRestarting).toBe(true);

    act(() => {
      vi.advanceTimersByTime(400);
    });
    // Now past 800ms - should flip to false.
    expect(result.current.isRestarting).toBe(false);
  });

  it("flips to false immediately when 800ms has already elapsed by the time stopRestart is called", () => {
    const { result } = renderHook(() => useRestart(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.startRestart();
    });

    // Simulate a long apply: 1000ms elapses before stop is called.
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    act(() => {
      result.current.stopRestart(true, "done");
    });
    // Min display already satisfied, should flip immediately.
    expect(result.current.isRestarting).toBe(false);
  });
});
