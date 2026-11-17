/**
 * The style state the inspector edits, which is `base` unless a setter came
 * with it; the tab a mount opens on for it; and the tab the panel shows for
 * the selected block.
 *
 * @module inspector-style-state
 */

import type { StyleState } from "@nextlyhq/blocks-engine";

import type { StyleStateBinding } from "./inspector-panel-types";

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

/**
 * The tab the panel shows: the one the author chose, where the selected
 * block has it, and the block's first tab otherwise.
 *
 * The author's choice is kept apart from what is shown, so a block without
 * their tab (a Spacer has no Content) shows its first and the next block
 * that has it shows theirs again: an author styling one block after another
 * stays on Style however many blocks without Content they pass through.
 *
 * @param chosen - the tab the author last chose, or the one a mount opened on
 * @param available - the selected block's tabs, in order
 */
export function shownTab(chosen: string, available: readonly string[]): string {
  if (available.includes(chosen)) return chosen;
  return available[0] ?? "content";
}
