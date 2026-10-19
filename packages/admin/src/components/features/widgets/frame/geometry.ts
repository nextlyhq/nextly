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

/** A figure: a metric's number, a stats cell's value. One line, as tall as its type. */
export const FIGURE_VALUE_CLASS =
  "text-2xl font-bold leading-none tabular-nums tracking-tight";

/** A list's rows, and the gap between them. */
export const LIST_CLASS = "flex flex-col gap-2";

/** One list row: its label line, then its detail line when the list has one. */
export const LIST_ROW_CLASS = "flex min-w-0 flex-col gap-0.5";

/** A list row's label line. */
export const LIST_LABEL_CLASS = "break-words text-sm";

/** A list row's detail line. */
export const LIST_DETAIL_CLASS = "break-words text-xs";

/** A table, and the type its rows are set in. */
export const TABLE_CLASS = "w-full table-fixed text-sm";

/** A table's heading cell. */
export const TABLE_HEADING_CLASS =
  "break-words pb-1 pr-4 text-left text-xs font-medium last:pr-0";

/** A table's body cell. */
export const TABLE_CELL_CLASS = "break-words py-1 pr-4 align-top last:pr-0";

/** A list's or table's rows and the "More exist" line under them. */
export const ROWS_STACK_CLASS = "flex min-w-0 flex-col gap-3";

/** A table's heading row, ruled below. */
export const TABLE_HEAD_ROW_CLASS = "border-b border-border";

/** A table's body row, ruled below all but the last. */
export const TABLE_ROW_CLASS = "border-b border-border last:border-0";

/** The "More exist" line under a list's rows. */
export const MORE_LINE_CLASS = "text-xs";
