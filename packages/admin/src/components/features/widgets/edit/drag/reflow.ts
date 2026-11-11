/**
 * Where the cards go while one is dragged, and how wide a card is while its edge is.
 *
 * Pure geometry over the cards as the grid lays them out NOW: their rectangles relative to the
 * grid, read from layout rather than from the screen, so a card still sliding to its place is
 * aimed at where it is going, not where it is caught mid-slide. Kept apart from the drag library
 * and the page so the rules can be tested without a browser.
 *
 * @module components/features/widgets/edit/drag/reflow
 */

import { GRID_COLUMNS } from "nextly/config";

import { columnGapPx } from "../../sizes";

/** A card as the grid lays it out: its rectangle relative to the grid's corner. */
export interface LaidOutCard {
  id: string;
  rect: { left: number; top: number; right: number; bottom: number };
}

/** Which card the pointer is over, and which half: the held card goes before or after it. */
export interface ReflowTarget {
  id: string;
  side: "before" | "after";
}

/**
 * The card the pointer at `point` is over, other than the held one, and the half it is in; or
 * `undefined` over the held card's own place or over no card, where nothing moves.
 *
 * A card counts out to the middle of the gaps around it, so a pointer crossing a gap reaches
 * the next card rather than nothing. A card as wide as the grid is split top and bottom, since
 * left and right of it are the same place; any other card left and right.
 */
export function reflowTargetAt(
  cards: readonly LaidOutCard[],
  heldId: string,
  point: { x: number; y: number },
  gridWidth: number
): ReflowTarget | undefined {
  const reach = columnGapPx(gridWidth) / 2;
  for (const card of cards) {
    const { left, top, right, bottom } = card.rect;
    const inside =
      point.x >= left - reach &&
      point.x <= right + reach &&
      point.y >= top - reach &&
      point.y <= bottom + reach;
    if (!inside) continue;
    // Over the held card's own place: it is already where the pointer is.
    if (card.id === heldId) return undefined;
    const fullWidth = right - left >= gridWidth - 1;
    const after = fullWidth
      ? point.y > top + (bottom - top) / 2
      : point.x > left + (right - left) / 2;
    return { id: card.id, side: after ? "after" : "before" };
  }
  return undefined;
}

/**
 * `order` with the held card moved to the `side` of `target`; the same array when that changes
 * nothing, so a caller can tell a move from none by identity.
 */
export function reorderAround(
  order: readonly string[],
  heldId: string,
  target: ReflowTarget
): readonly string[] {
  if (!order.includes(heldId) || !order.includes(target.id)) return order;
  const without = order.filter(id => id !== heldId);
  const at = without.indexOf(target.id) + (target.side === "after" ? 1 : 0);
  const next = [...without.slice(0, at), heldId, ...without.slice(at)];
  return next.every((id, index) => id === order[index]) ? order : next;
}

/**
 * How many of the grid's twelve columns a card reaches when its right edge is dragged to
 * `edgeX` (relative to the grid), from its left edge at `left`: the columns up to the pointer,
 * counting a column reached once the pointer passes the middle of the gap before it.
 */
export function columnsReached(
  left: number,
  edgeX: number,
  gridWidth: number
): number {
  const gap = columnGapPx(gridWidth);
  const column = (gridWidth - (GRID_COLUMNS - 1) * gap) / GRID_COLUMNS;
  return (edgeX - left + gap / 2) / (column + gap);
}

/**
 * The width choice nearest `columns`, the narrower on a tie; `undefined` with no choices. A
 * width past the widest choice snaps to the widest, so dragging on stops at the maximum.
 */
export function nearestWidth(
  choices: readonly number[],
  columns: number
): number | undefined {
  let best: number | undefined;
  for (const choice of choices) {
    if (
      best === undefined ||
      Math.abs(choice - columns) < Math.abs(best - columns)
    ) {
      best = choice;
    }
  }
  return best;
}
