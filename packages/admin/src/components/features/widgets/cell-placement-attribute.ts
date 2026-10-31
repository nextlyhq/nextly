/**
 * The attribute a dashboard cell carries its placement id in.
 *
 * Two kinds of code read it: customise mode, whose drag measures the cards
 * drawn, and the page header, whose summary links scroll to and focus a card.
 * The header is part of the admin's first screen, which every page loads before
 * it renders; customise mode loads with the dashboard route. So the name lives
 * here, in a module that imports nothing, and each side reads it from this
 * file: kept beside the drag code, the header's one import of a string loaded
 * the whole drag module, its geometry and its messages into every page.
 * `src/shell-stays-off-drag-code.test.ts` holds the first screen to that.
 *
 * @module components/features/widgets/cell-placement-attribute
 */

/** The attribute each cell carries its placement in, so a drag can measure the cards drawn. */
export const CELL_PLACEMENT_ATTRIBUTE = "data-placement-id";
