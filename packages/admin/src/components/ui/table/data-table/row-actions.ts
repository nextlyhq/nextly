/**
 * How a table row's actions are drawn, named once for the table and for a
 * table's outline, which holds the same column while the rows are on their
 * way. The trigger is a row's tallest part, so it is what sets the row's
 * height, and the outline's rows take that height from it rather than from a
 * number of their own.
 *
 * Imports nothing, so an outline drawn in the admin's first frame reads these
 * without pulling the table's code in with them.
 *
 * @module components/ui/table/data-table/row-actions
 */

/** The button that opens a row's actions: an icon button with no border. */
export const ROW_ACTIONS_TRIGGER = { size: "icon", variant: "ghost" } as const;

/** The row actions' column, at the row's end: its head and each row's cell. */
export const ROW_ACTIONS_COLUMN = "w-12 text-right";
