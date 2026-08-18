/**
 * Whether the editor may move or delete a block the author has locked.
 *
 * `BlockNode.locked` is described by the engine as an author-facing policy
 * flag: *"while true, the editor command layer must not let the author move or
 * delete this node"*, and — the half that decides where this module lives —
 * *"system transforms (migrations, overlays, restore) still operate on locked
 * nodes, and the pure tree primitives do not read it."*
 *
 * So the check belongs to the COMMAND layer and nowhere below it. Putting it in
 * `applyOp` would read correctly and be wrong: a restore, a migration or an
 * agent replaying history would start refusing ops on locked nodes, and a lock
 * an author set to protect their own editing would begin blocking the system's
 * own writes.
 *
 * **One predicate, because the command layer is several places.** Delete, the
 * keyboard moves and the canvas drag each have to ask, and three copies of "is
 * this locked" agree until one of them gains the subtree rule below.
 *
 * ## Moving checks the node; deleting checks the subtree
 *
 * They are different questions and the difference is not a nicety.
 *
 * Moving a container that holds a locked child leaves that child exactly where
 * it was relative to its parent — same slot, same index, same neighbours — so
 * the lock is not violated and refusing would make a locked caption freeze the
 * whole section around it.
 *
 * Deleting that container DESTROYS the child. An author who locked a block and
 * then removed its container would lose the thing they locked, which is the one
 * outcome the flag exists to prevent — and it would happen through an action
 * aimed at something else, with the count in the announcement as the only clue.
 *
 * @module locking
 */

import {
  findNode,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

/** Whether this node itself carries the author's lock. */
export function isLocked(node: BlockNode): boolean {
  return node.locked === true;
}

/**
 * The locked node that stops this one being MOVED, or `undefined`.
 *
 * Only the node itself, for the reason in the module docblock.
 */
export function lockBlockingMove(
  document: BlockDocument,
  id: string
): BlockNode | undefined {
  const node = findNode(document.nodes, id);
  if (node === undefined) return undefined;
  return isLocked(node) ? node : undefined;
}

/** The first locked node in a subtree, walking outermost first. */
function firstLockedIn(node: BlockNode): BlockNode | undefined {
  if (isLocked(node)) return node;
  for (const children of Object.values(node.slots ?? {})) {
    for (const child of children) {
      const found = firstLockedIn(child);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * The locked node that stops this one being DELETED, or `undefined`.
 *
 * The node or anything inside it. Returns the OUTERMOST locked node rather than
 * merely reporting that one exists, because the refusal has to name something
 * an author can act on — "this section holds a locked block" is followed by
 * going and finding it, and the deepest match is the least likely to be the one
 * they meant.
 */
export function lockBlockingDelete(
  document: BlockDocument,
  id: string
): BlockNode | undefined {
  const node = findNode(document.nodes, id);
  if (node === undefined) return undefined;
  return firstLockedIn(node);
}
