/**
 * How a table row's actions are drawn, named once for the table and for a
 * table's outline, which holds the same column while the rows are on their
 * way. The trigger is a row's tallest part, so it is what sets the row's
 * height, and the outline's rows take that height from it rather than from a
 * number of their own.
 *
 * Imports nothing, so an outline drawn in the admin's first frame reads these
 * without pulling the table's code in with them. Also how a table laid out by
 * its columns' widths is drawn, for the same two readers.
 *
 * @module components/ui/table/data-table/row-actions
 */

/** The button that opens a row's actions: an icon button with no border. */
export const ROW_ACTIONS_TRIGGER = { size: "icon", variant: "ghost" } as const;

/**
 * The row actions' column, at the row's end: its head and each row's cell.
 * As wide as the trigger (a control's height, as an icon button is) and the
 * cell's padding either side (`px-4`), so a table laid out by its columns'
 * widths (`FIXED_LAYOUT_TABLE`) holds the trigger as one laid out by its
 * content does.
 */
export const ROW_ACTIONS_COLUMN =
  "w-[calc(var(--nx-control-height)+2rem)] text-right";

/** The selection boxes' column, at the row's start: its head and each row's cell. */
export const SELECTION_COLUMN = "w-10";

/**
 * A list's table: the content column's width at the least, and as wide as
 * its columns' content where that is wider (the table then scrolls across).
 * No column is squeezed below its content, so no head wraps onto a second
 * line, and the outline's head, drawn the same way, is as tall as the table's.
 */
export const LIST_TABLE = "w-full min-w-max";

/**
 * A table laid out by its columns' widths alone, never by what its rows hold:
 * its columns stand where they will stand before the rows arrive, and do not
 * move when they land. As wide as its columns at the least, and wider where
 * there is room; the extra is shared among the columns.
 */
export const FIXED_LAYOUT_TABLE = "table-fixed";

/**
 * Whether a table's columns are laid out by their widths: every one of them
 * declares one. A column without one would be sized by its content, which is
 * not there until the rows are.
 */
export function fixedColumnLayout(
  widths: readonly (number | undefined)[]
): boolean {
  return widths.length > 0 && widths.every(width => width !== undefined);
}
