/**
 * The attribute each dashboard cell carries its placement in.
 *
 * A module of its own, apart from `useCardDrag`, because the dashboard header
 * reads it too: the header's summary line finds a card by it, and the header
 * is a public export of the admin's entry, so whatever it imports loads before
 * the first screen of every route. Importing the constant from the drag hook
 * carried the whole hook (and its geometry and messages) into that set.
 *
 * @module components/features/widgets/edit/drag/cell-placement
 */

/** The attribute each cell carries its placement in, so a drag can measure the cards drawn. */
export const CELL_PLACEMENT_ATTRIBUTE = "data-placement-id";

/** Each cell drawn in `grid`, by its placement. */
export function cellsOf(grid: HTMLElement): Map<string, HTMLElement> {
  const cells = new Map<string, HTMLElement>();
  for (const cell of grid.querySelectorAll<HTMLElement>(
    `[${CELL_PLACEMENT_ATTRIBUTE}]`
  )) {
    const id = cell.getAttribute(CELL_PLACEMENT_ATTRIBUTE);
    if (id !== null) cells.set(id, cell);
  }
  return cells;
}
