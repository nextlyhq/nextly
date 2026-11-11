/**
 * The one place a card's drawn size is decided.
 *
 * The dashboard is ONE ordered list of cards on a grid twelve columns wide. A card spans its `w`
 * columns, placed in the list's order and never moved out of it to fill a gap, so the order a
 * reader sees, the order the page is read in and the order Tab visits agree. Every card takes one
 * row of the grid, and the rows are as tall as the tallest card drawn in them: a card is as tall
 * as its content, at rest and while customising, and the cards that share a row are stretched to
 * one height so their bottoms meet. A stored `h` is kept, and sets no height.
 *
 * How many columns a card is DRAWN across depends on how wide the DASHBOARD
 * is, not the window: the grid sits in an `@container/dashboard` wrapper and
 * every span below answers to it, so a dashboard squeezed by an open sidebar
 * draws the band that fits it.
 *
 * | dashboard      | columns a card of `w` is drawn across |
 * |----------------|---------------------------------------|
 * | >= 1,024 px    | `w`                                   |
 * | 640-1,023 px   | 6 for a `w` of 6 or less, else 12     |
 * | < 640 px       | 6 for a `w` of 3 or less, else 12     |
 *
 * A widget's minimum `w` holds on the twelve-column band only; in the narrower
 * bands a card takes the width the band gives it, and its body adapts through
 * its size tier (`frame/tier`).
 *
 * Every class is written out IN FULL. Tailwind resolves utilities by scanning
 * source TEXT, so a `col-span-${n}` template literal produces a `className` at
 * runtime that has no rule behind it in the built stylesheet.
 *
 * @module components/features/widgets/sizes
 */

import {
  GRID_COLUMNS,
  clampSize,
  isGridSize,
  type GridSize,
  type WidgetSizeBounds,
} from "nextly/config";

// The gap down the grid, in pixels: core's own (`nextly/card-geometry`), re-exported for the
// grid's readers, which name it from here.
export { ROW_GAP_PX } from "nextly/card-geometry";

// The gaps across, the bands and how many columns a card is drawn across in each (the table
// above): core's own too, since the layout read works out the tier a card is drawn at from them
// to judge a card that hides while empty on the answer its first query gets. Re-exported, as the
// rows are, for the grid's readers.
export {
  AS_SIZED_FROM_PX,
  COLUMN_GAP_PX,
  columnGapPx,
  drawnSpan,
  isOneColumn,
  TWO_UP_FROM_PX,
  WIDE_COLUMN_GAP_PX,
  WIDE_GAP_FROM_PX,
} from "nextly/card-geometry";

/**
 * The dashboard grid's classes: twelve columns, in order, and the gaps, with rows as tall as the
 * cards drawn in them. One grid at rest and while customising, so a card is drawn at the same
 * height in both.
 *
 * 🔴 The gap rule lives here and nowhere else: 16 px down at every width, and across 16 px, or
 * 24 px once the DASHBOARD is {@link WIDE_GAP_FROM_PX} wide. In pixels, because a card's drawn
 * width is its columns plus the gaps between them, and a width predicted with another gap is
 * off by enough to move a card across a tier's edge. `grid-flow-row` and never `dense`: a dense
 * grid backfills a gap with a later card, which draws it out of its order. `auto-rows-auto` and
 * the grid's default stretch make each row as tall as its tallest card, and every card in it as
 * tall as that.
 */
export const GRID_CLASS =
  "grid grid-flow-row grid-cols-12 gap-x-[16px] gap-y-[16px] @min-[1280px]/dashboard:gap-x-[24px] auto-rows-auto";

/**
 * The grid's columns and the gap across them, without its rows: for a grid that draws cards at
 * the dashboard's widths but lays its rows out itself (the widget preview page, where each card
 * sits under a label). The same classes as {@link GRID_CLASS}, which a test holds it to, so a
 * card drawn there is as wide as on the dashboard and lands in the same tier.
 */
export const GRID_COLUMNS_CLASS =
  "grid-cols-12 gap-x-[16px] @min-[1280px]/dashboard:gap-x-[24px]";

/**
 * Span classes per `w`, the table above as class text, keyed 1 to 12. Frozen because this is the
 * shared map, not a starting point a caller may edit for one grid.
 *
 * The class text has to be written out in full for Tailwind, so it cannot be built from
 * `drawnSpan`, the table as numbers; a test reads the classes back and holds the two to the same
 * answer at every band edge.
 */
export const SPAN_CLASSES: Readonly<Record<number, string>> = Object.freeze({
  1: "col-span-6 @min-[1024px]/dashboard:col-span-1",
  2: "col-span-6 @min-[1024px]/dashboard:col-span-2",
  3: "col-span-6 @min-[1024px]/dashboard:col-span-3",
  4: "col-span-12 @min-[640px]/dashboard:col-span-6 @min-[1024px]/dashboard:col-span-4",
  5: "col-span-12 @min-[640px]/dashboard:col-span-6 @min-[1024px]/dashboard:col-span-5",
  6: "col-span-12 @min-[640px]/dashboard:col-span-6",
  7: "col-span-12 @min-[1024px]/dashboard:col-span-7",
  8: "col-span-12 @min-[1024px]/dashboard:col-span-8",
  9: "col-span-12 @min-[1024px]/dashboard:col-span-9",
  10: "col-span-12 @min-[1024px]/dashboard:col-span-10",
  11: "col-span-12 @min-[1024px]/dashboard:col-span-11",
  12: "col-span-12",
});

/**
 * The size a stored card is DRAWN at, on the twelve-column band.
 *
 * The stored size while it lies within its widget's current bounds; otherwise the nearest size
 * inside them, each direction moved only as far as it must (core's `clampSize`, the rule the
 * server reads a stored size by too). The stored value itself is never changed by this: it is
 * kept until its owner saves, and comes back if the widget allows it again. A stored value the
 * grid could not draw at all (not whole numbers, `w` past 12, `h` under 2) is drawn at the
 * widget's default.
 */
export function drawnSize(
  stored: GridSize,
  bounds: WidgetSizeBounds
): GridSize {
  return isGridSize(stored) ? clampSize(stored, bounds) : { ...bounds.default };
}

/**
 * The span classes for a card drawn at `w` columns. The one function the grid draws a card's
 * width through; its height is its content's.
 */
export function cardSpanClass(w: number): string {
  // A `w` the table does not hold is one `drawnSize` would never hand over; drawn full rather
  // than with no span at all, which would squeeze it into one column.
  return Object.hasOwn(SPAN_CLASSES, w)
    ? SPAN_CLASSES[w]
    : SPAN_CLASSES[GRID_COLUMNS];
}

/**
 * The widths the dashboard names, in columns of twelve: 25%, 33%, 50%, 66%, 75% and 100% of the
 * row. They are offered wherever a widget's bounds allow them.
 */
const NAMED_WIDTHS: ReadonlyMap<number, string> = new Map([
  [3, "25%"],
  [4, "33%"],
  [6, "50%"],
  [8, "66%"],
  [9, "75%"],
  [12, "100%"],
]);

/**
 * The widths a card may be resized to, narrowest first: each named width that lies within the
 * widget's bounds, the bounds' own ends (so a widget bounded 5 to 5 is still offered 5), the
 * widget's declared default (so a card can always go back to the width its author chose), and
 * the width it is drawn at (so one of the choices is always the checked one).
 */
export function widthChoices(
  bounds: WidgetSizeBounds,
  drawn?: number
): number[] {
  const within = [...NAMED_WIDTHS.keys()].filter(
    w => w >= bounds.min.w && w <= bounds.max.w
  );
  const ends = [bounds.min.w, bounds.default.w, bounds.max.w];
  return [
    ...new Set([...ends, ...within, ...(drawn === undefined ? [] : [drawn])]),
  ]
    .filter(w => w >= bounds.min.w && w <= bounds.max.w)
    .sort((a, b) => a - b);
}

/** A width as the card menu says it: "6 columns". */
export function columnsName(w: number): string {
  return w === 1 ? "1 column" : `${w} columns`;
}

/**
 * A width as a share of the row, in whole percent: a named width by its name ("50%", "66%"), any
 * other column count by its own share rounded ("5 columns" is "42%"). A reader thinks of a card
 * as half the row, not as six of twelve columns.
 */
export function widthPercent(w: number): string {
  return NAMED_WIDTHS.get(w) ?? `${Math.round((w / 12) * 100)}%`;
}

/**
 * A width as the card menu offers it: its share of the row ("50%"), with its columns as the
 * detail beneath for whoever lays out by the grid. `spoken` is the whole name a screen reader
 * hears, "50% width".
 */
export function widthChoiceName(w: number): {
  label: string;
  detail?: string;
  spoken: string;
} {
  const percent = widthPercent(w);
  return { label: percent, detail: columnsName(w), spoken: `${percent} width` };
}

/** A whole size as a sentence says it: "50% wide". Its stored `h` sets no height, so is not named. */
export function sizeName(size: GridSize): string {
  return `${widthPercent(size.w)} wide`;
}
