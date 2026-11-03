/**
 * The sentence a removal stopped by pages is told: the pages the remover may
 * read by title, the rest counted, and "at least" when the scan stopped short.
 *
 * @module layout-removal/words.test
 */
import { describe, expect, it } from "vitest";

import {
  LAYOUT_EDIT_DURING_REMOVAL,
  pageLayoutRefusal,
  pagesUseItRefusal,
} from "./words";

describe("the refusal when pages use the Layout", () => {
  it("names the readable pages and counts the rest", () => {
    expect(
      pagesUseItRefusal({
        titles: ["Home", "About"],
        unreadable: 1,
        complete: true,
      })
    ).toBe(
      '3 pages use this Layout: "Home", "About" and 1 you can\'t view. Choose another Layout for them first.'
    );
  });

  it("reads as one page when there is one", () => {
    expect(
      pagesUseItRefusal({ titles: ["Home"], unreadable: 0, complete: true })
    ).toBe(
      '1 page uses this Layout: "Home". Choose another Layout for it first.'
    );
  });

  it("says 'at least' when the scan did not reach every page", () => {
    // The count found so far is a floor, not the total: pages past the budget
    // were never read.
    expect(
      pagesUseItRefusal({ titles: ["Home"], unreadable: 1, complete: false })
    ).toContain("At least 2 pages use this Layout");
  });

  it("refuses an unfinished scan that found nothing, rather than reading it as none", () => {
    const told = pagesUseItRefusal({
      titles: [],
      unreadable: 0,
      complete: false,
    });
    expect(told).toContain("more pages than one removal can check");
    expect(told).toContain("can't be removed yet");
  });
});

describe("what a write meeting the fence is told", () => {
  it("tells a Layout edit during a removal to try again shortly", () => {
    expect(LAYOUT_EDIT_DURING_REMOVAL).toBe(
      "This Layout is being removed. Try again in a moment."
    );
  });

  it("tells a page choosing a Layout being removed to choose another", () => {
    expect(pageLayoutRefusal("removing")).toBe(
      "This Layout is being removed, so pages can't choose it. Choose another Layout."
    );
  });

  it("tells a page choosing a Layout Remove Layout unpublished when it can again", () => {
    expect(pageLayoutRefusal("unpublished")).toBe(
      "This Layout was unpublished with Remove Layout, so pages can't choose it until it is published again. Choose another Layout."
    );
  });

  it("tells a page choosing a deleted Layout to choose another", () => {
    expect(pageLayoutRefusal("deleted")).toBe(
      "This Layout was deleted, so pages can't choose it. Choose another Layout."
    );
  });
});
