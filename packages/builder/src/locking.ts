/**
 * Whether the editor may change, move or delete a block an author has locked.
 *
 * `BlockNode.locked` is the Layers lock: while it is set, nothing changes the
 * block or anything inside it, and the op layer refuses any op that would
 * (`layersLockBreak` in the engine). The editor asks the same question BEFORE
 * offering an action, so a control never offers what the apply then refuses,
 * and the answer comes from the engine's own rule rather than a second reading
 * of the flag here.
 *
 * **One predicate per question, because the command layer is several places.**
 * Delete, the keyboard moves, the toolbar, the canvas drag and the inspector
 * each have to ask, and copies of "is this locked" agree only until one of
 * them gains the subtree rule below.
 *
 * ## A lock covers its subtree
 *
 * A block inside a locked one is locked too, without a flag of its own: it can
 * be neither changed nor moved out, and nothing can be added beside it. And a
 * block HOLDING a locked one cannot be moved or deleted, because moving or
 * deleting it takes the locked block with it, through an action aimed at
 * something else.
 *
 * What stays free is the block around a locked one: a section holding a locked
 * caption can still be restyled, because its own props are not inside the
 * caption.
 *
 * @module locking
 */

import {
  findNode,
  lockedAncestorOf as lockedAncestorIn,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

/** Whether this node itself carries the author's lock. */
export function isLocked(node: BlockNode): boolean {
  return node.locked === true;
}

/**
 * The nearest locked block this one sits inside, or `undefined`. The node's
 * own flag is not read: a block inside a locked one is locked by it.
 *
 * The engine's answer, asked rather than restated.
 */
export function lockedAncestorOf(
  document: BlockDocument,
  id: string
): BlockNode | undefined {
  return lockedAncestorIn(document.nodes, id);
}

/**
 * The locked block that stops this one being CHANGED, or `undefined`: the
 * block itself, or a locked block it sits inside. A locked block further down
 * does not stop it, because a block's own props are not inside its children.
 */
export function lockBlockingEdit(
  document: BlockDocument,
  id: string
): BlockNode | undefined {
  const node = findNode(document.nodes, id);
  if (node === undefined) return undefined;
  return isLocked(node) ? node : lockedAncestorOf(document, id);
}

/**
 * The locked block that stops this one being MOVED, or `undefined`.
 *
 * The block itself or one inside it, outermost first, since the move would
 * carry it; else a locked block it sits inside, since the move would take it
 * out. The op layer refuses both, so offering either move would be offering a
 * refusal.
 */
export function lockBlockingMove(
  document: BlockDocument,
  id: string
): BlockNode | undefined {
  const node = findNode(document.nodes, id);
  if (node === undefined) return undefined;
  return firstLockedIn(node) ?? lockedAncestorOf(document, id);
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
 * The node or anything inside it, else a locked block it sits inside: deleting
 * a block out of a locked one changes what that lock protects. Returns the
 * OUTERMOST locked node inside rather than merely reporting that one exists,
 * because the refusal has to name something an author can act on — "this
 * section holds a locked block" is followed by going and finding it, and the
 * deepest match is the least likely to be the one they meant.
 *
 * The same answer as {@link lockBlockingMove}, asked under its own name
 * because the verb reaches the author: callers word a refusal to delete and a
 * refusal to move differently.
 */
export function lockBlockingDelete(
  document: BlockDocument,
  id: string
): BlockNode | undefined {
  return lockBlockingMove(document, id);
}
