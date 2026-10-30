/**
 * How tall a dashboard card's body is, and how many list rows it holds, in
 * pixels worked out from the card's height in grid rows.
 *
 * 🔴 The one copy of these numbers. The admin draws its grid rows, its frame
 * and its list rows by them and counts the rows a list card draws with
 * {@link rowsInBody}; a widget's own `load` asks the same question through
 * {@link rowsThatFit}, so the rows a load reads and the rows the card then
 * draws come from one formula and cannot drift apart.
 *
 * The same holds across: how many columns a card is drawn across at each
 * dashboard width, and the size tier its drawn width reads as. The admin
 * sizes a card's first query by {@link cardTierAt} before the card is drawn,
 * and the layout read judges a card that hides while empty at the tier
 * {@link cardTierAt} gives for the dashboard width the admin sent, so the
 * card is judged on the answer its first query will get.
 *
 * Imports only `query-limits.ts`, `grid-size.ts` (which imports nothing) and a
 * type, so a browser bundle and a server load both reach it without anything
 * behind it; its own entry, `nextly/card-geometry`.
 *
 * The dashboard grid's geometry, shared by nextly and its admin. Not a public
 * API; it may change in any release. Its one public piece is
 * {@link rowsThatFit}, published from the `nextly` root and the plugin SDK.
 *
 * @module domains/widgets/card-geometry
 * @internal
 */

import type { WidgetCellTier } from "./definition";
import { GRID_COLUMNS, type GridSize } from "./grid-size";
import { MAX_WIDGET_ROWS, type ListDensity } from "./query-limits";

/**
 * One grid row's height, in pixels rather than rem so it does not follow the root font size.
 *
 * @internal
 */
export const ROW_HEIGHT_PX = 72;

/**
 * The gap down the grid, between rows, at every dashboard width.
 *
 * @internal
 */
export const ROW_GAP_PX = 16;

/**
 * What a card's frame draws around its body, in pixels, top to bottom: the
 * card's border, the padding inside it on every side, the header, the gap
 * under the header, and the footer's gap and its one line of `text-xs`.
 *
 * The admin names the class it draws each of these with beside the number
 * (`frame/measures`), and its tests read the classes back off a drawn card.
 *
 * @internal
 */
export const CARD_FRAME_PX: Readonly<{
  border: number;
  padding: number;
  header: number;
  bodyGap: number;
  footerGap: number;
  footerLine: number;
}> = Object.freeze({
  border: 1,
  padding: 16,
  header: 40,
  bodyGap: 12,
  footerGap: 12,
  footerLine: 16,
});

/**
 * A list row's height at each density, in pixels: the line box every row is
 * drawn in. The admin's row classes (`LIST_ROW_HEIGHT_CLASS`) draw these
 * heights, and a test holds the two to the same number.
 *
 * @internal
 */
export const LIST_ROW_HEIGHT_PX: Readonly<Record<ListDensity, number>> =
  Object.freeze({
    default: 52,
    compact: 36,
  });

/**
 * A card's height in pixels at `h` rows: its rows and the gaps between them, at every width.
 *
 * @internal
 */
export function cardHeightPx(h: number): number {
  return h * ROW_HEIGHT_PX + (h - 1) * ROW_GAP_PX;
}

/**
 * The height a card's body has, in pixels, when the card spans `h` rows.
 *
 * The card's height less what the frame draws around the body
 * ({@link CARD_FRAME_PX}): its border and padding top and bottom, the header,
 * the gap under it, and the footer's height. The footer is counted whether or
 * not it shows a link, so the rows a list draws do not change when "View all"
 * appears. The same at every dashboard width: a card keeps its `h` in every
 * band, and the gap down the grid does not widen as the gap across does.
 *
 * @internal
 */
export function cardBodyHeightPx(h: number): number {
  const frame = CARD_FRAME_PX;
  return (
    cardHeightPx(h) -
    2 * (frame.border + frame.padding) -
    frame.header -
    frame.bodyGap -
    (frame.footerGap + frame.footerLine)
  );
}

/**
 * The whole list rows a body `bodyHeight` pixels tall holds at `density`:
 * never part of a row, never more than `MAX_WIDGET_ROWS`, and none for a body
 * with no room. A height that is not a finite number holds nothing rather
 * than an unbounded list.
 *
 * @internal
 */
export function rowsInBody(bodyHeight: number, density: ListDensity): number {
  if (!Number.isFinite(bodyHeight) || bodyHeight <= 0) return 0;
  return Math.min(
    Math.floor(bodyHeight / LIST_ROW_HEIGHT_PX[density]),
    MAX_WIDGET_ROWS
  );
}

/**
 * How many list rows a card of `size` draws in its body at `density`: the
 * card's body height (`cardBodyHeightPx(size.h)`) over one row's height at that
 * density, in whole rows, at most ten.
 *
 * For a widget's `load`, handed its card's `size`, to read no more rows than
 * the card will draw: `services.find(slug, { limit: rowsThatFit(size, { density
 * }) })`. Core's own list cards count their rows by this formula. `density` is
 * a list card's Density setting: `"default"`, or `"compact"`, whose shorter
 * rows let the same card hold more.
 *
 * `0` for a card too short to hold one whole row, such as one two rows high at
 * the default density, whose frame then draws no row; `find` asked a limit of
 * `0` answers none, so the read and the card agree.
 *
 * @experimental
 */
export function rowsThatFit(
  size: Pick<GridSize, "h">,
  options: { density: ListDensity }
): number {
  return rowsInBody(cardBodyHeightPx(size.h), options.density);
}

/**
 * The gap across the grid, between columns, below {@link WIDE_GAP_FROM_PX}.
 *
 * @internal
 */
export const COLUMN_GAP_PX = 16;

/**
 * The gap across the grid from {@link WIDE_GAP_FROM_PX}.
 *
 * @internal
 */
export const WIDE_COLUMN_GAP_PX = 24;

/**
 * From this dashboard width the gap across is the wide one.
 *
 * @internal
 */
export const WIDE_GAP_FROM_PX = 1280;

/**
 * From this dashboard width the cards of `w` 6 or less share a row two at a time.
 *
 * @internal
 */
export const TWO_UP_FROM_PX = 640;

/**
 * From this dashboard width every card is drawn at its own `w`.
 *
 * @internal
 */
export const AS_SIZED_FROM_PX = 1024;

/** Below this drawn width a card is small: a full grouped figure may not fit. */
const SMALL_TIER_BELOW_PX = 340;

/** From this drawn width a card is large. */
const LARGE_TIER_FROM_PX = 700;

/** Half the grid: the span every card of this many columns or fewer takes in the middle band. */
const HALF_GRID = GRID_COLUMNS / 2;

/**
 * The gap across the grid, in pixels, on a dashboard `dashboardWidth` wide.
 *
 * @internal
 */
export function columnGapPx(dashboardWidth: number): number {
  return dashboardWidth >= WIDE_GAP_FROM_PX
    ? WIDE_COLUMN_GAP_PX
    : COLUMN_GAP_PX;
}

/**
 * Whether a dashboard `dashboardWidth` wide draws one column.
 *
 * @internal
 */
export function isOneColumn(dashboardWidth: number): boolean {
  return dashboardWidth < TWO_UP_FROM_PX;
}

/**
 * How many of the twelve columns a card of `w` is drawn across on a dashboard
 * `dashboardWidth` wide: every column below {@link TWO_UP_FROM_PX}; half the
 * grid for a `w` of half or less, else all of it, below
 * {@link AS_SIZED_FROM_PX}; its own `w` from there.
 *
 * @internal
 */
export function drawnSpan(w: number, dashboardWidth: number): number {
  if (isOneColumn(dashboardWidth)) return GRID_COLUMNS;
  if (dashboardWidth < AS_SIZED_FROM_PX) {
    return w <= HALF_GRID ? HALF_GRID : GRID_COLUMNS;
  }
  return w;
}

/**
 * The outer width, in pixels, of a card of `w` columns on a dashboard
 * `dashboardWidth` wide: the twelfths of the dashboard its drawn span takes
 * ({@link drawnSpan}) and its share of the gaps, less the gap that follows it.
 * The width the card measures once drawn.
 *
 * @internal
 */
export function cardOuterWidth(w: number, dashboardWidth: number): number {
  const span = drawnSpan(w, dashboardWidth);
  const gap = columnGapPx(dashboardWidth);
  return ((dashboardWidth + gap) * span) / GRID_COLUMNS - gap;
}

/**
 * The size tier a card drawn `width` pixels wide reads as.
 *
 * @internal
 */
export function tierOfWidth(width: number): WidgetCellTier {
  if (width < SMALL_TIER_BELOW_PX) return "small";
  return width >= LARGE_TIER_FROM_PX ? "large" : "medium";
}

/**
 * The tier a card of `w` columns is drawn at on a dashboard `dashboardWidth`
 * wide: the tier its outer width reads as. The one rule for it: the admin
 * sizes a card's first query by it before the card can measure itself, and
 * the layout read judges a card that hides while empty at it, so both ask a
 * widget's `load` at the same tier.
 *
 * @internal
 */
export function cardTierAt(w: number, dashboardWidth: number): WidgetCellTier {
  return tierOfWidth(cardOuterWidth(w, dashboardWidth));
}
