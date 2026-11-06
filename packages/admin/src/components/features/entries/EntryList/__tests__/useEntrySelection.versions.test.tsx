/**
 * The list's selection remembers the version each row had when it was
 * selected: a bulk action then judges each document by the version the
 * editor saw in the list, and a row changed since is refused alone.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useEntrySelection } from "../useEntrySelection";

const row = (id: string, rev?: string) =>
  rev === undefined ? { id } : { id, _rev: rev };

describe("the list's selection", () => {
  it("remembers each selected row's version as it was when selected", () => {
    const { result } = renderHook(() => useEntrySelection(true));
    act(() => result.current.selection?.onToggle(row("a", "3")));
    act(() =>
      result.current.selection?.onToggleAll(
        [row("b", "5"), row("c", "1")],
        false
      )
    );
    expect(result.current.versions).toEqual({ a: "3", b: "5", c: "1" });

    // Unselected, its version is forgotten with it.
    act(() => result.current.selection?.onToggle(row("a", "4")));
    expect(result.current.versions).toEqual({ b: "5", c: "1" });
  });

  it("forgets every version when cleared, and takes them again on select all", () => {
    const { result } = renderHook(() => useEntrySelection(true));
    act(() => result.current.selection?.onToggle(row("a", "3")));
    act(() => result.current.clear());
    expect(result.current.versions).toEqual({});
    act(() => result.current.selectAll([row("x", "2"), row("y")]));
    expect(result.current.versions).toEqual({ x: "2" });
  });
});
