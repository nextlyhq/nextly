/**
 * The marker for editor chrome drawn inside the canvas.
 *
 * @module canvas-chrome
 */

/**
 * Marks editor chrome drawn over the page, which is not part of the page.
 *
 * A click on the canvas background CLEARS the selection, and the overlay sits
 * inside the canvas root — so without this a press on any control drawn over
 * the page resolves to "no node" and deselects the very block that control
 * acts on. The floating toolbar would run its action and then watch itself
 * disappear.
 *
 * An attribute rather than each overlay calling `stopPropagation`: the rule
 * belongs to what chrome IS, and the version where every new overlay has to
 * remember it is the version where the next one does not. The drop indicator
 * needs no marker only because it takes no pointer events at all.
 */
export const CHROME_ATTRIBUTE = "data-nx-chrome";

/**
 * The block toolbar's class, drawn by `BlockToolbar`: how the chrome around
 * it, and a test laying it out, find the bar. Here beside the chrome marker
 * rather than in the toolbar's module, which imports a great deal.
 */
export const BLOCK_TOOLBAR_CLASS = "nx-block-toolbar";
