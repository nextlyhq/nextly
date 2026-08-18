// @vitest-environment jsdom
/**
 * The property under test is DURABILITY. A control that forgets is worse than
 * no control: the reader narrows a wide table, comes back, and finds their work
 * undone with nothing to explain it.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useListColumns } from "../useListColumns";

const COLUMNS = [
  { name: "name", header: "Name" },
  { name: "email", header: "Email" },
  { name: "created", header: "Created" },
];

beforeEach(() => localStorage.clear());

describe("useListColumns", () => {
  it("shows every column to a reader who has never chosen", () => {
    const { result } = renderHook(() =>
      useListColumns({ storageKey: "widgets", columns: COLUMNS })
    );
    for (const column of COLUMNS) {
      expect(result.current.isColumnVisible(column.name)).toBe(true);
    }
  });

  /**
   * A column the control was never given is not a column the control hides.
   *
   * Every list surface keeps its primary identifying column out of the
   * toggleable set — a reader must not be able to hide the one cell that says
   * which row this is — and then asks this control about EVERY column when it
   * computes `hidden`. Answering "not visible" for a column outside its remit
   * hides the row's name on every one of those lists, which is what took the
   * admin-smoke roles assertion down.
   */
  it("reports a column it does not manage as visible", () => {
    const { result } = renderHook(() =>
      useListColumns({ storageKey: "widgets", columns: COLUMNS })
    );
    expect(result.current.isColumnVisible("roleName")).toBe(true);
  });

  it("keeps reporting an unmanaged column visible after a toggle", () => {
    const { result } = renderHook(() =>
      useListColumns({ storageKey: "widgets", columns: COLUMNS })
    );
    act(() => result.current.onToggleColumn("email"));
    expect(result.current.isColumnVisible("email")).toBe(false);
    expect(result.current.isColumnVisible("roleName")).toBe(true);
  });

  it("hides a column when it is toggled", () => {
    const { result } = renderHook(() =>
      useListColumns({ storageKey: "widgets", columns: COLUMNS })
    );
    act(() => result.current.onToggleColumn("email"));
    expect(result.current.isColumnVisible("email")).toBe(false);
    expect(result.current.isColumnVisible("name")).toBe(true);
  });

  /**
   * The whole point. A fresh mount is what a reload is, so this is the
   * assertion that separates a persisted choice from a per-session one.
   */
  it("remembers the choice across a remount", () => {
    const first = renderHook(() =>
      useListColumns({ storageKey: "widgets", columns: COLUMNS })
    );
    act(() => first.result.current.onToggleColumn("email"));
    first.unmount();

    const second = renderHook(() =>
      useListColumns({ storageKey: "widgets", columns: COLUMNS })
    );
    expect(second.result.current.isColumnVisible("email")).toBe(false);
    expect(second.result.current.isColumnVisible("name")).toBe(true);
  });

  /**
   * Two lists sharing a key would share a choice, so the key has to actually
   * separate them — asserted rather than assumed from the string being passed.
   */
  it("keeps each list's choice to itself", () => {
    const widgets = renderHook(() =>
      useListColumns({ storageKey: "widgets", columns: COLUMNS })
    );
    act(() => widgets.result.current.onToggleColumn("email"));

    const gadgets = renderHook(() =>
      useListColumns({ storageKey: "gadgets", columns: COLUMNS })
    );
    expect(gadgets.result.current.isColumnVisible("email")).toBe(true);
  });

  /**
   * Reset restores a declared default rather than "everything", so it is only
   * offered when there is a default to restore.
   */
  it("offers reset only when a default was declared", () => {
    const without = renderHook(() =>
      useListColumns({ storageKey: "widgets", columns: COLUMNS })
    );
    expect(without.result.current.onReset).toBeUndefined();

    const withDefault = renderHook(() =>
      useListColumns({
        storageKey: "gadgets",
        columns: COLUMNS,
        defaultVisible: ["name"],
      })
    );
    expect(withDefault.result.current.onReset).toBeTypeOf("function");
  });

  it("restores the declared default on reset", () => {
    const { result } = renderHook(() =>
      useListColumns({
        storageKey: "widgets",
        columns: COLUMNS,
        defaultVisible: ["name"],
      })
    );
    expect(result.current.isColumnVisible("email")).toBe(false);
    act(() => result.current.onToggleColumn("email"));
    expect(result.current.isColumnVisible("email")).toBe(true);

    act(() => result.current.onReset?.());
    expect(result.current.isColumnVisible("email")).toBe(false);
    expect(result.current.isColumnVisible("name")).toBe(true);
  });
});
