// @vitest-environment jsdom

/**
 * The report's read asks again every ten seconds while a check is still to
 * finish, and only while the read is enabled: a cached unfinished scan never
 * keeps asking for a list nobody has open.
 *
 * @module admin/bindings-report/client.test
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The read's explicit ask again, which runs even for a disabled read. */
const refetch = vi.fn();

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  // A cached answer of a scan still running, whether or not the read is on.
  usePluginRoute: () => ({
    data: { items: [], meta: { bindings: 2, checking: true, checkedAt: null } },
    pending: false,
    error: null,
    refetch,
  }),
}));

const { useBindingsToFix } = await import("./client");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  refetch.mockClear();
});

describe("the report read while a check is still to finish", () => {
  it("asks again every ten seconds while it is enabled", () => {
    renderHook(() => useBindingsToFix());
    vi.advanceTimersByTime(20_000);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("asks nothing while it is disabled, though a cached answer is unfinished", () => {
    renderHook(() => useBindingsToFix({}, { enabled: false }));
    vi.advanceTimersByTime(30_000);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("stops asking once it is disabled", () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useBindingsToFix({}, { enabled }),
      { initialProps: { enabled: true } }
    );
    vi.advanceTimersByTime(10_000);
    expect(refetch).toHaveBeenCalledTimes(1);
    rerender({ enabled: false });
    vi.advanceTimersByTime(30_000);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
