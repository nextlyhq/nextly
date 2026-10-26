/**
 * The one place a card's drawn size is decided.
 *
 * The dashboard is ONE ordered list of cards on a grid twelve columns wide,
 * with rows 72 px high. A card spans its `w` columns and `h` rows, placed in
 * the list's order and never moved out of it to fill a gap, so the order a
 * reader sees, the order the page is read in and the order Tab visits agree.
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
 * | < 640 px       | 12: one column, in the saved order    |
 *
 * 🔴 `h` never changes with the band, so a card keeps its rows at every width.
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
import type { CSSProperties } from "react";

/** One row's height, in pixels rather than rem so it does not follow the root font size. */
export const ROW_HEIGHT_PX = 72;
/** The gap down the grid, between rows, at every width. */
export const ROW_GAP_PX = 16;
/** The gap across the grid, between columns, below {@link WIDE_GAP_FROM_PX}. */
export const COLUMN_GAP_PX = 16;
/** The gap across the grid from {@link WIDE_GAP_FROM_PX}. */
export const WIDE_COLUMN_GAP_PX = 24;
/** From this dashboard width the gap across is the wide one. */
export const WIDE_GAP_FROM_PX = 1280;

/** From this dashboard width the cards of `w` 6 or less share a row two at a time. */
export const TWO_UP_FROM_PX = 640;
/** From this dashboard width every card is drawn at its own `w`. */
export const AS_SIZED_FROM_PX = 1024;

/** Half the grid: the span every card of this many columns or fewer takes in the middle band. */
const HALF_GRID = GRID_COLUMNS / 2;

/**
 * The grid's own classes: twelve columns, rows of {@link ROW_HEIGHT_PX}, and the gaps.
 *
 * 🔴 The gap rule lives here and nowhere else: 16 px down at every width, and across 16 px, or
 * 24 px once the DASHBOARD is {@link WIDE_GAP_FROM_PX} wide. In pixels, because a card's drawn
 * width is its columns plus the gaps between them, and a width predicted with another gap is
 * off by enough to move a card across a tier's edge. `grid-flow-row` and never `dense`: a dense
 * grid backfills a gap with a later card, which draws it out of its order.
 */
export const GRID_CLASS =
  "grid grid-flow-row grid-cols-12 auto-rows-[72px] gap-x-[16px] gap-y-[16px] @min-[1280px]/dashboard:gap-x-[24px]";

/** The gap across the grid, in pixels, on a dashboard `dashboardWidth` wide. */
export function columnGapPx(dashboardWidth: number): number {
  return dashboardWidth >= WIDE_GAP_FROM_PX
    ? WIDE_COLUMN_GAP_PX
    : COLUMN_GAP_PX;
}

/** Whether a dashboard `dashboardWidth` wide draws one column. */
export function isOneColumn(dashboardWidth: number): boolean {
  return dashboardWidth < TWO_UP_FROM_PX;
}

/**
 * How many of the twelve columns a card of `w` is drawn across on a dashboard `dashboardWidth`
 * wide: the table above as numbers.
 *
 * The class text has to be written out in full for Tailwind, so it cannot be built from this;
 * a test reads the classes back and holds the two to the same answer at every band edge.
 */
export function drawnSpan(w: number, dashboardWidth: number): number {
  if (isOneColumn(dashboardWidth)) return GRID_COLUMNS;
  if (dashboardWidth < AS_SIZED_FROM_PX) {
    return w <= HALF_GRID ? HALF_GRID : GRID_COLUMNS;
  }
  return w;
}

/**
 * Span classes per `w`, the table above as class text, keyed 1 to 12. Frozen because this is the
 * shared map, not a starting point a caller may edit for one grid.
 */
export const SPAN_CLASSES: Readonly<Record<number, string>> = Object.freeze({
  1: "col-span-12 @min-[640px]/dashboard:col-span-6 @min-[1024px]/dashboard:col-span-1",
  2: "col-span-12 @min-[640px]/dashboard:col-span-6 @min-[1024px]/dashboard:col-span-2",
  3: "col-span-12 @min-[640px]/dashboard:col-span-6 @min-[1024px]/dashboard:col-span-3",
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
 * width through; its height is {@link cardRowStyle}'s.
 */
export function cardSpanClass(w: number): string {
  // A `w` the table does not hold is one `drawnSize` would never hand over; drawn full rather
  // than with no span at all, which would squeeze it into one column.
  return Object.hasOwn(SPAN_CLASSES, w)
    ? SPAN_CLASSES[w]
    : SPAN_CLASSES[GRID_COLUMNS];
}

/**
 * The rows a card drawn `h` high spans, as a style rather than a class: a card's `h` has no
 * upper end a list of class text could cover, and it is the same in every band, so no container
 * query has to answer it.
 */
export function cardRowStyle(h: number): CSSProperties {
  return { gridRow: `span ${h} / span ${h}` };
}

/** A card's height in pixels at `h` rows: its rows and the gaps between them, at every width. */
export function cardHeightPx(h: number): number {
  return h * ROW_HEIGHT_PX + (h - 1) * ROW_GAP_PX;
}

/** The widths the card menu offers wherever a widget's bounds allow them: the common fractions. */
const COMMON_WIDTHS: readonly number[] = [3, 4, 6, 8, 12];

/**
 * The widths a card may be resized to, narrowest first: each common width that lies within the
 * widget's bounds, and the bounds' own ends, so a widget whose minimum is 5 is offered 5.
 */
export function widthChoices(bounds: WidgetSizeBounds): number[] {
  const within = COMMON_WIDTHS.filter(
    w => w >= bounds.min.w && w <= bounds.max.w
  );
  return [...new Set([bounds.min.w, ...within, bounds.max.w])].sort(
    (a, b) => a - b
  );
}

/** The heights a card may be resized to, shortest first: every one its widget's bounds allow. */
export function heightChoices(bounds: WidgetSizeBounds): number[] {
  return Array.from(
    { length: bounds.max.h - bounds.min.h + 1 },
    (_, index) => bounds.min.h + index
  );
}

/** A width as the card menu says it: "6 columns". */
export function columnsName(w: number): string {
  return w === 1 ? "1 column" : `${w} columns`;
}

/** A height as the card menu says it: "4 rows". Never one: no card is under two rows high. */
export function rowsName(h: number): string {
  return `${h} rows`;
}

/** A whole size as a sentence says it: "6 columns by 4 rows". */
export function sizeName(size: GridSize): string {
  return `${columnsName(size.w)} by ${rowsName(size.h)}`;
}
