// @vitest-environment jsdom
/**
 * The properties under test are the three decisions every admin list surface
 * encoded by hand until this hook: some columns are pinned and never offered to
 * the toggle; the reader's choice is stored per list; and a column is hidden
 * when the control says it is not visible. A fourth property guards the shape
 * of the return value itself: the arrays must be referentially stable when
 * nothing changed, or every consuming list re-renders on each parent render.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useTableColumns } from "../useTableColumns";

const ALL_COLUMNS = [
  { name: "name", header: "Name" },
  { name: "email", header: "Email" },
  { name: "created", header: "Created" },
];
/** Mirrors the module-level `ALWAYS_VISIBLE` sets the call sites declare. */
const PINS = new Set(["name"]);

/**
 * Seeds a stored choice in which the reader hid EVERY toggleable column —
 * the strongest thing storage can say, and therefore the case that decides
 * whether a pin is honoured "whatever the stored choice says". The shape and
 * key format are the storage layer's own (`nextly-column-visibility-<key>`,
 * `{ columns, defaultsHash }`), with the hash the layer computes from the
 * toggleable names, so the choice survives the layer's staleness check.
 */
function seedHideAll(storageKey: string, toggleableNames: string[]): void {
  localStorage.setItem(
    `nextly-column-visibility-${storageKey}`,
    JSON.stringify({
      columns: [],
      defaultsHash: [...toggleableNames].sort().join(","),
    })
  );
}

beforeEach(() => localStorage.clear());

describe("useTableColumns", () => {
  it("shows every column to a reader who has never chosen", () => {
    const { result } = renderHook(() =>
      useTableColumns({
        storageKey: "widgets",
        columns: ALL_COLUMNS,
        alwaysVisible: PINS,
      })
    );
    for (const column of result.current.columns) {
      expect(column.hidden).toBeFalsy();
    }
  });

  it("offers only the toggleable columns to the control", () => {
    const { result } = renderHook(() =>
      useTableColumns({
        storageKey: "widgets",
        columns: ALL_COLUMNS,
        alwaysVisible: PINS,
      })
    );
    expect(
      result.current.columnsControl.columns.map(column => column.name)
    ).toEqual(["email", "created"]);
  });

  /**
   * A pinned column is never offered and never hidden. The pin exists because
   * a reader must not be able to hide the one cell that says which row this
   * is — so the property has to hold against the most hostile thing storage
   * can contain, not just the happy path: a stored choice that hides
   * everything else must still leave the pin standing.
   */
  it("never reports a pinned column hidden, whatever the stored choice says", () => {
    seedHideAll("widgets", ["email", "created"]);
    const { result } = renderHook(() =>
      useTableColumns({
        storageKey: "widgets",
        columns: ALL_COLUMNS,
        alwaysVisible: PINS,
      })
    );
    const byName = new Map(
      result.current.columns.map(column => [column.name, column])
    );
    expect(byName.get("name")?.hidden).toBeFalsy();
    expect(byName.get("email")?.hidden).toBe(true);
    expect(byName.get("created")?.hidden).toBe(true);
  });

  it("hides a toggleable column when the reader toggles it", () => {
    const { result } = renderHook(() =>
      useTableColumns({
        storageKey: "widgets",
        columns: ALL_COLUMNS,
        alwaysVisible: PINS,
      })
    );
    act(() => result.current.columnsControl.onToggleColumn("email"));
    const byName = new Map(
      result.current.columns.map(column => [column.name, column])
    );
    expect(byName.get("email")?.hidden).toBe(true);
    expect(byName.get("name")?.hidden).toBeFalsy();
  });

  /** A fresh mount is what a reload is: this is the persistence property. */
  it("remembers the choice across a remount", () => {
    const first = renderHook(() =>
      useTableColumns({
        storageKey: "widgets",
        columns: ALL_COLUMNS,
        alwaysVisible: PINS,
      })
    );
    act(() => first.result.current.columnsControl.onToggleColumn("email"));
    first.unmount();

    const second = renderHook(() =>
      useTableColumns({
        storageKey: "widgets",
        columns: ALL_COLUMNS,
        alwaysVisible: PINS,
      })
    );
    const byName = new Map(
      second.result.current.columns.map(column => [column.name, column])
    );
    expect(byName.get("email")?.hidden).toBe(true);
    expect(byName.get("name")?.hidden).toBeFalsy();
  });

  /**
   * Two lists sharing one key would share a choice, so the key has to actually
   * separate them — asserted rather than assumed from the string being passed.
   */
  it("keeps each list's choice to itself", () => {
    const widgets = renderHook(() =>
      useTableColumns({
        storageKey: "widgets",
        columns: ALL_COLUMNS,
        alwaysVisible: PINS,
      })
    );
    act(() => widgets.result.current.columnsControl.onToggleColumn("email"));

    const gadgets = renderHook(() =>
      useTableColumns({
        storageKey: "gadgets",
        columns: ALL_COLUMNS,
        alwaysVisible: PINS,
      })
    );
    const byName = new Map(
      gadgets.result.current.columns.map(column => [column.name, column])
    );
    expect(byName.get("email")?.hidden).toBeFalsy();
  });

  /**
   * The render-loop guard. Every consuming list passes the returned array to a
   * table keyed on identity, so an array rebuilt per render re-renders the
   * whole list on every parent render for nothing.
   */
  it("returns the same columns array when nothing changed", () => {
    const { result, rerender } = renderHook(() =>
      useTableColumns({
        storageKey: "widgets",
        columns: ALL_COLUMNS,
        alwaysVisible: PINS,
      })
    );
    const first = result.current.columns;
    rerender();
    expect(result.current.columns).toBe(first);
  });

  /**
   * Same guard, one level deeper: a caller that rebuilds its pinned set per
   * render (the shape the image-sizes surface carried before migrating here)
   * must not lose the stable array — identity follows meaning, the way the
   * hook underneath treats its own array arguments.
   */
  it("keeps the array stable when the pinned set is rebuilt by the caller", () => {
    const { result, rerender } = renderHook(() =>
      useTableColumns({
        storageKey: "widgets",
        columns: ALL_COLUMNS,
        alwaysVisible: new Set(["name"]),
      })
    );
    const first = result.current.columns;
    rerender();
    expect(result.current.columns).toBe(first);
  });

  /**
   * A column the control never received is not a column it hides. The control
   * is handed only the toggleable set, so any other name must answer visible —
   * the boundary rule inherited from the hook underneath, which the ten call
   * sites relied on without being able to see.
   */
  it("reports a column the control never received as visible", () => {
    const { result } = renderHook(() =>
      useTableColumns({
        storageKey: "widgets",
        columns: ALL_COLUMNS,
        alwaysVisible: PINS,
      })
    );
    expect(result.current.columnsControl.isColumnVisible("roleName")).toBe(
      true
    );
  });
});
