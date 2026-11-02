/**
 * The two cards that share a row of core's default dashboard, Needs attention and Upcoming
 * releases, and the one rule about them: while only one of the two is on show, it is drawn
 * across the whole row, so the row the other leaves is not a gap beside it.
 *
 * A DRAWN width only: the rule answers a width by placement, which the grid applies to the
 * card's column span alone. The card itself, its size controls, every write and Undo keep its
 * stored size, and it goes back to that span the moment the other is on show again. Both widgets
 * declare a maximum width of twelve, so the widened span stays within their bounds.
 *
 * Pure, so the rule is tested over rows without a grid; `ArrangedGrid` applies it.
 *
 * @module components/features/widgets/lone-pair
 */

import { GRID_COLUMNS, type GridSize } from "nextly/config";
import { createContext } from "react";

import type { DashboardLayoutResponse } from "../../../types/dashboard/widgets";

/**
 * The pair, by widget id: core's Needs attention and Upcoming releases, as core declares them
 * (`core-widgets/ids.ts` in nextly, which the admin does not import at run time).
 */
const SHARED_ROW_PAIR: ReadonlySet<string> = new Set([
  "core/needs-attention",
  "core/upcoming-releases",
]);

/** What the rule reads of a row: its placement, its widget and its stored size. */
interface PairRow {
  placementId: string;
  widget: { id: string };
  size: GridSize;
}

/** No card drawn at another width than its own. */
const NONE_WIDENED: ReadonlyMap<string, number> = new Map();

/**
 * Whether the grid draws the lone card of the pair across its row ({@link widensLonePair}),
 * provided where the grid's cards are (`CardContexts`).
 */
export const WidenLonePairContext = createContext(false);

/**
 * Whether this reader's dashboard widens the lone card of the pair: they follow the default
 * (they have not arranged their own, whose sizes are theirs), and the default as configured
 * gives the pair a row of their own (`pairedRow`, judged by the server before this reader's
 * cards are left out). A site's default that places the two otherwise, or one of them beside
 * another card, is drawn as it is written. Nothing before the layout read has answered.
 */
export function widensLonePair(
  read: Pick<DashboardLayoutResponse, "arranged" | "pairedRow"> | undefined
): boolean {
  return read !== undefined && !read.arranged && read.pairedRow === true;
}

/**
 * The widths the grid draws cards at in place of their own, by placement: the one card of the
 * pair that is on show, twelve columns wide, while the other is not on show (hidden while empty,
 * not shown to this reader, or not on the dashboard at all). Empty with both on show, or
 * neither, and for a card already twelve wide; the same empty map each time, so a caller
 * memoising on it redraws nothing.
 */
export function widenLoneOfPair<Row extends PairRow>(
  rows: readonly Row[],
  isOnShow: (row: Row) => boolean
): ReadonlyMap<string, number> {
  const shown = rows.filter(
    row => SHARED_ROW_PAIR.has(row.widget.id) && isOnShow(row)
  );
  if (shown.length !== 1) return NONE_WIDENED;
  const [lone] = shown;
  if (lone.size.w === GRID_COLUMNS) return NONE_WIDENED;
  return new Map([[lone.placementId, GRID_COLUMNS]]);
}
