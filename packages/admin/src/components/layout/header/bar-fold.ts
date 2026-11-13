/**
 * When an open document's bar folds History, the preview and the panel toggle
 * into its More menu: by the admin bar's own width alone, never by what the
 * trail beside the controls happens to say. Where the bar is at least this
 * wide, its right part keeps 32rem for the document's controls and the trail
 * truncates into what is left; below it, the controls fold.
 *
 * One rule for the bar and for the editor's outline drawn in its place, so
 * the outline folds exactly where the bar will, and the bar's More never
 * stands somewhere the outline's did not.
 *
 * Imports nothing, so the outline drawn in the admin's first frame reads it
 * without pulling the bar's code in with it.
 *
 * @module components/layout/header/bar-fold
 */

/**
 * The bar's width, in pixels, below which a document's controls fold: the
 * controls' 32rem and a trail's 12rem with the bar's own padding.
 */
export const BAR_FOLD_BELOW_PX = 704;

/**
 * The bar's right part, from the width at which nothing folds: at least
 * 32rem, so the trail gives way first. Written out in full, as Tailwind reads
 * class names from the source text; `44rem` is {@link BAR_FOLD_BELOW_PX}.
 */
export const END_PLACE_ROOM = "@[44rem]/topbar:min-w-[32rem]";

/**
 * Drawn only where the bar does not fold (the outline's panel toggle and its
 * rule), by the same width as {@link BAR_FOLD_BELOW_PX}.
 */
export const UNFOLDED_BAR_ONLY = "@max-[44rem]/topbar:hidden";

/** Whether a bar this wide folds a document's controls into its menu. */
export function barFolds(barWidth: number | null): boolean {
  return barWidth !== null && barWidth < BAR_FOLD_BELOW_PX;
}
