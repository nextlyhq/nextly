/**
 * The one size vocabulary: `{ w, h }` on twelve columns, and the bounds a
 * widget's declaration puts on it. Every reader of a size goes through these
 * rules, so each is pinned here once.
 */
import { describe, expect, it } from "vitest";

import {
  clampSize,
  GRID_COLUMNS,
  isGridSize,
  MAX_GRID_ROWS,
  narrowedSizeBounds,
  sizeBounds,
  sizeDeclarationProblems,
  sizeWithinBounds,
} from "../grid-size";

describe("a grid size", () => {
  it("is whole numbers, w from 1 to 12 and h from 2 to 12", () => {
    expect(isGridSize({ w: 1, h: 2 })).toBe(true);
    expect(isGridSize({ w: GRID_COLUMNS, h: 9 })).toBe(true);
    expect(isGridSize({ w: 6, h: MAX_GRID_ROWS })).toBe(true);
    for (const size of [
      { w: 0, h: 2 },
      { w: 13, h: 2 },
      { w: 6, h: 0 },
      // 🔴 One row cannot hold the frame.
      { w: 6, h: 1 },
      // 🔴 Nor past twelve, the most rows a card may span.
      { w: 6, h: 13 },
      { w: 6, h: 1e9 },
      { w: 6.5, h: 2 },
      { w: 6, h: 2.5 },
      { w: "6", h: 2 },
      { w: 6 },
      null,
      "half",
    ]) {
      expect(isGridSize(size), JSON.stringify(size)).toBe(false);
    }
  });
});

describe("a widget's size bounds", () => {
  it("default the minimum to the default and the maximum to the full width at the default's height", () => {
    expect(sizeBounds({ default: { w: 6, h: 3 } })).toEqual({
      default: { w: 6, h: 3 },
      min: { w: 6, h: 3 },
      max: { w: 12, h: 3 },
    });
    expect(
      sizeBounds({
        default: { w: 6, h: 3 },
        min: { w: 3, h: 2 },
        max: { w: 8, h: 6 },
      })
    ).toEqual({
      default: { w: 6, h: 3 },
      min: { w: 3, h: 2 },
      max: { w: 8, h: 6 },
    });
  });

  it("accept a usable declaration, and name each problem with one", () => {
    expect(sizeDeclarationProblems({ default: { w: 6, h: 3 } })).toEqual([]);
    expect(
      sizeDeclarationProblems({
        default: { w: 6, h: 3 },
        min: { w: 3, h: 2 },
        max: { w: 12, h: 6 },
      })
    ).toEqual([]);
    expect(sizeDeclarationProblems(undefined)).toEqual([
      "size must be { default: { w, h }, min?, max? }",
    ]);
    expect(sizeDeclarationProblems({ default: { w: 13, h: 3 } })).toEqual([
      "size.default.w must be a whole number from 1 to 12, got 13",
    ]);
    expect(
      sizeDeclarationProblems({ default: { w: 6, h: 3 }, max: { w: 6, h: 1 } })
    ).toEqual(["size.max.h must be a whole number from 2 to 12, got 1"]);
    // A maximum past twelve rows is refused at startup, as one below two is.
    expect(
      sizeDeclarationProblems({
        default: { w: 6, h: 3 },
        max: { w: 6, h: 100000 },
      })
    ).toEqual(["size.max.h must be a whole number from 2 to 12, got 100000"]);
    // A named width is no size at all.
    expect(sizeDeclarationProblems({ default: "half" })).toEqual([
      "size.default must be { w, h }",
    ]);
  });

  it("refuse a minimum above the default, and a default above the maximum", () => {
    expect(
      sizeDeclarationProblems({ default: { w: 4, h: 3 }, min: { w: 6, h: 2 } })
    ).toEqual(["size.min must not be larger than size.default"]);
    expect(
      sizeDeclarationProblems({ default: { w: 6, h: 4 }, max: { w: 12, h: 3 } })
    ).toEqual(["size.default must not be larger than size.max"]);
  });
});

describe("a size kept within its bounds", () => {
  const bounds = sizeBounds({
    default: { w: 6, h: 3 },
    min: { w: 4, h: 2 },
    max: { w: 8, h: 5 },
  });

  it("moves each direction only as far as it must", () => {
    expect(clampSize({ w: 6, h: 3 }, bounds)).toEqual({ w: 6, h: 3 });
    expect(clampSize({ w: 12, h: 3 }, bounds)).toEqual({ w: 8, h: 3 });
    expect(clampSize({ w: 2, h: 9 }, bounds)).toEqual({ w: 4, h: 5 });
    expect(sizeWithinBounds({ w: 8, h: 5 }, bounds)).toBe(true);
    expect(sizeWithinBounds({ w: 9, h: 5 }, bounds)).toBe(false);
  });

  it("follows bounds that narrowed after the size was stored", () => {
    const narrower = sizeBounds({
      default: { w: 4, h: 2 },
      max: { w: 4, h: 2 },
    });
    expect(clampSize({ w: 8, h: 5 }, narrower)).toEqual({ w: 4, h: 2 });
  });
});

describe("a site's override of a widget's size", () => {
  const own = sizeBounds({
    default: { w: 6, h: 3 },
    min: { w: 3, h: 2 },
    max: { w: 12, h: 6 },
  });

  it("narrows the bounds, keeping the default inside them", () => {
    expect(narrowedSizeBounds(own, { max: { w: 6, h: 4 } })).toEqual({
      default: { w: 6, h: 3 },
      min: { w: 3, h: 2 },
      max: { w: 6, h: 4 },
    });
    expect(narrowedSizeBounds(own, { min: { w: 8, h: 2 } })).toEqual({
      default: { w: 8, h: 3 },
      min: { w: 8, h: 2 },
      max: { w: 12, h: 6 },
    });
    expect(narrowedSizeBounds(own, { default: { w: 12, h: 4 } })).toEqual({
      ...own,
      default: { w: 12, h: 4 },
    });
  });

  it("never widens them, nor leaves no size between its ends", () => {
    // 🔴 Wider than the widget allows, in either direction.
    expect(narrowedSizeBounds(own, { max: { w: 12, h: 8 } })).toBeUndefined();
    expect(narrowedSizeBounds(own, { min: { w: 2, h: 2 } })).toBeUndefined();
    expect(
      narrowedSizeBounds(own, { default: { w: 2, h: 2 } })
    ).toBeUndefined();
    expect(
      narrowedSizeBounds(own, { min: { w: 8, h: 2 }, max: { w: 6, h: 6 } })
    ).toBeUndefined();
  });
});
