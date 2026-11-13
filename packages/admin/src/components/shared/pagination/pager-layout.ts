/**
 * How the pager under a table is laid out, named once for the pager and for a
 * table's outline, which draws the pager's frame while the rows are on their
 * way, so the pager lands where the outline drew it and nothing under the
 * table moves when it does.
 *
 * Imports nothing, so an outline drawn in the admin's first frame reads these
 * without pulling the pager's code in with them.
 *
 * @module components/shared/pagination/pager-layout
 */

/**
 * The pager's own frame: its padding, its rule above it and its surface, and
 * its two halves side by side on a wide content column, stacked on a narrow
 * one.
 */
export const PAGER_FRAME =
  "flex flex-col @2xl/content:flex-row w-full items-center justify-between gap-4 text-xs @md/content:text-sm text-muted-foreground p-4 border-t border-border bg-[var(--nx-table-header-bg)]";

/** The pager's controls half: the page size, the page buttons and the count. */
export const PAGER_CONTROLS =
  "flex flex-wrap items-center justify-center gap-4 @md/content:gap-6 @4xl/content:gap-8 order-1 @2xl/content:order-2";

/** One page button's size: the pager's tallest control, which sets its height. */
export const PAGER_BUTTON_SIZE = "h-10 w-10";
