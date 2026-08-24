// @vitest-environment jsdom

/**
 * Reading a value React has been told about but has not yet committed.
 *
 * @module use-shown.test
 */
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useShown } from "./use-shown";

describe("state a caller can also read synchronously", () => {
  it("reads a value written but NOT yet committed", () => {
    const { result } = renderHook(() => useShown<number | null>(null));
    const [, write, read] = result.current;

    // The control: before anything is written, both agree.
    expect(read()).toBeNull();
    expect(result.current[0]).toBeNull();

    /*
     * Written OUTSIDE `act`, deliberately. `act` flushes the render, which is
     * exactly the commit this exists to not have to wait for — doing the write
     * inside it would assert a property every plain `useState` already has.
     */
    write(7);
    expect(read()).toBe(7);
    // And the rendered value has NOT caught up, which is what makes the read
    // above the only way to answer during this window.
    expect(result.current[0]).toBeNull();
  });

  it("catches the render up once it commits", () => {
    // The other half: this is state, not a box beside it. A reader that stayed
    // ahead forever would mean the panel never showed what was written.
    const { result } = renderHook(() => useShown<number | null>(null));
    act(() => {
      result.current[1](7);
    });
    expect(result.current[0]).toBe(7);
    expect(result.current[2]()).toBe(7);
  });

  it("keeps ONE writer and ONE reader across renders", () => {
    /*
     * Both are stable, so a caller that captured either in a closure — an
     * `async` function outliving its render is the case here — still writes to
     * and reads from the same place after the component re-renders.
     */
    const { result, rerender } = renderHook(() =>
      useShown<number | null>(null)
    );
    const [, writeFirst, readFirst] = result.current;
    act(() => {
      result.current[1](1);
    });
    rerender();
    expect(result.current[1]).toBe(writeFirst);
    expect(result.current[2]).toBe(readFirst);
    // The captured pair still answers for the CURRENT value, which is the
    // property a stale closure depends on.
    writeFirst(2);
    expect(readFirst()).toBe(2);
  });
});
