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
 * — a POST-transform measurement, so an element drawn at half size reports half
 * the pixels. The edge lengths arrive from `getComputedStyle`, which reports
 * UNSCALED CSS pixels and knows nothing about a transform on the element or on
 * anything above it.
 *
 * `scale` is what reconciles them, and it is required rather than defaulted
 * because the mismatch is reachable TODAY: `transform` is a catalog property, so
 * an author can scale a block and every band would otherwise be wrong by exactly
 * that factor with nothing failing. It is per-axis because `scale(2, 0.5)` is
 * one value, and a single factor would be right on one axis and wrong on the
 * other.
 *
 * The LABEL never moves with it. The author typed sixteen pixels; drawing the
 * block at half size did not change what they typed, and a band reading `8`
 * would name a value that appears nowhere in their document.
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

/**
 * How much bigger the measured rectangle is than the layout it came from.
 *
 * Per-axis because a transform scales the two independently. `{ x: 1, y: 1 }`
 * for an untransformed element, which is the ordinary case.
 */
export interface Scale {
  readonly x: number;
  readonly y: number;
}

/** Everything the placement needs, and nothing that has to be read from a DOM. */
export interface SpacingGeometry {
  /** The node's border box, in canvas content coordinates, post-transform. */
  readonly border: Rect;
  /** Border widths, needed because padding is measured from the padding box. */
  readonly borderWidths: EdgeLengths;
  readonly margin: EdgeLengths;
  readonly padding: EdgeLengths;
  /** The scale `border` was measured at. See the module docblock. */
  readonly scale: Scale;
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
  /*
   * Each edge scales by the axis it runs along: a left margin is a horizontal
   * distance and a top margin a vertical one. Scaling both by one factor is
   * right only while the transform is uniform, and `scale(2, 0.5)` is a single
   * legal value that makes it wrong on one axis.
   */
  const scaled = (edges: EdgeLengths): EdgeLengths => ({
    top: edges.top * scale.y,
    right: edges.right * scale.x,
    bottom: edges.bottom * scale.y,
    left: edges.left * scale.x,
  });

  const margin = scaled(geometry.margin);
  const padding = scaled(geometry.padding);
  const bands: SpacingBand[] = [];

  const inward = inwardExtents(margin, border);

  for (const side of SIDES) {
    const value = geometry.margin[side];
    const label = labelFor(value);
    if (!reports(label)) continue;
    bands.push({
      box: "margin",
      side,
      rect: marginRect(border, side, margin, inward),
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
  const inner = inset(border, scaled(geometry.borderWidths));

  for (const side of SIDES) {
    const value = geometry.padding[side];
    const label = labelFor(value);
    if (!reports(label)) continue;
    bands.push({
      box: "padding",
      side,
      rect: paddingRect(inner, side, padding),
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
 * How far each negative margin reaches INTO the border box.
 *
 * A negative margin has no bound in CSS: `margin-top: -100px` on a twenty-pixel
 * block is legal, and pulling an element further than its own size is the usual
 * way an overlap is authored. Drawn unbounded the band runs past the opposite
 * edge and colours a neighbour's pixels as this block's margin — the one thing
 * the overlay exists to answer, answered wrongly.
 *
 * Opposite sides are bounded TOGETHER, not one at a time. Clamping each to the
 * border dimension on its own still lets a pair overlap in the middle, and the
 * fills are translucent, so the contested strip darkens and reads as a third
 * value that nobody wrote. Sharing the dimension in proportion keeps each side's
 * band the larger of the two exactly when its margin is the larger, and lets
 * them meet without either crossing.
 *
 * The bound moves the band, never the number: the label is taken from the
 * authored value, so a margin clamped for want of room still reports what the
 * author typed.
 */
function inwardExtents(margin: EdgeLengths, border: Rect): EdgeLengths {
  const inwardPair = (
    near: number,
    far: number,
    size: number
  ): { near: number; far: number } => {
    const total = near + far;
    if (total <= size) return { near, far };
    // `total` exceeds `size` and `size` is never negative, so `total` is
    // positive here and the division is safe.
    const share = size / total;
    return { near: near * share, far: far * share };
  };

  const vertical = inwardPair(
    Math.max(0, -margin.top),
    Math.max(0, -margin.bottom),
    border.height
  );
  const horizontal = inwardPair(
    Math.max(0, -margin.left),
    Math.max(0, -margin.right),
    border.width
  );
  return {
    top: vertical.near,
    bottom: vertical.far,
    left: horizontal.near,
    right: horizontal.far,
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
 * `inward` carries every side's bounded inward reach, not just this one's,
 * because a band has to know where its neighbours stop — see
 * {@link inwardExtents}.
 *
 * The two axes are separate functions rather than four arms of one switch: they
 * follow DIFFERENT rules about the corners, and writing them together meant a
 * reader had to hold both to be sure which applied.
 */
function marginRect(
  border: Rect,
  side: SpacingSide,
  margin: EdgeLengths,
  inward: EdgeLengths
): Rect {
  const value = margin[side];
  const outward = value >= 0;
  const extent = outward ? value : inward[side];
  return side === "top" || side === "bottom"
    ? horizontalMarginRect(border, side, { extent, outward, margin })
    : verticalMarginRect(border, side, { extent, outward, inward });
}

/**
 * The TOP or BOTTOM band, which runs across the box.
 *
 * Outward, it spans the whole MARGIN box rather than the border box. Spanning
 * the border box leaves the outer corners painted by nothing: with a top and a
 * left margin, the rectangle above-and-left of the border box belongs to the
 * margin area and no band reached it. Extending the horizontal bands over the
 * vertical margins assigns each corner exactly once — the side bands still stop
 * at the border height, so nothing is painted twice and no translucent overlap
 * darkens a corner.
 *
 * Only OUTWARD neighbours extend it. A negative margin makes the margin box
 * smaller on that side, so there is no corner out there to fill.
 */
function horizontalMarginRect(
  border: Rect,
  side: "top" | "bottom",
  {
    extent,
    outward,
    margin,
  }: { extent: number; outward: boolean; margin: EdgeLengths }
): Rect {
  const leftOut = Math.max(0, margin.left);
  const rightOut = Math.max(0, margin.right);
  const span = outward
    ? { x: border.x - leftOut, width: border.width + leftOut + rightOut }
    : { x: border.x, width: border.width };

  const top = border.y;
  const bottom = border.y + border.height;
  let y: number;
  if (side === "top") y = outward ? top - extent : top;
  else y = outward ? bottom : bottom - extent;

  return { ...span, y, height: extent };
}

/**
 * The LEFT or RIGHT band, which runs down the box.
 *
 * An INWARD one yields the corners to the horizontal bands, mirroring what
 * {@link horizontalMarginRect} does outward: there the top and bottom bands
 * span the margin box's full width and the side bands stop at the border
 * height, so each corner is painted exactly once. Inward, the horizontal bands
 * lie INSIDE the border box, and a side band spanning the full height would
 * cross them — the fills are translucent, so the corner darkens and reads as a
 * value nobody wrote.
 *
 * An outward side band needs no such inset: it sits beyond the border edge,
 * where no inward band reaches.
 */
function verticalMarginRect(
  border: Rect,
  side: "left" | "right",
  {
    extent,
    outward,
    inward,
  }: { extent: number; outward: boolean; inward: EdgeLengths }
): Rect {
  const y = outward ? border.y : border.y + inward.top;
  const height = outward
    ? border.height
    : Math.max(0, border.height - inward.top - inward.bottom);

  const left = border.x;
  const right = border.x + border.width;
  let x: number;
  if (side === "left") x = outward ? left - extent : left;
  else x = outward ? right : right - extent;

  return { x, y, width: extent, height };
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
  /*
   * Every extent is clamped to the box, not only the remainder between two
   * sides. Padding can exceed the box it is measured in — `box-sizing:
   * border-box` with a fixed height and a larger padding keeps the computed
   * padding and collapses the content — and an unclamped band then runs past the
   * border edge and is drawn over the neighbouring block, which is worse than
   * drawing nothing because it names another block's space as this one's.
   */
  const top = Math.min(by.top, inner.height);
  const bottom = Math.min(by.bottom, inner.height);
  const left = Math.min(by.left, inner.width);
  const right = Math.min(by.right, inner.width);
  const middle = Math.max(0, inner.height - top - bottom);
  switch (side) {
    case "top":
      return { x: inner.x, y: inner.y, width: inner.width, height: top };
    case "bottom":
      return {
        x: inner.x,
        y: inner.y + inner.height - bottom,
        width: inner.width,
        height: bottom,
      };
    case "left":
      return { x: inner.x, y: inner.y + top, width: left, height: middle };
    case "right":
      return {
        x: inner.x + inner.width - right,
        y: inner.y + top,
        width: right,
        height: middle,
      };
  }
}

/**
 * Whether two band lists say the same thing, by VALUE.
 *
 * The overlay re-measures whenever the canvas moves or mutates, which on a page
 * being typed into is often. Handing React a fresh array each time re-renders
 * the whole overlay for a layout that did not move, so the caller keeps the
 * array it already has when the answer is unchanged.
 *
 * Every field is compared, not a subset. A rectangle that moved without changing
 * size, or a label that changed while the geometry held, are both real changes
 * an author must see — and a comparison that skipped either would freeze the
 * overlay in exactly the case it exists to report.
 */
export function sameBands(
  left: readonly SpacingBand[],
  right: readonly SpacingBand[]
): boolean {
  if (left.length !== right.length) return false;
  return left.every((one, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      one.box === other.box &&
      one.side === other.side &&
      one.label === other.label &&
      one.negative === other.negative &&
      one.rect.x === other.rect.x &&
      one.rect.y === other.rect.y &&
      one.rect.width === other.rect.width &&
      one.rect.height === other.rect.height
    );
  });
}

/**
 * Boxes that CSS gives no margin, whatever the computed style reports.
 *
 * `getComputedStyle` answers with the declared computed length for a property
 * that does not apply to the generated box, so an author who sets a margin on a
 * `table-row` gets a number back from a box that has none. Drawing it names
 * space that does not exist and cannot be made to exist by changing the value.
 *
 * The internal table boxes and the internal ruby boxes, both of which the
 * catalog's `display` keyword list ships. `table-caption` is deliberately absent
 * — it is not an internal table box and its margins apply normally.
 */
const MARGINLESS: ReadonlySet<string> = new Set([
  "table-row-group",
  "table-header-group",
  "table-footer-group",
  "table-row",
  "table-cell",
  "table-column-group",
  "table-column",
  "ruby-base",
  "ruby-text",
  "ruby-base-container",
  "ruby-text-container",
]);

/**
 * Boxes that CSS gives no padding.
 *
 * The same set MINUS `table-cell`, which is the one internal table box padding
 * does apply to — and the distinction is the point, because a cell's padding is
 * the common case an author actually sets.
 */
const PADDINGLESS: ReadonlySet<string> = new Set(
  [...MARGINLESS].filter(display => display !== "table-cell")
);

/** Whether each physical side of one box can carry spacing at all. */
export interface EdgeApplicability {
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
}

const ALL_SIDES: EdgeApplicability = {
  top: true,
  right: true,
  bottom: true,
  left: true,
};
const NO_SIDES: EdgeApplicability = {
  top: false,
  right: false,
  bottom: false,
  left: false,
};

/**
 * Whether the writing mode puts the BLOCK axis vertically on screen.
 *
 * `horizontal-tb` and anything unrecognised count as horizontal, which is the
 * initial value and the overwhelming case; every `vertical-*` and `sideways-*`
 * mode turns the block axis sideways.
 */
function blockAxisIsVertical(writingMode: string): boolean {
  return (
    !writingMode.startsWith("vertical") && !writingMode.startsWith("sideways")
  );
}

/**
 * Which spacing a generated box of this display type can actually have.
 *
 * PER SIDE rather than per box, because `display: inline` is not all-or-nothing:
 * a non-replaced inline box takes its INLINE-axis margins and ignores its
 * BLOCK-axis ones entirely, while `getComputedStyle` reports whatever the author
 * declared on all four. A blanket answer draws top and bottom bands for space an
 * inline box does not create.
 *
 * Which physical sides those are depends on the writing mode: the block axis is
 * vertical in `horizontal-tb` and horizontal in every `vertical-*` mode. Padding
 * is left alone — an inline box's block-axis padding does not affect layout, but
 * it DOES render, and this overlay reports what renders.
 *
 * `replaced` is the exception that makes the inline branch conditional, and it
 * is not a detail of an obscure element: `core/image` renders a bare `<img>`
 * whenever it has no caption, so the most ordinary image on a page IS an inline
 * replaced root. A replaced box is sized by its own content rather than by the
 * line, and its block-axis margins are part of what the line box has to make
 * room for — measured in Chromium, fifty pixels above and below an inline
 * `<img>` moves the following content by exactly a hundred, and the same
 * declaration on a `<span>` moves it by nothing. It cannot be read off the
 * computed style, which is why the caller passes it.
 */
export function spacingApplies(
  display: string,
  writingMode: string,
  replaced: boolean
): { margin: EdgeApplicability; padding: EdgeApplicability } {
  const padding = PADDINGLESS.has(display) ? NO_SIDES : ALL_SIDES;
  if (MARGINLESS.has(display)) return { margin: NO_SIDES, padding };
  if (display !== "inline" || replaced) return { margin: ALL_SIDES, padding };

  const acrossBlock = blockAxisIsVertical(writingMode);
  return {
    margin: {
      top: !acrossBlock,
      bottom: !acrossBlock,
      left: acrossBlock,
      right: acrossBlock,
    },
    padding,
  };
}

/** Zero the edges a generated box cannot have, keeping the ones it can. */
export function applicableEdges(
  edges: EdgeLengths,
  applies: EdgeApplicability
): EdgeLengths {
  return {
    top: applies.top ? edges.top : 0,
    right: applies.right ? edges.right : 0,
    bottom: applies.bottom ? edges.bottom : 0,
    left: applies.left ? edges.left : 0,
  };
}

/**
 * How far outside its own box the overlay layer must be allowed to paint.
 *
 * A band can legitimately sit outside the canvas. The first block's top margin
 * collapses through the page wrapper and the root — neither establishes a
 * formatting context — so its band is placed above the layer entirely; a
 * negative margin or an edge-flush block can do the same on any side.
 *
 * A FIXED allowance is the wrong shape and was the first attempt: any constant
 * is too small for some legal value, and `2rem` clipped an ordinary `64px`
 * spacing step. This measures what the bands actually need instead, so the clip
 * is exactly as loose as the content requires and no looser.
 *
 * `chip` is added unconditionally because the value chip is CENTRED on its band
 * and deliberately unclipped, so a band flush with an edge overflows by its own
 * half-height even when the band itself escapes by nothing. It is bounded by the
 * chip's own size, which this package controls.
 */
export function overlayEscape(
  bands: readonly SpacingBand[],
  layer: { readonly width: number; readonly height: number },
  chip: number
): number {
  let escape = 0;
  for (const band of bands) {
    escape = Math.max(
      escape,
      -band.rect.y,
      -band.rect.x,
      band.rect.y + band.rect.height - layer.height,
      band.rect.x + band.rect.width - layer.width
    );
  }
  return Math.max(0, escape) + chip;
}
