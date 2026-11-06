/**
 * Putting blocks into a document while keeping the Layers locks they carry.
 *
 * `applyOp` refuses an insert whose subtree arrives locked, because the inverse
 * of an insert is a remove and a remove refuses a locked subtree, so such an
 * insert could never be undone. That rule is right, and taken literally it
 * makes every copy of a locked block impossible: a pattern saved with a locked
 * block could be placed nowhere, and a locked block could not be duplicated.
 *
 * So the lock is neither carried on the insert nor discarded: the nodes arrive
 * unlocked and an update locks each one where it landed. The group ends in the
 * state the copy describes, and it stays undoable because inverses are applied
 * in reverse order: the unlock runs before the remove, so the remove never
 * meets a locked node. One sequence for every caller that copies blocks in,
 * so a pattern, a component and a duplicate keep their locks the same way.
 *
 * @module locked-insert
 */
import type { BlockNode } from "./document";
import type { BuilderOp, OpPosition } from "./ops";
import { mapForest } from "./tree";

/** One block to put in, and where. */
export interface Placed {
  readonly node: BlockNode;
  readonly at: OpPosition;
}

/**
 * The ops that put each block in, in order, then lock every block that
 * arrived locked. Each position is the caller's, computed against the
 * document as it will be when that insert runs.
 */
export function insertKeepingLocks(placed: readonly Placed[]): BuilderOp[] {
  const ops: BuilderOp[] = [];
  const lockedIds: string[] = [];
  for (const { node, at } of placed) {
    const unlocked = withoutLocks(node, lockedIds);
    ops.push({ kind: "insert", node: unlocked, at });
  }
  for (const id of lockedIds) {
    ops.push({ kind: "update", id, patch: { locked: true } });
  }
  return ops;
}

/**
 * A subtree with every lock removed, adding the ids that carried one.
 *
 * Through the shared forest rewrite rather than a walk of its own, which
 * already knows what to do about a cycle and a malformed entry or slot. Only
 * `locked` moves; every other field is carried across untouched.
 */
function withoutLocks(root: BlockNode, lockedIds: string[]): BlockNode {
  const [unlocked] = mapForest([root], node => {
    if (node.locked !== true) return node;
    lockedIds.push(node.id);
    const { locked: _locked, ...rest } = node;
    return rest;
  });
  return unlocked ?? root;
}
