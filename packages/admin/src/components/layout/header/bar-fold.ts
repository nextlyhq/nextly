/**
 * When an open document's bar folds History, the preview and the panel toggle
 * into its More menu: by the room the bar gives the trail and the controls
 * (the bar less any plugin's header items), never by what the trail happens
 * to say. Where that room is at least this wide, its right part keeps 32rem
 * for the document's controls and the trail truncates into what is left;
 * below it, the controls fold, rather than run past the bar.
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
 * The width, in rem, below which a document's controls fold: the controls'
 * 32rem and a trail's 12rem. In rem, as the classes below are, so the rule
 * holds at any root font size; the script resolves it against the root's.
 */
export const BAR_FOLD_BELOW_REM = 44;

/**
 * The room the trail and a document's controls share, from the width at
 * which nothing folds: the controls keep at least 32rem, so the trail gives
 * way first. Written out in full, as Tailwind reads class names from the
 * source text; `44rem` is {@link BAR_FOLD_BELOW_REM}. Against the
 * `@container/barroom` the bar draws around the trail and its right part,
 * which leaves out a plugin's header items beside them.
 */
export const END_PLACE_ROOM = "@[44rem]/barroom:min-w-[32rem]";

/**
 * Drawn only where the bar does not fold (the outline's panel toggle and its
 * rule), by the same width as {@link BAR_FOLD_BELOW_REM}.
 */
export const UNFOLDED_BAR_ONLY = "@max-[44rem]/barroom:hidden";

/** Marks the room the trail and a document's controls share, which is measured. */
export const BAR_ROOM_ATTRIBUTE = "data-bar-room";

/** How many pixels a rem is on this page: the root element's font size. */
function remPx(): number {
  if (typeof document === "undefined") return 16;
  const size = Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize
  );
  return Number.isFinite(size) && size > 0 ? size : 16;
}

/**
 * Whether a room this wide, in pixels, folds a document's controls into its
 * menu: below {@link BAR_FOLD_BELOW_REM} at this page's root font size.
 */
export function barFolds(roomWidth: number | null): boolean {
  return roomWidth !== null && roomWidth < BAR_FOLD_BELOW_REM * remPx();
}
