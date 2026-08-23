import { describe, expect, it } from "vitest";

import type { Rect } from "./geometry";
import {
  sameBands,
  spacingApplies,
  spacingBands,
  type EdgeLengths,
  type SpacingBand,
  type SpacingBox,
  type SpacingGeometry,
  type SpacingSide,
} from "./spacing-bands";

/**
 * A border box away from the origin and not square, so no assertion below can
 * pass by coincidence: an implementation that dropped `x`, swapped an axis or
 * confused width with height would land on the same numbers for a square at
 * `0,0`.
 */
const BORDER: Rect = { x: 100, y: 200, width: 300, height: 150 };

const NONE: EdgeLengths = { top: 0, right: 0, bottom: 0, left: 0 };

function bandsFor(over: Partial<SpacingGeometry>): readonly SpacingBand[] {
  return spacingBands({
    border: BORDER,
    borderWidths: NONE,
    margin: NONE,
    padding: NONE,
    scale: { x: 1, y: 1 },
    ...over,
  });
}

function band(
  bands: readonly SpacingBand[],
  box: SpacingBox,
  side: SpacingSide
): SpacingBand | undefined {
  return bands.find(one => one.box === box && one.side === side);
}

describe("which sides report at all", () => {
  it("draws nothing for a node with no spacing", () => {
    expect(bandsFor({})).toEqual([]);
  });

  it("draws only the sides that carry a value", () => {
    const bands = bandsFor({
      margin: { top: 16, right: 0, bottom: 0, left: 0 },
      padding: { top: 0, right: 0, bottom: 24, left: 0 },
    });
    expect(bands.map(one => `${one.box}-${one.side}`)).toEqual([
      "margin-top",
      "padding-bottom",
    ]);
  });

  it("omits a side whose value rounds away to nothing", () => {
    // The band and the label have to agree. A hair of a pixel reads as `0`, and
    // a band drawn beside that text says nothing while occupying the overlay.
    expect(bandsFor({ margin: { ...NONE, top: 0.001 } })).toEqual([]);
  });

  it("reports a side that rounds to a value, however small", () => {
    const bands = bandsFor({ margin: { ...NONE, top: 0.4 } });
    expect(bands).toHaveLength(1);
    expect(bands[0]?.label).toBe("0.4");
  });
});

describe("the label", () => {
  it.each<[string, number, string]>([
    ["a whole number carries no decimals", 16, "16"],
    ["a fraction is kept", 16.5, "16.5"],
    ["a long fraction is rounded to two places", 15.996, "16"],
    ["a repeating fraction is truncated, not expanded", 33.333333, "33.33"],
    ["a negative keeps its sign", -10, "-10"],
  ])("%s", (_label, value, expected) => {
    const bands = bandsFor({ margin: { ...NONE, top: value } });
    expect(bands[0]?.label).toBe(expected);
  });
});

describe("where a margin band lands", () => {
  it("puts a positive margin OUTSIDE the border edge", () => {
    const bands = bandsFor({ margin: { ...NONE, top: 20 } });
    expect(band(bands, "margin", "top")?.rect).toEqual({
      x: 100,
      y: 180,
      width: 300,
      height: 20,
    });
  });

  it("puts a positive bottom margin below the border box", () => {
    const bands = bandsFor({ margin: { ...NONE, bottom: 24 } });
    expect(band(bands, "margin", "bottom")?.rect).toEqual({
      x: 100,
      y: 350,
      width: 300,
      height: 24,
    });
  });

  it("puts left and right margins beside the border box", () => {
    const bands = bandsFor({ margin: { ...NONE, left: 12, right: 8 } });
    expect(band(bands, "margin", "left")?.rect).toEqual({
      x: 88,
      y: 200,
      width: 12,
      height: 150,
    });
    expect(band(bands, "margin", "right")?.rect).toEqual({
      x: 400,
      y: 200,
      width: 8,
      height: 150,
    });
  });

  it("puts a NEGATIVE margin inside the border edge, not outside it", () => {
    /*
     * The separating property. A negative margin pulls the element toward its
     * neighbour, so the margin box is SMALLER than the border box on that side —
     * and an implementation that only took the absolute value would draw the
     * band in empty space on the far side, naming space that is not there.
     */
    const bands = bandsFor({ margin: { ...NONE, top: -30 } });
    expect(band(bands, "margin", "top")?.rect).toEqual({
      x: 100,
      y: 200,
      width: 300,
      height: 30,
    });
  });

  it("marks a negative margin, and does not mark a positive one", () => {
    expect(bandsFor({ margin: { ...NONE, top: -30 } })[0]?.negative).toBe(true);
    expect(bandsFor({ margin: { ...NONE, top: 30 } })[0]?.negative).toBe(false);
  });

  it("draws a negative bottom margin up from the bottom edge", () => {
    const bands = bandsFor({ margin: { ...NONE, bottom: -40 } });
    expect(band(bands, "margin", "bottom")?.rect).toEqual({
      x: 100,
      y: 310,
      width: 300,
      height: 40,
    });
  });
});

describe("where a padding band lands", () => {
  it("puts padding inside the border box", () => {
    const bands = bandsFor({ padding: { ...NONE, top: 10 } });
    expect(band(bands, "padding", "top")?.rect).toEqual({
      x: 100,
      y: 200,
      width: 300,
      height: 10,
    });
  });

  it("insets padding by the BORDER width", () => {
    /*
     * Padding is measured from the padding box, which is the border box less the
     * border. Without the inset every band on a bordered block is drawn over the
     * border by its width, which is the one case where the overlay is wrong
     * about a block that looks ordinary.
     */
    const bands = bandsFor({
      borderWidths: { top: 4, right: 4, bottom: 4, left: 4 },
      padding: { ...NONE, top: 10 },
    });
    expect(band(bands, "padding", "top")?.rect).toEqual({
      x: 104,
      y: 204,
      width: 292,
      height: 10,
    });
  });

  it("leaves the corners to top and bottom, so no two bands overlap", () => {
    // Top and bottom span the full width; left and right take what is between
    // them. Two translucent bands over one corner read as a heavier colour that
    // means nothing.
    const bands = bandsFor({
      padding: { top: 10, right: 6, bottom: 20, left: 8 },
    });
    expect(band(bands, "padding", "left")?.rect).toEqual({
      x: 100,
      y: 210,
      width: 8,
      height: 120,
    });
    expect(band(bands, "padding", "right")?.rect).toEqual({
      x: 394,
      y: 210,
      width: 6,
      height: 120,
    });
  });

  it("clamps rather than inverting when padding exceeds the box", () => {
    // Legal: a fixed-height element with more padding than height. The remainder
    // between top and bottom is negative, and a rectangle with a negative height
    // draws nothing at all.
    const bands = bandsFor({
      padding: { top: 100, right: 5, bottom: 100, left: 5 },
    });
    expect(band(bands, "padding", "left")?.rect.height).toBe(0);
  });

  it("clamps a single padding extent to the box, not just the remainder", () => {
    /*
     * `box-sizing: border-box` with a fixed height and a larger padding keeps
     * the computed padding and collapses the content, so one side alone can
     * exceed the box. An unclamped band runs past the border edge and is drawn
     * over the neighbouring block — naming another block's space as this one's,
     * which is worse than drawing nothing.
     */
    const bands = bandsFor({ padding: { ...NONE, top: 400 } });
    const top = band(bands, "padding", "top")?.rect;
    expect(top?.height).toBe(150);
    // Still labelled with what the author set, which the clamp must not change.
    expect(band(bands, "padding", "top")?.label).toBe("400");
  });

  it("clamps the padding box when the borders exceed the border box", () => {
    /*
     * A separate clamp from the one above, on the inset rather than on the
     * remainder between two sides. A border box contains its own borders, so a
     * DOM cannot currently produce this — which is exactly why it is asserted
     * here: the function takes plain numbers, and a caller that is not the DOM
     * must get a rectangle rather than an inverted one.
     */
    const bands = bandsFor({
      borderWidths: { top: 100, right: 200, bottom: 100, left: 200 },
      padding: { ...NONE, top: 10 },
    });
    expect(band(bands, "padding", "top")?.rect.width).toBe(0);
  });
});

describe("scale", () => {
  /*
   * The rectangle arrives post-transform and the edge lengths do not, so the
   * scale is what reconciles them. The label must NOT move with it: the author
   * set sixteen pixels, and a canvas drawn at half size has not changed that.
   */
  it("scales a band's extent", () => {
    const bands = bandsFor({
      margin: { ...NONE, top: 20 },
      scale: { x: 0.5, y: 0.5 },
    });
    expect(band(bands, "margin", "top")?.rect).toEqual({
      x: 100,
      y: 190,
      width: 300,
      height: 10,
    });
  });

  it("leaves the LABEL in unscaled CSS pixels", () => {
    const bands = bandsFor({
      margin: { ...NONE, top: 20 },
      scale: { x: 0.5, y: 0.5 },
    });
    expect(band(bands, "margin", "top")?.label).toBe("20");
  });

  it("scales the border inset that positions padding", () => {
    const bands = bandsFor({
      borderWidths: { top: 4, right: 4, bottom: 4, left: 4 },
      padding: { ...NONE, top: 10 },
      scale: { x: 2, y: 2 },
    });
    expect(band(bands, "padding", "top")?.rect).toEqual({
      x: 108,
      y: 208,
      width: 284,
      height: 20,
    });
  });

  it("scales each edge by the axis it runs along", () => {
    /*
     * `transform: scale(2, 0.5)` is one legal value, and a single factor is
     * necessarily wrong on one of the two axes. A vertical margin follows the
     * vertical scale and a horizontal one the horizontal scale.
     */
    const bands = bandsFor({
      margin: { top: 20, right: 20, bottom: 0, left: 0 },
      scale: { x: 2, y: 0.5 },
    });
    expect(band(bands, "margin", "top")?.rect.height).toBe(10);
    expect(band(bands, "margin", "right")?.rect.width).toBe(40);
  });

  it("reports the same LABEL on both axes however they are scaled", () => {
    // The author typed twenty on each side. Nothing about drawing the block at
    // a different size changed what they typed.
    const bands = bandsFor({
      margin: { top: 20, right: 20, bottom: 0, left: 0 },
      scale: { x: 2, y: 0.5 },
    });
    expect(band(bands, "margin", "top")?.label).toBe("20");
    expect(band(bands, "margin", "right")?.label).toBe("20");
  });

  it("is not satisfied by ignoring the argument", () => {
    // The control for the three above, which an implementation that dropped
    // `scale` entirely would pass at 1. At any other scale the extent has to
    // differ from the unscaled one.
    const plain = bandsFor({ margin: { ...NONE, top: 20 } });
    const scaled = bandsFor({
      margin: { ...NONE, top: 20 },
      scale: { x: 0.5, y: 0.5 },
    });
    expect(scaled[0]?.rect.height).not.toBe(plain[0]?.rect.height);
  });
});

describe("paint order", () => {
  it("emits margin before padding", () => {
    /*
     * A negative margin band lies over the same pixels a padding band occupies,
     * and inside the box the padding is the more useful of the two. Emitting
     * margin first is what puts padding on top.
     */
    const bands = bandsFor({
      margin: { ...NONE, top: -30 },
      padding: { ...NONE, top: 10 },
    });
    expect(bands.map(one => one.box)).toEqual(["margin", "padding"]);
  });
});

describe("comparing two band lists", () => {
  const one = (over: Partial<SpacingBand> = {}): SpacingBand => ({
    box: "margin",
    side: "top",
    rect: { x: 1, y: 2, width: 3, height: 4 },
    label: "16",
    negative: false,
    ...over,
  });

  it("says two identical lists are the same", () => {
    expect(sameBands([one()], [one()])).toBe(true);
  });

  it("says an empty list matches an empty list", () => {
    expect(sameBands([], [])).toBe(true);
  });

  it("notices a different length", () => {
    expect(sameBands([one()], [one(), one({ side: "left" })])).toBe(false);
  });

  it.each<[string, Partial<SpacingBand>]>([
    ["the box", { box: "padding" }],
    ["the side", { side: "bottom" }],
    ["the label", { label: "24" }],
    ["the negative flag", { negative: true }],
    ["the rectangle's x", { rect: { x: 9, y: 2, width: 3, height: 4 } }],
    ["the rectangle's y", { rect: { x: 1, y: 9, width: 3, height: 4 } }],
    ["the rectangle's width", { rect: { x: 1, y: 2, width: 9, height: 4 } }],
    ["the rectangle's height", { rect: { x: 1, y: 2, width: 3, height: 9 } }],
  ])("notices a change to %s", (_label, over) => {
    /*
     * Every field, not a subset. A band that MOVED without resizing and a label
     * that changed while the geometry held are both real changes an author has
     * to see, and a comparison skipping either would freeze the overlay in
     * exactly the case it exists to report.
     */
    expect(sameBands([one()], [one(over)])).toBe(false);
  });
});

describe("which spacing a generated box can have", () => {
  it.each([
    "table-row-group",
    "table-header-group",
    "table-footer-group",
    "table-row",
    "table-column-group",
    "table-column",
    "ruby-base",
    "ruby-text",
    "ruby-base-container",
    "ruby-text-container",
  ])("gives %s neither margin nor padding", display => {
    /*
     * CSS applies neither to an internal table or ruby box, but
     * `getComputedStyle` still answers with whatever the author declared — so
     * reading it unconditionally draws bands for space that does not exist and
     * cannot be made to exist by changing the value.
     */
    expect(spacingApplies(display)).toEqual({ margin: false, padding: false });
  });

  it("gives table-cell padding but not margin", () => {
    // The one internal table box padding applies to, and the common case an
    // author actually sets. Collapsing it into the group above would blank the
    // padding of every table cell on the page.
    expect(spacingApplies("table-cell")).toEqual({
      margin: false,
      padding: true,
    });
  });

  it.each(["block", "flex", "grid", "inline-block", "table", "table-caption"])(
    "gives %s both",
    display => {
      // `table-caption` is here deliberately: it is NOT an internal table box,
      // and its margins apply normally.
      expect(spacingApplies(display)).toEqual({ margin: true, padding: true });
    }
  );
});
