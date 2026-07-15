import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useColumnVisibility } from "../useColumnVisibility";

const SLUG = "posts";
const KEY = `nextly-column-visibility-${SLUG}`;

// The collection query resolves after mount, so the first render sees only the
// built-in columns; the data-driven columns (excerpt/metaTitle) arrive later.
const PRELOAD = [
  "select",
  "title",
  "slug",
  "createdAt",
  "updatedAt",
  "actions",
];
const LOADED = [
  "select",
  "title",
  "slug",
  "createdAt",
  "updatedAt",
  "excerpt",
  "metaTitle",
  "actions",
];

const hash = (cols: string[]) => cols.slice().sort().join(",");

/** A saved preference: the user hid metaTitle from the loaded default set. */
const USER_PREFERENCE = LOADED.filter(c => c !== "metaTitle");

function storeUserPreference() {
  localStorage.setItem(
    KEY,
    JSON.stringify({ columns: USER_PREFERENCE, defaultsHash: hash(LOADED) })
  );
}

function readStored() {
  return JSON.parse(localStorage.getItem(KEY) ?? "null");
}

describe("useColumnVisibility", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps a saved preference when the collection resolves after mount", () => {
    storeUserPreference();

    // First render: query still loading, so only the built-in columns are known.
    const { result, rerender } = renderHook(
      ({ availableColumns, defaultVisible }) =>
        useColumnVisibility({
          collectionSlug: SLUG,
          availableColumns,
          defaultVisible,
        }),
      { initialProps: { availableColumns: PRELOAD, defaultVisible: PRELOAD } }
    );

    // Second render: the collection arrived with its data fields.
    rerender({ availableColumns: LOADED, defaultVisible: LOADED });

    expect(result.current.visibleColumns).toEqual(USER_PREFERENCE);
    expect(result.current.isColumnVisible("excerpt")).toBe(true);
    expect(result.current.isColumnVisible("metaTitle")).toBe(false);
  });

  it("does not overwrite stored columns before the collection resolves", () => {
    storeUserPreference();

    renderHook(() =>
      useColumnVisibility({
        collectionSlug: SLUG,
        availableColumns: PRELOAD,
        defaultVisible: PRELOAD,
      })
    );

    // Mounting while the query is in flight must not clobber the preference.
    expect(readStored().columns).toEqual(USER_PREFERENCE);
    expect(readStored().defaultsHash).toBe(hash(LOADED));
  });

  it("persists a user toggle", () => {
    const { result } = renderHook(() =>
      useColumnVisibility({
        collectionSlug: SLUG,
        availableColumns: LOADED,
        defaultVisible: LOADED,
      })
    );

    act(() => result.current.hideColumn("excerpt"));

    expect(result.current.isColumnVisible("excerpt")).toBe(false);
    expect(readStored().columns).not.toContain("excerpt");
  });

  it("resets to the loaded defaults and persists that", () => {
    storeUserPreference();

    const { result } = renderHook(() =>
      useColumnVisibility({
        collectionSlug: SLUG,
        availableColumns: LOADED,
        defaultVisible: LOADED,
      })
    );

    act(() => result.current.resetToDefault());

    expect(result.current.visibleColumns).toEqual(LOADED);
    expect(readStored().columns).toEqual(LOADED);
  });
});
