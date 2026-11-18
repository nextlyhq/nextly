// @vitest-environment jsdom

/**
 * The lists the canvas previews empty, or tags as still showing: those of the
 * document being edited. Node ids are each document's own, and a header
 * edited in place draws in the page's context, so while it is edited its own
 * previews are the ones drawn, and the page's return at Done.
 */
import { describe, expect, it } from "vitest";

import { listPreviewsOf } from "./list-previews";

const PAGE = {
  listsShowingEmpty: new Set(["list"]),
  listsStillShowing: new Map([["list", "Still showing"]]),
};

describe("the lists the canvas previews", () => {
  it("are the page's own while the page is edited", () => {
    const result = listPreviewsOf(PAGE);

    expect(result.listsShowingEmpty).toBe(PAGE.listsShowingEmpty);
    expect(result.listsStillShowing).toBe(PAGE.listsStillShowing);
  });

  it("are the header's own while it is edited, whatever the page chose for the same id", () => {
    const header = {
      listsShowingEmpty: new Set<string>(),
      listsStillShowing: new Map([["menu", "Header tag"]]),
    };

    // The page's state stays as it was, its "list" previewed empty.
    expect(PAGE.listsShowingEmpty.has("list")).toBe(true);
    const result = listPreviewsOf(header);

    // The page's "list" previewed empty does not reach the header's own
    // list of the same id, which asked for its entries.
    expect(result.listsShowingEmpty?.has("list")).toBe(false);
    expect(result.listsStillShowing?.get("menu")).toBe("Header tag");
    expect(result.listsStillShowing?.has("list")).toBe(false);
  });
});
