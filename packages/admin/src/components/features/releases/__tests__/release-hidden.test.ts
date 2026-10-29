/**
 * How a release says how many of its documents a reader cannot view, and
 * where: by the collection's display name, as the admin names it elsewhere.
 *
 * @module components/features/releases/__tests__/release-hidden.test
 */
import { describe, expect, it } from "vitest";

import {
  describeHidden,
  describeHiddenNeedFix,
  describeUnshown,
  describeUnshownNeedFix,
  hiddenTotal,
} from "../release-hidden";

const NOTES = { singular: "History note", plural: "History notes" };

describe("describeHidden", () => {
  it("names the collection by its plural for several documents", () => {
    expect(
      describeHidden([
        {
          scopeKind: "collection",
          scopeSlug: "history-notes",
          count: 2,
          labels: NOTES,
        },
      ])
    ).toBe("2 documents you can't view · History notes");
  });

  it("names it by its singular for one", () => {
    expect(
      describeHidden([
        {
          scopeKind: "collection",
          scopeSlug: "history-notes",
          count: 1,
          labels: NOTES,
        },
      ])
    ).toBe("1 document you can't view · History note");
  });

  it("falls back to the slug only for a collection with no names", () => {
    expect(
      describeHidden([
        { scopeKind: "collection", scopeSlug: "archived", count: 3 },
      ])
    ).toBe("3 documents you can't view · archived");
  });

  it("counts every collection together, each named once", () => {
    expect(
      describeHidden([
        {
          scopeKind: "collection",
          scopeSlug: "history-notes",
          count: 2,
          labels: NOTES,
        },
        {
          scopeKind: "single",
          scopeSlug: "site",
          count: 1,
          labels: { singular: "Site settings", plural: "Site settings" },
        },
      ])
    ).toBe("3 documents you can't view · History notes, Site settings");
  });

  it("says nothing when nothing is hidden", () => {
    expect(describeHidden([])).toBeNull();
    expect(describeHidden(undefined)).toBeNull();
    expect(hiddenTotal(undefined)).toBe(0);
  });
});

describe("describeHiddenNeedFix", () => {
  it("agrees in number", () => {
    expect(describeHiddenNeedFix(1)).toBe(
      "1 document you can't view needs a fix"
    );
    expect(describeHiddenNeedFix(2)).toBe(
      "2 documents you can't view need a fix"
    );
  });
});

describe("describeUnshown and describeUnshownNeedFix", () => {
  it("say a document is not shown without claiming why, true for a deleted one too", () => {
    expect(describeUnshown(1)).toBe(
      "1 document can't be shown (deleted, or you can't view it)"
    );
    expect(describeUnshown(3)).toBe(
      "3 documents can't be shown (deleted, or you can't view them)"
    );
    expect(describeUnshownNeedFix(1)).toBe(
      "1 document that can't be shown needs a fix"
    );
    expect(describeUnshownNeedFix(2)).toBe(
      "2 documents that can't be shown need a fix"
    );
  });
});
