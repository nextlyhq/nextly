/**
 * The two cards that share a row of core's default dashboard, Needs attention and Upcoming
 * releases, and the one rule about them: while only one of the two is on show, it is drawn
 * across the whole row, so the row the other leaves is not a gap beside it.
 *
 * A DRAWN width only. The rows handed back are copies for drawing; the arrangement, and so
 * every save, keeps the card's own size, and the card goes back to it the moment the other is
 * on show again. Both widgets declare a maximum width of twelve, so the widened card stays
 * within its bounds and `drawnSize` draws it at twelve.
 *
 * Pure, so the rule is tested over rows without a grid; `ArrangedGrid` applies it.
 *
 * @module components/features/widgets/lone-pair
 */

import { GRID_COLUMNS, type GridSize } from "nextly/config";
import { createContext } from "react";

/**
 * The pair, by widget id: core's Needs attention and Upcoming releases, as core declares them
 * (`core-widgets/ids.ts` in nextly, which the admin does not import at run time).
 */
const SHARED_ROW_PAIR: ReadonlySet<string> = new Set([
  "core/needs-attention",
  "core/upcoming-releases",
]);

/** What the rule reads of a row: its widget and its stored size. */
interface PairRow {
  widget: { id: string };
  size: GridSize;
}

/**
 * Whether the grid draws the lone card of the pair across its row: on the default dashboard
 * only, provided where the grid's cards are (`CardContexts`); a dashboard the reader arranged
 * keeps its sizes.
 */
export const WidenLonePairContext = createContext(false);

/**
 * `rows`, with the one card of the pair that is on show drawn twelve columns wide when the other
 * is not on show: hidden while empty, not shown to this reader, or not on the dashboard at all.
 * With both on show, or neither, the same array comes back, so a caller memoising on it redraws
 * nothing.
 */
export function widenLoneOfPair<Row extends PairRow>(
  rows: Row[],
  isOnShow: (row: Row) => boolean
): Row[] {
  const shown = rows.filter(
    row => SHARED_ROW_PAIR.has(row.widget.id) && isOnShow(row)
  );
  if (shown.length !== 1) return rows;
  const [lone] = shown;
  if (lone.size.w === GRID_COLUMNS) return rows;
  return rows.map(row =>
    row === lone ? { ...row, size: { ...row.size, w: GRID_COLUMNS } } : row
  );
}
