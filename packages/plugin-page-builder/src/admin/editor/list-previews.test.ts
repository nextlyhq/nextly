// @vitest-environment jsdom

/**
 * The lists the canvas previews empty, or tags as still showing: the page's
 * own, and while a header or footer is edited in place, the region's too,
 * since its frame draws in the page's context.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useListPreviews } from "./list-previews";

const PAGE = {
  listsShowingEmpty: new Set(["page-list"]),
  listsStillShowing: new Map([["page-list", "Still showing"]]),
};

describe("the lists the canvas previews", () => {
  it("are the page's own while the page is edited", () => {
    const { result } = renderHook(() => useListPreviews(PAGE, PAGE));

    expect(result.current.listsShowingEmpty).toBe(PAGE.listsShowingEmpty);
    expect(result.current.listsStillShowing).toBe(PAGE.listsStillShowing);
  });

  it("join the header's to the page's while the header is edited", () => {
    const header = {
      listsShowingEmpty: new Set(["header-list"]),
      listsStillShowing: new Map([["header-list", "Header tag"]]),
    };

    const { result, rerender } = renderHook(() =>
      useListPreviews(PAGE, header)
    );

    expect([...(result.current.listsShowingEmpty ?? [])]).toEqual([
      "page-list",
      "header-list",
    ]);
    expect(result.current.listsStillShowing?.get("header-list")).toBe(
      "Header tag"
    );
    expect(result.current.listsStillShowing?.get("page-list")).toBe(
      "Still showing"
    );
    // The same sets again while neither changes, so the canvas does not
    // draw again for nothing.
    const first = result.current;
    rerender();
    expect(result.current.listsShowingEmpty).toBe(first.listsShowingEmpty);
    expect(result.current.listsStillShowing).toBe(first.listsStillShowing);
  });
});
