/**
 * An editor holding its outline while what finishes it is on its way: until
 * it arrives, for 250 ms at most, and never again once the editor is shown.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EDITOR_CLAIM_HOLD_MS,
  EDITOR_REVEAL_HOLD_MS,
  useEditorRevealHold,
  useHeldReveal,
} from "../delayed-reveal";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("holding an editor's outline", () => {
  it("holds while waiting, and shows once what it waits for is in", () => {
    const { result, rerender } = renderHook(
      ({ waiting }) => useHeldReveal(waiting),
      { initialProps: { waiting: true } }
    );
    expect(result.current).toBe(true);
    rerender({ waiting: false });
    expect(result.current).toBe(false);
  });

  it("shows at the cap when a read never answers", () => {
    const { result } = renderHook(() => useHeldReveal(true));
    act(() => {
      vi.advanceTimersByTime(EDITOR_REVEAL_HOLD_MS - 1);
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it("never takes a shown editor away when something starts waiting again", () => {
    const { result, rerender } = renderHook(
      ({ waiting }) => useHeldReveal(waiting),
      { initialProps: { waiting: false } }
    );
    expect(result.current).toBe(false);
    rerender({ waiting: true });
    expect(result.current).toBe(false);
  });

  it("holds nothing where there is nothing to wait for", () => {
    const { result } = renderHook(() => useHeldReveal(false));
    expect(result.current).toBe(false);
  });
});

describe("holding an editor until its claim and its parts' reads are in", () => {
  it("waits longer for the claim, which says whether the editor may write", () => {
    const { result } = renderHook(() =>
      useEditorRevealHold(true, { claim: true, reads: false })
    );
    act(() => {
      vi.advanceTimersByTime(EDITOR_REVEAL_HOLD_MS);
    });
    // Past the parts' short wait, the claim is still waited for.
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(EDITOR_CLAIM_HOLD_MS - EDITOR_REVEAL_HOLD_MS);
    });
    expect(result.current).toBe(false);
  });

  it("waits only briefly for the parts' reads", () => {
    const { result } = renderHook(() =>
      useEditorRevealHold(true, { claim: false, reads: true })
    );
    act(() => {
      vi.advanceTimersByTime(EDITOR_REVEAL_HOLD_MS);
    });
    expect(result.current).toBe(false);
  });

  it("holds nothing for an editor with no outline to hold", () => {
    const { result } = renderHook(() =>
      useEditorRevealHold(false, { claim: true, reads: true })
    );
    expect(result.current).toBe(false);
  });
});
