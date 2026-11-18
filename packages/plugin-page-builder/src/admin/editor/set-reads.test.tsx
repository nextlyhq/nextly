// @vitest-environment jsdom
/**
 * The set's reads asked again by one call that stays the same while the
 * reads' own `refetch` change on each render, so a reader keyed on it never
 * asks again on its own.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRereadAll } from "./set-reads";

describe("asking the set's reads again", () => {
  it("is one function across renders, calling the latest of each read", () => {
    const first = vi.fn();
    const { result, rerender } = renderHook(
      ({ refetches }) => useRereadAll(refetches),
      { initialProps: { refetches: [first] as (() => void)[] } }
    );
    const call = result.current;
    const latest = vi.fn();
    const other = vi.fn();
    rerender({ refetches: [latest, other] });
    expect(result.current).toBe(call);
    result.current();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  });
});
