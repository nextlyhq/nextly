/**
 * The style state the inspector edits, which is `base` unless a setter came
 * with it; the tab a mount opens on for it; and the change of tab that returns
 * the canvas to `base` when the author leaves the Style tab.
 *
 * @module inspector-style-state
 */

import type { StyleState } from "@nextlyhq/blocks-engine";

import type { StyleStateBinding } from "./inspector-panel-types";

/**
 * The Style tab's own handler for a change of tab.
 *
 * Drops the forced interaction state when the author leaves the Style tab.
 *
 * The one real cost of placing the state control inside the Style tab is that
 * it goes off screen with the tab, so a state left switched on becomes a canvas
 * disagreeing with everything visible — the author edits the text of a button
 * drawn mid-press, with no control on screen saying why. Dropping it here
 * removes that state rather than documenting it.
 *
 * On the CHANGE rather than in an effect keyed on the tab: an effect would also
 * fire on mount and on any re-render that reasserted the same tab, which would
 * fight a host restoring a state deliberately. This runs exactly when a person
 * leaves the tab.
 */
/**
 * The state the panel actually edits, which is `base` unless a setter came with
 * it.
 *
 * The binding permits a state without an `onChange`, and that shape has to mean
 * something rather than being merely allowed. Read literally it is a state
 * nobody can leave: the switcher is withheld because nothing could act on a
 * choice, the tab handler has no callback to return the canvas with, and every
 * control below would go on reading and writing a state with no visible control
 * saying which one — the exact arrangement this panel's contract exists to
 * prevent, reached through the type instead of through a miswiring.
 *
 * Normalised rather than refused, because a host part-way through adopting the
 * control should get a working base editor rather than a broken one.
 */
export function editedStyleState(
  binding: StyleStateBinding | undefined
): StyleState {
  if (binding?.onChange === undefined) return "base";
  return binding.state ?? "base";
}

/**
 * Which tab a mount opens on, given the state the host restored.
 *
 * `content` unless a state is in effect, which is the ordinary case and the
 * behaviour every existing caller already has: a host that names no state, or
 * names `base`, or supplies no setter — in which case {@link editedStyleState}
 * has already resolved the state to `base` and there is nothing to explain.
 */
export function openingTabFor(binding: StyleStateBinding | undefined): string {
  return editedStyleState(binding) === "base" ? "content" : "style";
}

export function tabChangeHandler(
  setTab: (next: string) => void,
  onStyleStateChange: ((state: StyleState) => void) | undefined
): (next: string) => void {
  return next => {
    setTab(next);
    if (next !== "style") onStyleStateChange?.("base");
  };
}
