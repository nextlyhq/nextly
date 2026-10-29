/**
 * The `data-shell-answers` marker the shell's regions carry: "pending" until the answers a region
 * draws from are in, then "settled". A reader of the page, such as the layout-shift browser test,
 * waits until no region is pending before it judges whether the shell moved.
 *
 * @module components/layout/lib/shell-answers
 */

/** The marker's value for a region whose answers are, or are not yet, all in. */
export function shellAnswersMarker(settled: boolean): "settled" | "pending" {
  return settled ? "settled" : "pending";
}
