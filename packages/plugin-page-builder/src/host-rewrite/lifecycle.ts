/**
 * Which lifecycle states are public, as the rewrite and its fence ask it.
 *
 * Never by a state's name. A collection's workflow decides which of its states
 * are public, and a team may call one `live` or add a `featured` beside
 * `published`; a comparison with the word `published` reads those as drafts.
 * So there is one rule here, used by the host reader and by the fence alike:
 *
 * - Where a stored row can be asked, core is asked: the stored read gives
 *   the live row's state only when it is one its workflow calls public,
 *   whatever that state is named.
 * - Where it cannot (the status a write is about to store), any named state
 *   counts as possibly public, so the write is judged against the live form
 *   as well as the draft. That refuses more, never less.
 *
 * @module host-rewrite/lifecycle
 */

/**
 * The stored forms a write naming `nextStatus` may change, in the shape
 * `formsChangedBy` answers (`true` is the draft form). A write naming no
 * status changes the draft only; one naming any status may put its value
 * live, and is judged against both.
 */
export function formsAWriteChanges(
  nextStatus: string | undefined
): readonly boolean[] {
  return nextStatus === undefined ? [true] : [false, true];
}
