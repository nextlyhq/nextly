/**
 * How a list's toolbar is laid out, named once for the toolbar and for a
 * list's outline, which draws the toolbar's shapes while the list is on its
 * way, so the table under it lands where the outline drew it.
 *
 * On a wide content column the search and the controls share one row, the
 * search giving way first, down to a usable width; past that the controls
 * move to a row of their own, together, rather than stacking one above the
 * other beside the search.
 *
 * Imports nothing, so an outline drawn in the admin's first frame reads these
 * without pulling the toolbar's code in with them.
 *
 * @module components/ui/table/list-view/toolbar-layout
 */

/** The toolbar's row: stacked on a narrow content column, one row on a wide one. */
export const LIST_TOOLBAR_ROW =
  "flex flex-col justify-between gap-4 @lg/content:flex-row @lg/content:flex-wrap @lg/content:items-center";

/** The search's place in the row: the whole width, or what the controls leave of a row. */
export const LIST_TOOLBAR_SEARCH =
  "relative w-full @lg/content:w-auto @lg/content:min-w-60 @lg/content:flex-1 @lg/content:max-w-xs @2xl/content:max-w-sm";

/** The controls' place in the row: at its end, side by side. */
export const LIST_TOOLBAR_CONTROLS =
  "flex flex-wrap items-center gap-2 @lg/content:justify-end";
