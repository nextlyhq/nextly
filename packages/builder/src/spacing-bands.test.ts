import { describe, expect, it } from "vitest";

import { SQUARE_CORNERS } from "./border-radii";
import type { Rect } from "./geometry";
import {
  overlayEscape,
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
    // Equal to `scale` unless a case says otherwise, which is what an element
    // carrying no transform of its own reports.
    marginScale: over.scale ?? { x: 1, y: 1 },
    // Square unless a case says otherwise, which is what a block with no
    // `border-radius` reports and what nearly every block on a page is.
    radii: SQUARE_CORNERS,
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

  it("fills the outer CORNERS when two adjacent margins are set", () => {
    /*
     * Two adjacent margins leave a rectangle diagonally outside the border box
     * that belongs to the margin area. Spanning only the border box paints
     * nothing there, so the highlighted region is smaller than the margin box
     * and the overlay under-reports the space it exists to show.
     *
     * The horizontal bands take it: top and bottom span the whole margin box
     * while left and right span the border height, so each corner is assigned
     * exactly once and no translucent band is drawn over another.
     */
    const bands = bandsFor({
      margin: { top: 20, right: 8, bottom: 0, left: 12 },
    });
    expect(band(bands, "margin", "top")?.rect).toEqual({
      x: 88, // border.x - left margin
      y: 180,
      width: 320, // border.width + left + right
      height: 20,
    });
    // The vertical band is unchanged, which is what keeps the corner single.
    expect(band(bands, "margin", "left")?.rect).toEqual({
      x: 88,
      y: 200,
      width: 12,
      height: 150,
    });
  });

  it("does not widen a band for a NEGATIVE neighbour", () => {
    // A negative margin makes the margin box SMALLER on that side, so there is
    // no corner out there to fill and extending toward it would paint outside
    // the margin area entirely.
    const bands = bandsFor({
      margin: { top: 20, right: 0, bottom: 0, left: -12 },
    });
    expect(band(bands, "margin", "top")?.rect).toEqual({
      x: 100,
      y: 180,
      width: 300,
      height: 20,
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

  it("stops a negative margin LARGER than the block at the opposite edge", () => {
    /*
     * A negative margin has no bound in CSS and pulling an element further than
     * its own size is the usual way an overlap is authored. Drawn unbounded,
     * `-400` on a 150-tall block runs 250 pixels past the bottom edge and
     * colours a neighbour's pixels as this block's margin.
     *
     * The existing fixtures above are all smaller than the border box, so they
     * do not separate a clamped implementation from an unbounded one.
     */
    const bands = bandsFor({ margin: { ...NONE, top: -400 } });
    expect(band(bands, "margin", "top")?.rect).toEqual({
      x: 100,
      y: 200,
      width: 300,
      height: 150,
    });
  });

  it("reports the AUTHORED value on a band it had to clamp", () => {
    // The bound moves the band, never the number. An author who wrote `-400`
    // and reads `-150` off the canvas would go looking for a value that is not
    // in the document.
    const bands = bandsFor({ margin: { ...NONE, top: -400 } });
    expect(band(bands, "margin", "top")?.label).toBe("-400");
  });

  it.each<[SpacingSide, Rect]>([
    ["bottom", { x: 100, y: 200, width: 300, height: 150 }],
    ["left", { x: 100, y: 200, width: 300, height: 150 }],
    ["right", { x: 100, y: 200, width: 300, height: 150 }],
  ])("stops an oversized negative %s margin too", (side, expected) => {
    // Each side clamps against the dimension it runs along: top and bottom
    // against the height, left and right against the width. A single clamp
    // written against one dimension is wrong on the other axis, and this block
    // is deliberately not square.
    const bands = bandsFor({ margin: { ...NONE, [side]: -400 } });
    expect(band(bands, "margin", side)?.rect).toEqual(expected);
  });

  it("shares the block between two negative sides that both overrun", () => {
    /*
     * Clamping each side to the border dimension ON ITS OWN still lets a pair
     * overlap: `-200` and `-100` on a 150-tall block would each be cut to 150
     * and cover the whole block twice. The fills are translucent, so the
     * contested strip darkens and reads as a third value nobody wrote.
     *
     * Shared in proportion, the larger margin keeps the larger band — 200:100
     * of 150 is 100 and 50 — and they meet at a single boundary.
     */
    const bands = bandsFor({
      margin: { ...NONE, top: -200, bottom: -100 },
    });
    const top = band(bands, "margin", "top")?.rect;
    const bottom = band(bands, "margin", "bottom")?.rect;
    expect(top).toEqual({ x: 100, y: 200, width: 300, height: 100 });
    expect(bottom).toEqual({ x: 100, y: 300, width: 300, height: 50 });
    // Meeting exactly: no gap and no overlap.
    expect((top?.y ?? 0) + (top?.height ?? 0)).toBe(bottom?.y);
  });

  it("steps an INWARD side band past the inward bands above and below it", () => {
    /*
     * The mirror of the outward rule. Outward, the top and bottom bands span the
     * margin box's full width and the side bands stop at the border height, so
     * each corner is painted exactly once. Inward, the horizontal bands lie
     * inside the border box, so a side band spanning the full height would cross
     * them and darken the corner.
     */
    const bands = bandsFor({
      margin: { ...NONE, top: -40, left: -30 },
    });
    expect(band(bands, "margin", "top")?.rect).toEqual({
      x: 100,
      y: 200,
      width: 300,
      height: 40,
    });
    expect(band(bands, "margin", "left")?.rect).toEqual({
      x: 100,
      y: 240,
      width: 30,
      height: 110,
    });
  });

  it("does NOT shorten an outward side band for an inward neighbour", () => {
    // An outward side band sits beyond the border edge, where no inward band
    // reaches — insetting it there would leave a strip of the margin area
    // painted by nothing.
    const bands = bandsFor({ margin: { ...NONE, top: -40, left: 20 } });
    expect(band(bands, "margin", "left")?.rect).toEqual({
      x: 80,
      y: 200,
      width: 20,
      height: 150,
    });
  });
});

describe("which scale each box is drawn at", () => {
  it("scales a MARGIN by the ancestors alone, not by the element's own transform", () => {
    /*
     * The separating case, and it needs the two scales to DIFFER — with one
     * scale for both boxes every assertion here passes on either implementation.
     *
     * A transform does not scale the space a margin reserves. Measured, a 100px
     * block with `margin-top: 28px` under a transform pinning its top edge
     * leaves a real gap of 28 rendered pixels while the composed scale would
     * draw the band 14 high, naming the space beside it wrongly by half.
     */
    const bands = bandsFor({
      margin: { ...NONE, top: 28 },
      scale: { x: 1, y: 0.5 },
      marginScale: { x: 1, y: 1 },
    });

    expect(band(bands, "margin", "top")?.rect.height).toBe(28);
  });

  it("scales PADDING by the composed scale, which includes the element's own", () => {
    // The mirror, and the reason this is not simply "stop scaling". Padding
    // lies INSIDE the transform and renders scaled with the box, so the same
    // fixture must halve the padding while leaving the margin whole.
    const bands = bandsFor({
      padding: { ...NONE, top: 28 },
      scale: { x: 1, y: 0.5 },
      marginScale: { x: 1, y: 1 },
    });

    expect(band(bands, "padding", "top")?.rect.height).toBe(14);
  });

  it("labels both with the AUTHORED value, whichever scale drew them", () => {
    // The number is what the author typed, and neither scale is allowed to
    // reach it — a band reading `14` names a value in no document.
    const bands = bandsFor({
      margin: { ...NONE, top: 28 },
      padding: { ...NONE, top: 28 },
      scale: { x: 1, y: 0.5 },
      marginScale: { x: 1, y: 1 },
    });

    expect(band(bands, "margin", "top")?.label).toBe("28");
    expect(band(bands, "padding", "top")?.label).toBe("28");
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
  const ALL = { top: true, right: true, bottom: true, left: true };
  const NONE = { top: false, right: false, bottom: false, left: false };

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
    expect(spacingApplies(display, "horizontal-tb", false)).toEqual({
      margin: NONE,
      padding: NONE,
    });
  });

  it("gives table-cell padding but not margin", () => {
    // The one internal table box padding applies to, and the common case an
    // author actually sets. Collapsing it into the group above would blank the
    // padding of every table cell on the page.
    expect(spacingApplies("table-cell", "horizontal-tb", false)).toEqual({
      margin: NONE,
      padding: ALL,
    });
  });

  it.each(["block", "flex", "grid", "inline-block", "table", "table-caption"])(
    "gives %s every side of both",
    display => {
      // `table-caption` is here deliberately: it is NOT an internal table box,
      // and its margins apply normally.
      expect(spacingApplies(display, "horizontal-tb", false)).toEqual({
        margin: ALL,
        padding: ALL,
      });
    }
  );

  it("drops a NON-REPLACED inline box's block-axis margins and keeps the inline ones", () => {
    /*
     * A non-replaced inline box ignores its block-axis margins entirely while
     * `getComputedStyle` reports whatever was declared, so a blanket answer
     * draws bands for space the box does not create. Its padding is left alone:
     * block-axis padding on an inline box does not affect layout but DOES
     * render, and this overlay reports what renders.
     */
    expect(spacingApplies("inline", "horizontal-tb", false)).toEqual({
      margin: { top: false, bottom: false, left: true, right: true },
      padding: ALL,
    });
  });

  it.each(["vertical-rl", "vertical-lr", "sideways-rl"])(
    "follows the writing mode: %s puts the block axis sideways",
    writingMode => {
      // Which PHYSICAL sides the block axis lands on is a function of the
      // writing mode, so a physical answer hard-coded to `horizontal-tb` is
      // wrong on exactly the documents that need it most.
      expect(spacingApplies("inline", writingMode, false).margin).toEqual({
        top: true,
        bottom: true,
        left: false,
        right: false,
      });
    }
  );

  it("keeps a REPLACED inline box's block-axis margins", () => {
    /*
     * The captionless `core/image` case, which is the ordinary way an image is
     * placed: the block's root is a bare `<img>` whose computed display is
     * `inline`. A replaced box is sized by its own content, and the line box has
     * to make room for its block-axis margins — measured in Chromium, fifty
     * pixels above and below an inline `<img>` moves the following content by a
     * hundred, where the same declaration on a `<span>` moves it by nothing.
     *
     * Compared against the non-replaced answer rather than asserted alone, so
     * the pair is what separates them: an implementation that ignored
     * `replaced` would satisfy either expectation on its own.
     */
    const replaced = spacingApplies("inline", "horizontal-tb", true);
    const plain = spacingApplies("inline", "horizontal-tb", false);
    expect(replaced.margin).toEqual(ALL);
    expect(plain.margin).not.toEqual(ALL);
    expect(replaced.padding).toEqual(ALL);
  });

  it.each(["inline list-item", "ruby"])(
    "treats the non-atomic inline %s the same as a bare inline",
    display => {
      /*
       * `display` is a two-part value and the catalog ships the multi-keyword
       * forms, so matching `"inline"` exactly is not enough. `inline list-item`
       * is authorable eight ways — every ordering computes to this one string —
       * and `ruby` is inline-level without the word appearing in it at all.
       *
       * Measured across the catalog's whole display list: these two move the
       * content after them by nothing when given fifty pixels of margin above
       * and below, exactly as a bare `inline` does.
       */
      expect(spacingApplies(display, "horizontal-tb", false).margin).toEqual({
        top: false,
        bottom: false,
        left: true,
        right: true,
      });
    }
  );

  it.each([
    "inline flow-root list-item",
    "inline-block",
    "inline-flex",
    "inline-table",
    "block ruby",
  ])("gives the ATOMIC inline-level %s every side", display => {
    /*
     * The separating set. Each of these is inline-LEVEL, and each of them takes
     * its block-axis margins, so the question is not whether a box is inline
     * but whether it is ATOMIC. A rule written as "starts with inline" or
     * "contains inline" answers the tests above correctly and blanks all of
     * these — `inline flow-root list-item` in particular differs from
     * `inline list-item` by one keyword and goes the other way.
     */
    expect(spacingApplies(display, "horizontal-tb", false).margin).toEqual(ALL);
  });

  it("still gives a replaced box in a MARGINLESS display no margins", () => {
    // Replaced-ness answers the inline question only. An author who sets
    // `display: table-row` on an image gets a box CSS applies no margin to, and
    // the replaced exception must not reach past the branch it belongs to.
    expect(spacingApplies("table-row", "horizontal-tb", true)).toEqual({
      margin: NONE,
      padding: NONE,
    });
  });
});

describe("how far the overlay must be allowed to paint outside itself", () => {
  const LAYER = { width: 1000, height: 800 };
  const CHIP = 24;
  const at = (rect: Rect): SpacingBand => ({
    box: "margin",
    side: "top",
    rect,
    label: "40",
    negative: false,
  });

  it("allows the chip alone when nothing escapes", () => {
    // A band wholly inside still needs room: the chip is CENTRED on it and
    // deliberately unclipped, so a band flush with an edge overflows by its own
    // half-height even when the band escapes by nothing.
    const bands = [at({ x: 10, y: 10, width: 100, height: 20 })];
    expect(overlayEscape(bands, LAYER, CHIP)).toBe(CHIP);
  });

  it("measures a band that escapes ABOVE the layer", () => {
    /*
     * The collapsed-margin case: the first block's top margin escapes the canvas
     * entirely, so its band is placed at a negative offset. A fixed allowance is
     * what this replaces — `2rem` clipped an ordinary 64px spacing step.
     */
    const bands = [at({ x: 0, y: -64, width: 1000, height: 64 })];
    expect(overlayEscape(bands, LAYER, CHIP)).toBe(64 + CHIP);
  });

  it.each<[string, Rect, number]>([
    ["left", { x: -30, y: 10, width: 30, height: 50 }, 30],
    ["right", { x: 980, y: 10, width: 60, height: 50 }, 40],
    ["below", { x: 0, y: 780, width: 100, height: 45 }, 25],
  ])("measures a band escaping to the %s", (_side, rect, expected) => {
    expect(overlayEscape([at(rect)], LAYER, CHIP)).toBe(expected + CHIP);
  });

  it("takes the LARGEST escape across every band", () => {
    // One allowance covers all four sides, so the widest escape decides it. A
    // per-band answer would clip whichever band was not asked about.
    const bands = [
      at({ x: 0, y: -10, width: 100, height: 10 }),
      at({ x: 0, y: -90, width: 100, height: 90 }),
      at({ x: 0, y: 10, width: 100, height: 10 }),
    ];
    expect(overlayEscape(bands, LAYER, CHIP)).toBe(90 + CHIP);
  });

  it("never returns a negative allowance", () => {
    expect(overlayEscape([], LAYER, CHIP)).toBe(CHIP);
  });
});
