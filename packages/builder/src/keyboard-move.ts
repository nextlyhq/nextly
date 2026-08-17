/**
 * Where a block goes when the author moves it with the keyboard.
 *
 * Dragging is the only way to reorder a block today, which means the editor is
 * unusable by anyone who does not use a pointer — a keyboard user, a switch
 * user, anyone driving the page through a screen reader. That is an
 * accessibility gap rather than a missing convenience, and it is not closed by
 * making the drag easier.
 *
 * **Two axes, not one.** Order and depth are separate questions, and each key
 * answers exactly one of them:
 *
 * - `up` / `down` — reorder among siblings. Never changes the parent.
 * - `indent` / `outdent` — change the parent. Never reorders among the blocks
 *   that stay put.
 *
 * @remarks
 * **Why this is two axes rather than one key that does both.** The tempting
 * design is a single up/down that reorders in the middle of a container and
 * steps OUT at its ends, so one key does everything. It was built that way
 * first, and its round-trip test refuted it: a block that steps out of a
 * container on `down` does not step back in on `up`, because passing a container
 * and entering it are different intents and one key cannot mean both. Every
 * press being undone by the opposite press is not a nicety here — it is what
 * lets someone driving the editor without sight of the result recover from a
 * mistaken key. A gesture with no inverse costs exactly the people this exists
 * for.
 *
 * Split across two axes, each operation has an inverse in its own axis:
 * `up` undoes `down`, and `outdent` undoes `indent`, including the nesting.
 *
 * **One asymmetry, stated because it is real and not a defect to fix here.**
 * `indent` appends to the end of the container above, so it cannot know where in
 * that container a previously-outdented block came from. Outdenting a block that
 * was NOT its container's last child therefore loses its position within the
 * slot, and a single `indent` returns it at the end. Recovering the original
 * index would mean carrying state across presses, which a pure position function
 * cannot do and which would make each key's effect depend on invisible history.
 * Every outliner behaves this way. It is pinned by a test rather than left to be
 * met in a bug report.
 *
 * **This is the outliner convention** — arrows reorder, Tab and Shift-Tab
 * change depth — which is worth following because it is what an author who has
 * used any nested-list editor already expects, and because it is the arrangement
 * that makes both axes total: every position is reachable, and every move is
 * reversible.
 *
 * **This module answers WHERE, never WHETHER.** Locking, validity and cycles are
 * enforced by the op store, which already owns them; asking here would be a
 * second implementation of a question that has one. The consequence is real and
 * repeated in {@link keyboardMovePosition}: a position returned here can still
 * be refused, so the wiring must handle a refusal rather than assume a non-null
 * result will apply.
 *
 * **Which KEYS produce these directions is not decided here.** This module names
 * intents; the binding is the wiring's, and belongs with whatever shortcut
 * resolver the editor already has rather than in a second listener.
 *
 * Pure and dependency-light: a forest, an id and a direction in, a position out.
 * No DOM, no React, no event handling.
 *
 * @module keyboard-move
 */
import { locateNode, type BlockNode } from "@nextlyhq/blocks-engine";

import type { OpPosition, SlotAddress } from "./ops";

/**
 * What the author asked for.
 *
 * `indent` makes the block the last child of the sibling above it; `outdent`
 * makes it the next sibling of its parent. Those two are inverses, which is the
 * property the whole design rests on.
 */
export type MoveDirection = "up" | "down" | "indent" | "outdent";

/** The default slot a block enters when it is indented into a container. */
const DEFAULT_SLOT = "default";

/**
 * What a move does, beyond where it lands.
 *
 * A bare position cannot say whether the block stayed among its siblings or
 * changed parent, and the difference is the whole thing a keyboard author cannot
 * see. Someone driving the editor through a screen reader needs "moved down" and
 * "moved into Group" announced differently, and the focus draw needs to know the
 * block left its container. Deriving it in the wiring by comparing parents
 * before and after would be a second implementation of a decision this function
 * has already made.
 */
export type MoveEffect = "reorder" | "indent" | "outdent";

/** Where a block goes, what that does, and what it leaves behind. */
export interface KeyboardMove {
  /** The position, in the shape the op store's `move` consumes. */
  readonly to: OpPosition;
  readonly effect: MoveEffect;
  /**
   * The slot the block is leaving, when leaving it may empty it.
   *
   * Supplied for the depth axis only, because `up` and `down` land the block in
   * the container it started in and vacate nothing. Without it, moving the last
   * child out of a container leaves an empty slot the page-builder validator
   * rejects — and a keyboard author meets that far sooner than a pointer one,
   * because they move a single block at a time.
   *
   * A request rather than a command: the store drops the slot only if it is
   * actually empty afterwards, so a slot something else has filled stays.
   */
  readonly dropSlotIfEmpty?: SlotAddress;
}

/** The slot a node is vacating, when it sits in one. */
function vacating(
  parent: BlockNode | undefined,
  slot: string | undefined
): SlotAddress | undefined {
  if (parent === undefined || slot === undefined) return undefined;
  return { parentId: parent.id, slot };
}

/**
 * The list a located node actually sits in.
 *
 * Derived from the location rather than re-walked: `locateNode` already decided
 * which container holds the node, and a second walk that disagreed with it would
 * produce an index into a list the node is not in.
 */
function siblingsOf(
  nodes: BlockNode[],
  parent: BlockNode | undefined,
  slot: string | undefined
): BlockNode[] | undefined {
  if (parent === undefined) return nodes;
  if (slot === undefined) return undefined;
  return parent.slots?.[slot];
}

/** A position addressing a container, or `null` when it cannot be addressed. */
function positionIn(
  parent: BlockNode | undefined,
  slot: string | undefined,
  index: number
): OpPosition | null {
  if (parent === undefined) return { index };
  // A slot position must name its slot. The engine's `moveNode` silently
  // declines one that does not, so returning it would read as a key that does
  // nothing rather than as the malformed request it is.
  if (slot === undefined) return null;
  return { parentId: parent.id, slot, index };
}

/**
 * Where the selected block lands if the author moves it one step.
 *
 * @param nodes - the document's top-level blocks
 * @param selectedId - the block the author has selected
 * @param direction - which move they asked for
 * @returns the position to move it to, or `null` when that move is not
 * available — the id is not in the document, the block is already at the end of
 * its container, there is no sibling above it to indent into, or it is already
 * at the top level and cannot outdent further.
 *
 * @remarks
 * **Indices are stated as the op store consumes them, which is AFTER the node
 * has been removed.** `moveNode` removes and then re-inserts, so a same-list
 * step down to `index + 1` is a move of one place rather than two: taking the
 * node out shifts every later sibling back by one, which exactly absorbs the
 * difference. Written against a store that inserted before removing, the same
 * arithmetic would skip a sibling going down and be correct going up — a defect
 * that appears in only one direction.
 *
 * The same removal is why `indent` targets the previous sibling's child count
 * unadjusted: the node leaves a DIFFERENT list from the one it arrives in, so
 * that list's length does not change under it.
 *
 * **A returned position is not permission.** Locking and validity belong to the
 * store, so a caller must handle a refusal rather than assume this will apply.
 */
export function keyboardMovePosition(
  nodes: BlockNode[],
  selectedId: string,
  direction: MoveDirection
): KeyboardMove | null {
  const here = locateNode(nodes, selectedId);
  if (here === undefined) return null;

  const siblings = siblingsOf(nodes, here.parent, here.slot);
  if (siblings === undefined) return null;

  if (direction === "up" || direction === "down") {
    const target = here.index + (direction === "up" ? -1 : 1);
    // Refused at the ends rather than escaping the container. Escaping is the
    // other axis, and doing it here is what cost the inverse.
    if (target < 0 || target >= siblings.length) return null;
    const to = positionIn(here.parent, here.slot, target);
    // Reordering lands in the container it started in, so nothing is vacated.
    return to === null ? null : { to, effect: "reorder" };
  }

  if (direction === "outdent") {
    // Already at the top level: there is no parent to become a sibling of.
    if (here.parent === undefined) return null;

    const outer = locateNode(nodes, here.parent.id);
    if (outer === undefined) return null;

    // AFTER the parent, so that indenting back in returns the block to where it
    // started. Removing it from inside the parent does not move the parent, so
    // this index needs no correction.
    const to = positionIn(outer.parent, outer.slot, outer.index + 1);
    if (to === null) return null;
    return {
      to,
      effect: "outdent",
      dropSlotIfEmpty: vacating(here.parent, here.slot),
    };
  }

  // Indent: become the last child of the sibling immediately above.
  const above = siblings[here.index - 1];
  // Nothing above, so there is nothing to indent into. The first block in a
  // container has no parent-to-be that would not be itself.
  if (above === undefined) return null;

  // The block lands in the default slot. A container that already uses a
  // different slot name keeps it for the children it has; this one addresses
  // the slot a keyboard author can reach without choosing between regions they
  // cannot see.
  const into = above.slots?.[DEFAULT_SLOT];
  return {
    to: {
      parentId: above.id,
      slot: DEFAULT_SLOT,
      index: into?.length ?? 0,
    },
    effect: "indent",
    dropSlotIfEmpty: vacating(here.parent, here.slot),
  };
}
