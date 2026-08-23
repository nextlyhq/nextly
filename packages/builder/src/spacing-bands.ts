/**
 * Where a node's spacing bands land, as arithmetic over plain numbers.
 *
 * The canvas draws an author's margin and padding as coloured bands with the
 * value written on them. Deciding WHERE each band goes is geometry, and it is
 * kept here — away from the DOM — for the reason `geometry.ts` gives about
 * itself: jsdom lays nothing out and reports every element as zero-sized, so a
 * placement rule written against live elements can only be exercised in a
 * browser. Written against numbers it can be exercised anywhere, and the browser
 * is left to certify the one thing only it can: that the numbers handed in
 * describe the element they claim to.
 *
 * ## Two coordinate spaces meet here, and they are not the same space
 *
 * `border` arrives from `canvasContentRect`, which reads `getBoundingClientRect`
 * — a POST-transform measurement, so a canvas drawn at half size reports half
 * the pixels. The edge lengths arrive from `getComputedStyle`, which reports
 * UNSCALED CSS pixels and knows nothing about a transform above it.
 *
 * `scale` is what reconciles them, and it is required rather than defaulted for
 * that reason. The two spaces coincide exactly while the canvas is drawn at 1:1,
 * which is every case today — so a default would be correct, silently, until the
 * day it was not, and nothing here would fail. A caller has to say which scale
 * its rectangle was measured at, and the label keeps reporting the CSS value the
 * author typed rather than the scaled one they can see.
 *
 * @module spacing-bands
 */

import type { Rect } from "./geometry";

/** The four physical sides, in the order a CSS shorthand writes them. */
export type SpacingSide = "top" | "right" | "bottom" | "left";

/**
 * Which box of the CSS model a band belongs to.
 *
 * Border is measured but never drawn: it is a different catalog group, and the
 * padding box cannot be located without it.
 */
export type SpacingBox = "margin" | "padding";

/** Four physical edge lengths, in unscaled CSS pixels. */
export interface EdgeLengths {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** One band to draw, with the text that goes on it. */
export interface SpacingBand {
  readonly box: SpacingBox;
  readonly side: SpacingSide;
  /** In the same space as the `border` rectangle it was derived from. */
  readonly rect: Rect;
  /** The CSS-pixel value, unscaled, as the author would recognise it. */
  readonly label: string;
  /**
   * A margin that pulls the element toward the side rather than away from it.
   *
   * Kept as a flag rather than a negative extent because a rectangle with a
   * negative height draws nothing: the band is laid out INSIDE the border edge
   * instead, which is where the margin box genuinely is, and the caller styles
   * it differently so it cannot be mistaken for padding.
   */
  readonly negative: boolean;
}

/** Everything the placement needs, and nothing that has to be read from a DOM. */
export interface SpacingGeometry {
  /** The node's border box, in canvas content coordinates. */
  readonly border: Rect;
  /** Border widths, needed because padding is measured from the padding box. */
  readonly borderWidths: EdgeLengths;
  readonly margin: EdgeLengths;
  readonly padding: EdgeLengths;
  /** The scale `border` was measured at; `1` while the canvas is drawn 1:1. */
  readonly scale: number;
}

const SIDES: readonly SpacingSide[] = ["top", "right", "bottom", "left"];

/**
 * The value as the author would write it, to two decimals.
 *
 * A computed length is frequently fractional — a percentage, a `rem` against a
 * non-integer root, a flex remainder — and the full expansion is noise on a
 * band a few pixels tall. `String` drops the trailing zeros that `toFixed`
 * keeps, so a whole number reads as `16` rather than `16.00`, and it renders
 * negative zero as `0`.
 */
function labelFor(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Whether a side has anything to report, decided FROM the label.
 *
 * A band drawn beside the text `0` is worse than no band: eight of them appear
 * on every selection and train the author to stop reading the overlay. Asking
 * the label rather than the raw value keeps the two answers from disagreeing —
 * a length of `0.001` rounds to `0`, and the version that tests the raw value
 * draws a band that says nothing.
 */
function reports(label: string): boolean {
  return label !== "0";
}

/**
 * The bands for one node, in paint order.
 *
 * Margin first so padding paints over it. The two only overlap where a margin
 * is negative — that band lies inside the border edge, across the same pixels
 * padding occupies — and there the padding is the more useful of the two.
 */
export function spacingBands(
  geometry: SpacingGeometry
): readonly SpacingBand[] {
  const { border, scale } = geometry;
  const scaled = (value: number): number => value * scale;

  const bands: SpacingBand[] = [];

  for (const side of SIDES) {
    const value = geometry.margin[side];
    const label = labelFor(value);
    if (!reports(label)) continue;
    bands.push({
      box: "margin",
      side,
      rect: marginRect(border, side, scaled(value)),
      label,
      negative: value < 0,
    });
  }

  /*
   * Padding is measured from the padding box, which is the border box inset by
   * the border. Insetting by nothing is the common case and the general form
   * costs the same, so there is no branch for it — a block that does carry a
   * border would otherwise draw every padding band offset by its width.
   */
  const inner = inset(border, {
    top: scaled(geometry.borderWidths.top),
    right: scaled(geometry.borderWidths.right),
    bottom: scaled(geometry.borderWidths.bottom),
    left: scaled(geometry.borderWidths.left),
  });

  for (const side of SIDES) {
    const value = geometry.padding[side];
    const label = labelFor(value);
    if (!reports(label)) continue;
    bands.push({
      box: "padding",
      side,
      rect: paddingRect(inner, side, {
        top: scaled(geometry.padding.top),
        right: scaled(geometry.padding.right),
        bottom: scaled(geometry.padding.bottom),
        left: scaled(geometry.padding.left),
      }),
      label,
      negative: false,
    });
  }

  return bands;
}

/** A rectangle reduced on each side, never past zero in either dimension. */
function inset(rect: Rect, by: EdgeLengths): Rect {
  return {
    x: rect.x + by.left,
    y: rect.y + by.top,
    width: Math.max(0, rect.width - by.left - by.right),
    height: Math.max(0, rect.height - by.top - by.bottom),
  };
}

/**
 * Where one margin band sits relative to the border box.
 *
 * A positive margin lies OUTSIDE the border edge, which is the case the box
 * model makes obvious. A negative one lies inside it: the margin box is smaller
 * than the border box on that side, because that is what pulling an element
 * toward its neighbour means. Drawing a negative margin outward would put the
 * band exactly where the space it removes is not.
 *
 * Top and bottom span the full width and left and right span the full height,
 * so the four meet at the corners rather than leaving them blank. The overlap
 * that produces is a corner drawn twice at the same colour, which is invisible.
 */
function marginRect(border: Rect, side: SpacingSide, value: number): Rect {
  const extent = Math.abs(value);
  const outward = value >= 0;
  switch (side) {
    case "top":
      return {
        x: border.x,
        y: outward ? border.y - extent : border.y,
        width: border.width,
        height: extent,
      };
    case "bottom":
      return {
        x: border.x,
        y: outward
          ? border.y + border.height
          : border.y + border.height - extent,
        width: border.width,
        height: extent,
      };
    case "left":
      return {
        x: outward ? border.x - extent : border.x,
        y: border.y,
        width: extent,
        height: border.height,
      };
    case "right":
      return {
        x: outward ? border.x + border.width : border.x + border.width - extent,
        y: border.y,
        width: extent,
        height: border.height,
      };
  }
}

/**
 * Where one padding band sits inside the padding box.
 *
 * Top and bottom take the full width; left and right take what is left between
 * them. The alternative — all four spanning fully — draws the corners twice,
 * and padding bands are translucent, so a doubled corner reads as a heavier
 * colour that means nothing.
 *
 * Clamped at zero because padding can exceed the box it is measured in: a
 * fixed-height element with more padding than height is legal, and the
 * remainder between top and bottom is then negative.
 */
function paddingRect(inner: Rect, side: SpacingSide, by: EdgeLengths): Rect {
  const middle = Math.max(0, inner.height - by.top - by.bottom);
  switch (side) {
    case "top":
      return { x: inner.x, y: inner.y, width: inner.width, height: by.top };
    case "bottom":
      return {
        x: inner.x,
        y: inner.y + inner.height - by.bottom,
        width: inner.width,
        height: by.bottom,
      };
    case "left":
      return {
        x: inner.x,
        y: inner.y + by.top,
        width: by.left,
        height: middle,
      };
    case "right":
      return {
        x: inner.x + inner.width - by.right,
        y: inner.y + by.top,
        width: by.right,
        height: middle,
      };
  }
}
