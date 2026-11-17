// @vitest-environment jsdom
/**
 * Recent colours: the last eight colours an author typed or picked, newest
 * first, kept in the host's store for that author, and read by every colour
 * picker on screen from the one list.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { RecentColoursStore, useRecentColours } from "./recent-colours";
import type { PreferenceStore } from "./shell-state";

afterEach(cleanup);

/** A store over one value, as the host's browser store is. */
function memory(initial: string | null = null): PreferenceStore & {
  readonly value: string | null;
} {
  let value = initial;
  return {
    read: () => value,
    write: (next: string) => {
      value = next;
    },
    get value() {
      return value;
    },
  };
}

function withStore(store: PreferenceStore | undefined) {
  return ({ children }: { children: React.ReactNode }) => (
    <RecentColoursStore.Provider value={store}>
      {children}
    </RecentColoursStore.Provider>
  );
}

describe("Recent colours", () => {
  it("keeps the last eight, newest first, each once", () => {
    const store = memory();
    const { result } = renderHook(() => useRecentColours(), {
      wrapper: withStore(store),
    });
    const nine = [
      "#111111",
      "#222222",
      "rgb(255, 0, 0)",
      "hsl(120 100% 25%)",
      "#555555",
      "#666666",
      "#777777",
      "#888888",
      "#999999",
    ];
    for (const colour of nine) act(() => result.current[1](colour));
    // Chosen again, it moves to the front rather than showing twice.
    act(() => result.current[1]("#555555"));

    expect(result.current[0]).toEqual([
      "#555555",
      "#999999",
      "#888888",
      "#777777",
      "#666666",
      "hsl(120 100% 25%)",
      "rgb(255, 0, 0)",
      "#222222",
    ]);
    // Kept in the store, so a reload reads the same list.
    expect(JSON.parse(store.value ?? "[]")).toEqual(result.current[0]);
  });

  it("reads the list a reload left in the store", () => {
    const store = memory('["#ff0000","#00ff00"]');
    const { result } = renderHook(() => useRecentColours(), {
      wrapper: withStore(store),
    });
    expect(result.current[0]).toEqual(["#ff0000", "#00ff00"]);
  });

  it("remembers only a colour written as a value, never a variable or a keyword", () => {
    const store = memory();
    const { result } = renderHook(() => useRecentColours(), {
      wrapper: withStore(store),
    });
    for (const value of [
      { $token: "color.brand" },
      "var(--brand)",
      "currentcolor",
      "inherit",
      "transparent",
      "",
      "   ",
      null,
      undefined,
      12,
    ]) {
      act(() => result.current[1](value));
    }
    expect(result.current[0]).toEqual([]);
    act(() => result.current[1]("  #ABCDEF  "));
    expect(result.current[0]).toEqual(["#ABCDEF"]);
  });

  it("shows a colour remembered in one picker in every other at once", () => {
    const store = memory();
    const wrapper = withStore(store);
    const one = renderHook(() => useRecentColours(), { wrapper });
    const other = renderHook(() => useRecentColours(), { wrapper });
    act(() => one.result.current[1]("#123456"));
    expect(other.result.current[0]).toEqual(["#123456"]);
  });

  it("offers none and keeps none without a store", () => {
    const { result } = renderHook(() => useRecentColours());
    act(() => result.current[1]("#123456"));
    expect(result.current[0]).toEqual([]);
  });
});
