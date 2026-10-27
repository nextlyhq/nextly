/**
 * Where a dragged card lands, and where the line that says so is drawn.
 *
 * Pure geometry over the cards as they are DRAWN: their rectangles relative to
 * the grid and their spans on its 12 columns at this width. Kept apart from
 * the drag library so the rules can be tested without a browser, and so the
 * pointer and the keyboard ask the same questions.
 *
 * Positions are FINAL positions: the index the card has once moved, counted in
 * the list without it. `final === from` is a move that changes nothing.
 *
 * @module components/features/widgets/edit/drag/drop-geometry
 */

import { drawnSpan, gridColumnGapPx, GRID_ROW_GAP_PX } from "../../sizes";

/** The grid's columns, which a row's spans fill: as many as a full-width card spans. */
const COLUMNS = drawnSpan("full", "wide");

/**
 * How much more a vertical distance counts than a horizontal one when finding
 * the card nearest the pointer, so a pointer between two rows picks the row it
 * is in rather than a card far along the row it is not.
 */
const VERTICAL_WEIGHT = 4;

/** A card as drawn: its rectangle relative to the grid, and its span. */
export interface DrawnCard {
  id: string;
  span: number;
  rect: { left: number; top: number; right: number; bottom: number };
}

/** Where to draw the drop line, relative to the grid. */
export type DropLine =
  | { orientation: "vertical"; x: number; top: number; length: number }
  | { orientation: "horizontal"; y: number; x: number; length: number };

/** The squared, vertically weighted distance from a point to a rectangle. */
function distanceTo(rect: DrawnCard["rect"], x: number, y: number): number {
  const dx =
    x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy =
    y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return dx * dx + VERTICAL_WEIGHT * dy * dy;
}

/**
 * The final position the pointer at `point` is over, for the card at `from`.
 *
 * The nearest card decides it: its first half puts the dragged card before it,
 * its second half after. A card as wide as the grid is split top and bottom,
 * since left and right of it are the same place.
 */
export function finalPositionAt(
  cards: readonly DrawnCard[],
  from: number,
  point: { x: number; y: number },
  gridWidth: number
): number | undefined {
  let nearest: { index: number; rect: DrawnCard["rect"] } | undefined;
  let best = Number.POSITIVE_INFINITY;
  cards.forEach((card, index) => {
    const distance = distanceTo(card.rect, point.x, point.y);
    if (distance < best) {
      best = distance;
      nearest = { index, rect: card.rect };
    }
  });
  if (nearest === undefined) return undefined;
  const { rect } = nearest;
  const fullWidth = rect.right - rect.left > gridWidth - 4;
  const after = fullWidth
    ? point.y > rect.top + (rect.bottom - rect.top) / 2
    : point.x > rect.left + (rect.right - rect.left) / 2;
  const gap = nearest.index + (after ? 1 : 0);
  // The gap is counted with the dragged card still in the list; past it, one
  // fewer card stands before the gap once it has left.
  return gap > from ? gap - 1 : gap;
}

/** Whether the card moved to `final` would start a row there. */
function startsRow(
  others: readonly DrawnCard[],
  moved: DrawnCard,
  final: number
): boolean {
  const order = [...others];
  order.splice(final, 0, moved);
  let column = 0;
  for (const card of order) {
    if (column + card.span > COLUMNS) column = 0;
    if (card === moved) return column === 0;
    column += card.span;
  }
  return false;
}

/**
 * Where the drop line goes for moving the card at `from` to `final`, or
 * `undefined` for a move that changes nothing.
 *
 * Beside the card it lands after, when it joins that card's row. Otherwise it
 * starts a row, and the line runs across the grid: above the card it lands
 * before, or below the last card when it lands at the end.
 */
export function dropLineFor(
  cards: readonly DrawnCard[],
  from: number,
  final: number,
  gridWidth: number
): DropLine | undefined {
  const moved = cards[from];
  if (moved === undefined || final === from) return undefined;
  const others = cards.filter((_, index) => index !== from);
  const before = others[final - 1];
  if (before !== undefined && !startsRow(others, moved, final)) {
    return {
      orientation: "vertical",
      x: before.rect.right + gridColumnGapPx(gridWidth) / 2,
      top: before.rect.top,
      length: before.rect.bottom - before.rect.top,
    };
  }
  const next = others[final];
  if (next !== undefined) {
    return {
      orientation: "horizontal",
      y: next.rect.top - GRID_ROW_GAP_PX / 2,
      x: 0,
      length: gridWidth,
    };
  }
  const last = others[others.length - 1];
  return last === undefined
    ? undefined
    : {
        orientation: "horizontal",
        y: last.rect.bottom + GRID_ROW_GAP_PX / 2,
        x: 0,
        length: gridWidth,
      };
}

/**
 * The final position one arrow key moves to, or `undefined` for any other key.
 *
 * One place in list order, whichever way the arrow points: moving by geometry
 * guesses wrong across rows of mixed widths, and list order is what the
 * announcement counts in. Stops at the ends rather than wrapping.
 */
export function keyboardStep(
  final: number,
  key: string,
  count: number
): number | undefined {
  const step =
    key === "ArrowLeft" || key === "ArrowUp"
      ? -1
      : key === "ArrowRight" || key === "ArrowDown"
        ? 1
        : undefined;
  if (step === undefined) return undefined;
  return Math.max(0, Math.min(count - 1, final + step));
}
