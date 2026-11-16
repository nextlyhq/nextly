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

/** The line saying which rows are shown, under the controls where the two stack. */
export const PAGER_SUMMARY = "whitespace-nowrap order-2 @2xl/content:order-1";

/** The page-size selector: its words, then its box. */
export const PAGER_SIZE = "flex items-center space-x-2";

/** The page-size selector's words, which a narrow content column hides. */
export const PAGER_SIZE_LABEL =
  "whitespace-nowrap hidden @md/content:inline-block";

/** What the page-size selector's words say. */
export const PAGER_SIZE_WORDS = "Rows per page";

/** The page-size selector's box. */
export const PAGER_SIZE_BOX = "h-9 w-[70px]";

/** The page buttons: first, previous, the page numbers, next and last. */
export const PAGER_NAV = "flex items-center gap-1";

/** The page count at the controls' end, which a narrow content column hides. */
export const PAGER_COUNT = "whitespace-nowrap hidden @md/content:block";

/**
 * "Page 3 of 12", or "Page 3" alone when the total is capped and the number
 * of pages is not known.
 */
export function pageCountText(
  currentPage: number,
  totalPages: number,
  totalCapped: boolean
): string {
  return totalCapped
    ? `Page ${currentPage + 1}`
    : `Page ${currentPage + 1} of ${totalPages}`;
}
