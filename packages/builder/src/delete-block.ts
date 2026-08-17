/**
 * Deleting the selected block: what it takes with it, and where the author is
 * left.
 *
 * Pure, and separate from the keys that ask for it, for the reason every other
 * rule in this package is: none of it needs React, and all of it is worth
 * asserting. A component test in jsdom cannot tell a correct
 * where-does-selection-go answer from a plausible wrong one, because both
 * render a canvas with one fewer block.
 *
 * **Selection is the whole difficulty.** Removing a node is one op; deciding
 * what an author is looking at afterwards is a judgement, and getting it wrong
 * is felt hardest by the keyboard-only author this axis exists for. Clearing
 * the selection is safe and costs them their place — they must find the canvas
 * again and re-select before they can do anything else, after an action they
 * took deliberately.
 *
 * @module delete-block
 */

import {
  countNodes,
  locateNode,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { SlotAddress } from "./ops";

/** A deletion, with everything a caller needs to describe and apply it. */
export interface BlockDeletion {
  /** The node to remove. */
  readonly id: string;
  /** The block type, for naming what was removed. */
  readonly type: string;
  /**
   * The slot the block is vacating, when removing it may empty one.
   *
   * A request rather than a command: the store drops the slot only if it is
   * actually empty afterwards. Without it, deleting the last child of a
   * container leaves an empty slot the page-builder validator rejects.
   */
  readonly dropSlotIfEmpty?: SlotAddress;
  /**
   * What to select once the block is gone.
   *
   * Carried with the deletion rather than recomputed after applying it. Once the
   * node is removed there is nothing left to derive a neighbour FROM, so a
   * caller asking afterwards would be asking a document that no longer contains
   * the subject.
   */
  readonly nextSelection: string | null;
  /**
   * How many blocks go with it, not counting the block itself.
   *
   * A container takes its children, and that is not visible from the block an
   * author has selected — a collapsed section looks exactly like an empty one.
   * Carried so the deletion can be STATED rather than gated behind a
   * confirmation: undo covers it, and a prompt on every delete is friction
   * people learn to click through without reading.
   */
  readonly descendantCount: number;
}

/**
 * Where the author is left after a block is removed.
 *
 * **Next sibling first, and the case that decides it is REPEATED deletion** —
 * which is what clearing a section actually is. From `[a, b, c]` with `b`
 * selected: choosing the previous sibling selects `a`, so a second press
 * destroys a block the author already passed and approved. Choosing the next
 * selects `c`, so a second press continues forward through what they were
 * heading toward. One gesture eats work behind you; the other does not.
 *
 * Gutenberg selects the previous block, for a reason that does not transfer:
 * its Backspace is a text-merge — you delete at the START of a block and carry
 * on typing in the one before it, so the caret must travel backward. A canvas
 * with an explicit delete key is list management rather than text editing, and
 * every list-deletion surface people already use — file managers, mail
 * clients, task lists — moves forward.
 *
 * Then the previous sibling, when the block was last. Then the parent, when it
 * was an only child: the container is where the author was working, and one
 * more press deletes it, which is a coherent next action rather than a dead
 * end.
 *
 * `null` only at the top level with nothing left, which is the one case with
 * genuinely nowhere to be.
 */
function selectionAfter(
  siblings: readonly BlockNode[],
  index: number,
  parent: BlockNode | undefined
): string | null {
  const next = siblings[index + 1];
  if (next !== undefined) return next.id;
  const previous = siblings[index - 1];
  if (previous !== undefined) return previous.id;
  return parent?.id ?? null;
}

/** The list a located node actually sits in, or undefined when it has none. */
function siblingsOf(
  nodes: BlockNode[],
  parent: BlockNode | undefined,
  slot: string | undefined
): BlockNode[] | undefined {
  if (parent === undefined) return nodes;
  if (slot === undefined) return undefined;
  return parent.slots?.[slot];
}

/**
 * Describe deleting the selected block, or `null` when there is nothing to
 * delete.
 *
 * `null` for an absent selection and for an id the document no longer holds —
 * a stale id after an undo, or a selection made against a document that has
 * since been replaced. Both mean the same thing to a caller: there is no
 * deletion to perform, so nothing should be applied or announced.
 *
 * **A returned deletion is not permission.** Validity and locking belong to the
 * store, so a caller must handle a refusal rather than assume this will apply.
 */
export function blockDeletion(
  document: BlockDocument,
  selectedId: string | null
): BlockDeletion | null {
  if (selectedId === null) return null;

  const here = locateNode(document.nodes, selectedId);
  if (here === undefined) return null;

  const siblings = siblingsOf(document.nodes, here.parent, here.slot);
  if (siblings === undefined) return null;

  const node = siblings[here.index];
  if (node === undefined) return null;

  // The subtree's own size, less the node itself. `countNodes` walks slots, so
  // this is every descendant at any depth rather than the immediate children —
  // which is what actually disappears.
  const descendantCount = countNodes([node]) - 1;

  const dropSlotIfEmpty =
    here.parent !== undefined && here.slot !== undefined
      ? { parentId: here.parent.id, slot: here.slot }
      : undefined;

  return {
    id: selectedId,
    type: node.type,
    ...(dropSlotIfEmpty === undefined ? {} : { dropSlotIfEmpty }),
    nextSelection: selectionAfter(siblings, here.index, here.parent),
    descendantCount,
  };
}
