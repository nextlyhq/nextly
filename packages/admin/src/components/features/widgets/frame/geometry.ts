/**
 * The line boxes a card's body is built from, named once.
 *
 * A loading card holds the place of the body that will replace it, and it does so by drawing
 * the SAME line boxes: a figure's line, a list row's label and detail lines, a table's head and
 * rows. Each is written here and nowhere else, so the loaded body and the skeleton standing in
 * for it cannot come to disagree about a height. A second copy of any of these strings would be
 * a skeleton one line taller or shorter than what arrives, which is the jump the reservation
 * exists to prevent.
 *
 * @module components/features/widgets/frame/geometry
 */

import type { ListDensity } from "nextly/config";

/** A figure: a metric's number, a stats cell's value. One line, as tall as its type. */
export const FIGURE_VALUE_CLASS =
  "text-2xl font-bold leading-none tabular-nums tracking-tight";

/**
 * A list's rows: one under another, each its own fixed height, with no gap between them and a
 * hairline between each and the next, so a row reads as one item at a glance.
 */
export const LIST_CLASS = "flex min-w-0 flex-col divide-y divide-border";

/**
 * A list row's fixed height at each density: the box every `EntityRow`, every table row and
 * every skeleton row standing in for one is drawn in, so a loading list and the list that
 * replaces it are the same height. The pixel heights the row count is worked out from are
 * `LIST_ROW_HEIGHT_PX` in `frame/list-rows`.
 */
export const LIST_ROW_HEIGHT_CLASS: Readonly<Record<ListDensity, string>> = {
  // A title line, a meta line under it and room above and below: 52px.
  default: "h-13",
  // One line, the meta after the title: 36px.
  compact: "h-9",
};

/**
 * A table row's fixed height at each density: one line of the table's smaller type, so the
 * large tier's table is as tight as a table reads, not as tall as a stacked row.
 */
export const TABLE_ROW_HEIGHT_CLASS: Readonly<Record<ListDensity, string>> = {
  default: "h-9",
  compact: "h-7",
};

/** One skeleton row: its label line, then its detail line, centred in the row's fixed height. */
export const LIST_ROW_CLASS = "flex min-w-0 flex-col justify-center gap-0.5";

/** A list row's label line. */
export const LIST_LABEL_CLASS = "break-words text-sm";

/** A list row's detail line. */
export const LIST_DETAIL_CLASS = "break-words text-xs";

/** A table, and the type its rows are set in: a size smaller than a list's, figures aligned. */
export const TABLE_CLASS = "w-full text-xs tabular-nums";

/** A table's heading cell: quieter and smaller than the rows it heads. */
export const TABLE_HEADING_CLASS =
  "break-words pb-1.5 pr-4 text-left text-[11px] font-medium last:pr-0";

/** A table's body cell. */
export const TABLE_CELL_CLASS = "break-words py-1 pr-4 align-top last:pr-0";

/** A list's or table's rows and the footer line under them. */
export const ROWS_STACK_CLASS = "flex min-w-0 flex-col gap-2";

/** A table's heading row. */
export const TABLE_HEAD_ROW_CLASS = "align-bottom";

/** A table's body row, ruled above, as a list's rows are divided. */
export const TABLE_ROW_CLASS = "border-t border-border";

/** A stats card's cells, as many to a row as fit. */
export const STATS_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-4";

/** One stats cell: its value, then its label. */
export const STATS_CELL_CLASS = "flex flex-col gap-1";

/** A stats cell's label line. Its weight is the cell's to choose; only its type sets its height. */
export const STATS_LABEL_CLASS = "text-xs";
