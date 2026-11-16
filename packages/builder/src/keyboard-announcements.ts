/**
 * The keys a selected block is moved with, and what each keyboard action
 * says: a move's effect, a deletion and how to undo it, and why a locked
 * block would not move.
 *
 * @module keyboard-announcements
 */

import type { EditorState } from "./editor-state";
import type { MoveDirection, MoveEffect } from "./keyboard-move";
import { lockRefusalWording } from "./lock-refusal";
import { refusalAnnouncement } from "./move-refusal";
import type { BuilderOp } from "./op-vocabulary";

/**
 * The bindings, and why these keys.
 *
 * `alt+ArrowUp`/`alt+ArrowDown` is the line-move gesture from VS Code and the
 * editors that copied it, so it arrives already known rather than needing to be
 * taught. `alt+ArrowLeft`/`alt+ArrowRight` follows the indent convention every
 * outliner and list editor shares, and it matches the axis the rule itself
 * names — `indent` and `outdent` are its own words for the effect.
 *
 * Deliberately NOT Gutenberg's `mod+shift+alt+T`/`Y`. A four-key chord for the
 * commonest structural edit in the editor is undiscoverable and awkward on a
 * laptop, and the two letters carry no relationship to the direction they move.
 */
export const MOVE_KEYS: ReadonlyArray<{
  keys: string;
  direction: MoveDirection;
  description: string;
}> = [
  {
    keys: "alt+ArrowUp",
    direction: "up",
    description: "Move the selected block up",
  },
  {
    keys: "alt+ArrowDown",
    direction: "down",
    description: "Move the selected block down",
  },
  {
    keys: "alt+ArrowRight",
    direction: "indent",
    description: "Move the selected block into the container above it",
  },
  {
    keys: "alt+ArrowLeft",
    direction: "outdent",
    description: "Move the selected block out of its container",
  },
];

/**
 * What each effect is announced as.
 *
 * Derived from the effect the rule already decided rather than inferred here
 * from the direction pressed. `alt+ArrowLeft` is `outdent` only when there is a
 * container to leave, and re-deriving it from the keystroke would announce a
 * move out of a group that never happened.
 *
 * Three sentences rather than one, because the three are not the same event to
 * someone who cannot see the result: reordering keeps a block among its
 * siblings, while indenting and outdenting change which block CONTAINS it.
 */
export const EFFECT_ANNOUNCEMENT: Readonly<Record<MoveEffect, string>> = {
  reorder: "Block moved",
  indent: "Block moved into the container above it",
  outdent: "Block moved out of its container",
};

/**
 * How a deletion is announced.
 *
 * Names what went AND how to get it back. A screen-reader user cannot see an
 * undo control, so for them the announcement is the only place the recovery
 * path exists — and a container takes its children with it, which is invisible
 * from the block they had selected: a collapsed section looks exactly like an
 * empty one.
 *
 * The count is stated rather than prompted for. A confirmation on every delete
 * is friction people learn to click through, so it stops being a decision and
 * becomes a keystroke — protecting nobody while costing everybody. That trade
 * only holds because undo is reachable, which is why these ship together.
 */
/**
 * @param name - what to CALL the block, already resolved by the caller.
 *
 * A resolved name rather than a type, so the one rule that decides what a block
 * is called lives in `layerLabel` and this only phrases it. Taking a type and
 * resolving here would put a second resolution in the one surface a
 * screen-reader user hears — and it would have to reach for `blockLabel`, which
 * knows nothing about the name the author gave this instance.
 */
export function deletionAnnouncement(
  name: string,
  descendants: number
): string {
  const what =
    descendants === 0
      ? `${name} deleted`
      : `${name} deleted, with ${descendants} ${descendants === 1 ? "block" : "blocks"} inside`;
  return `${what}. Undo with ${UNDO_KEYS_SPOKEN}.`;
}

/** How the undo shortcut is READ ALOUD, which is not how it is parsed. */
export const UNDO_KEYS_SPOKEN = "Control or Command Z";

/**
 * The shared verb list, or `null` when there is no provider above.
 *
 * Deliberately NOT "compute it for me": a caller that handed this a fallback to
 * run would have to be told when to run it, and the honest answer — whenever
 * anything the fallback closes over changes — is exactly what this hook cannot
 * see. Written that way it memoised on the context alone, so a surface outside a
 * provider kept its FIRST answer for ever: stale availability and stale refusal
 * reasons on every later selection.
 *
 * Answering `null` hands that decision back to the caller, which is the only
 * place the inputs are known.
 */
/**
 * The sentence for ops the editor's locks refuse, or null when they keep every
 * lock: the editor's own question, worded as every lock refusal is.
 */
export function lockSentence(
  editor: Pick<EditorState, "lockRefusalFor">,
  ops: readonly BuilderOp[]
): string | null {
  const found = editor.lockRefusalFor(ops);
  return found === undefined
    ? null
    : refusalAnnouncement(lockRefusalWording(found));
}
