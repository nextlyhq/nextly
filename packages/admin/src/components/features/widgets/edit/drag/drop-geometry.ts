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

import { GRID_COLUMNS } from "nextly/config";

import {
  cardHeightPx,
  columnGapPx,
  ROW_GAP_PX,
  ROW_HEIGHT_PX,
} from "../../sizes";

/** The grid's columns, which a row's spans fill. */
const COLUMNS = GRID_COLUMNS;

/**
 * How much more a vertical distance counts than a horizontal one when finding
 * the card nearest the pointer, so a pointer between two rows picks the row it
 * is in rather than a card far along the row it is not.
 */
const VERTICAL_WEIGHT = 4;

/** A card as drawn: its rectangle relative to the grid, its span and its rows. */
export interface DrawnCard {
  id: string;
  /** The columns it spans at this width. */
  span: number;
  /** The rows it spans, its `h`: the same in every band. */
  rows: number;
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

/** Where a card is placed on the grid: its first column and row, in grid units. */
interface GridCell {
  column: number;
  row: number;
}

/**
 * Where each card in `order` is placed, as the grid's own auto-placement does it: in order and
 * never backfilled (the grid is not `dense`), each card at the first place at or after the last
 * one's where its span and rows are free. Rows as well as columns: after a tall half and a short
 * half, the next half fits beside the tall one, under the short one, which a count of columns
 * alone would start on a row of its own.
 */
function placements(order: readonly DrawnCard[]): GridCell[] {
  const taken = new Set<string>();
  const free = (column: number, row: number, span: number, rows: number) => {
    for (let r = row; r < row + rows; r++) {
      for (let c = column; c < column + span; c++) {
        if (taken.has(`${r}:${c}`)) return false;
      }
    }
    return true;
  };
  const cells: GridCell[] = [];
  let cursor = { column: 0, row: 0 };
  for (const card of order) {
    // Held to what the grid can draw, so the walk below always finds a place: a span of one to
    // twelve columns and at least one row.
    const span = Math.min(Math.max(Math.trunc(card.span) || 1, 1), COLUMNS);
    const rows = Math.max(Math.trunc(card.rows) || 1, 1);
    let { column, row } = cursor;
    // Along the cursor's row, then down a row from the first column, as the grid moves on.
    while (column + span > COLUMNS || !free(column, row, span, rows)) {
      column += 1;
      if (column + span > COLUMNS) {
        column = 0;
        row += 1;
      }
    }
    for (let r = row; r < row + rows; r++) {
      for (let c = column; c < column + span; c++) taken.add(`${r}:${c}`);
    }
    cells.push({ column, row });
    cursor = { column: column + span, row };
  }
  return cells;
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
  const order = cards.filter((_, index) => index !== from);
  order.splice(final, 0, moved);
  const cell = placements(order)[final];
  if (cell === undefined) return undefined;
  // The place the card will take, in pixels, by the grid's own measures: twelve columns with
  // the gap across that this width draws (`columnGapPx`), and rows of `ROW_HEIGHT_PX` with
  // `ROW_GAP_PX` between them.
  const gap = columnGapPx(gridWidth);
  const columnWidth = (gridWidth - (COLUMNS - 1) * gap) / COLUMNS;
  const rowPitch = ROW_HEIGHT_PX + ROW_GAP_PX;
  const top = cell.row * rowPitch;
  if (cell.column > 0) {
    // Beside the card before it on its row: centred in the gap across, as tall as it will be.
    return {
      orientation: "vertical",
      x: Math.round(cell.column * (columnWidth + gap) - gap / 2),
      top,
      length: cardHeightPx(Math.max(Math.trunc(moved.rows) || 1, 1)),
    };
  }
  // It starts a row: the line runs across the grid, centred in the gap above that row.
  return {
    orientation: "horizontal",
    y: top - ROW_GAP_PX / 2,
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
