/**
 * Delete, duplicate and lock, for a selection that may hold more than one block.
 *
 * Each verb is planned as a GROUP of ops that the store applies atomically, so
 * an edit across six blocks costs one undo and either happens completely or not
 * at all.
 *
 * ## Every rule is the single-block one, asked repeatedly
 *
 * `blockDeletion`, `blockDuplication` and `lockOp` already decide what removing
 * or copying ONE block means, including what a lock forbids and where a copy
 * goes. Nothing here re-decides any of that. A second implementation would
 * eventually disagree with the toolbar and the keyboard, which act on one block
 * through those same functions.
 *
 * ## Order is load-bearing, and differently for each verb
 *
 * **Duplicating runs in REVERSE document order.** Each copy is inserted
 * immediately after its original, and inserting shifts every later sibling
 * along — so planning `[a, b, c]` forwards computes b's position against a
 * document that a's copy has already changed, and the second copy lands in the
 * wrong place. Reversed, every insert happens after the positions still to be
 * used, and each one is correct when it applies.
 *
 * **Moving runs TOWARDS the edge it is heading for**: ascending for `up`,
 * descending for `down`. A move vacates the index it leaves, so the block
 * nearest the destination has to go first — planning `up` from the bottom of
 * the run would step a block into a place its neighbour has not left yet.
 * Taken in the right order, each move swaps a pair of adjacent positions that
 * no later move in the group addresses, so every target computed against the
 * original document is still correct when it applies.
 *
 * **Deleting does not care**, and that is worth stating so nobody "fixes" it:
 * a remove addresses a node by id, ids do not move, and the op layer derives
 * each inverse from the document it was applied to. Both orders round-trip.
 * Document order is used anyway, so a group is deterministic.
 *
 * @module selection-ops
 */

import {
  siblingRun,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { blockDeletion } from "./delete-block";
import { blockDuplication } from "./duplicate-block";
import { lockOp } from "./inspector";
import { keyboardMovePosition } from "./keyboard-move";
import { layerLabel } from "./layers";
import { lockBlockingDelete, lockBlockingMove } from "./locking";
import type { BuilderOp } from "./ops";
import { normalizeSelection } from "./selection";

/** A planned group, with what to say about it. */
export interface SelectionEdit {
  /** The ops, in the order they must apply. */
  readonly ops: readonly BuilderOp[];
  /** How many blocks the author selected, for phrasing. */
  readonly count: number;
  /**
   * How many blocks travel INSIDE the selected ones, across the whole group.
   *
   * Reported because a container takes its children with it and that is
   * invisible from the block an author had selected — a collapsed section looks
   * exactly like an empty one. Summed across the group rather than per block,
   * since the announcement describes one action.
   */
  readonly descendants: number;
  /**
   * What to select once the group is gone, or `null` when nothing is left.
   *
   * A delete that left nothing selected would drop the author out of the
   * inspector and the toolbar for a reason they did not ask for. Taken from the
   * single-block rule's own `nextSelection`, skipping any candidate that is
   * itself being deleted — with a run of siblings removed together, most of
   * them name each other.
   */
  readonly nextSelection: string | null;
  /** What to call the subject: the block's name, or "3 blocks". */
  readonly subject: string;
}

/** What stopped an edit, phrased for an author. */
export interface SelectionRefusal {
  readonly reason: string;
}

/** Either a plan or the reason there is none. */
export type SelectionPlan = SelectionEdit | SelectionRefusal | null;

/**
 * Whether a plan can be applied.
 *
 * Accepts any planned edit rather than only a {@link SelectionPlan}, because
 * every verb here answers with the same three-way shape and a caller should not
 * need a different guard per verb. The `reason` field is what separates a
 * refusal, and only a refusal carries one.
 */
export function isRefusal(
  plan: SelectionEdit | SelectionMove | SelectionRefusal | null
): plan is SelectionRefusal {
  return plan !== null && "reason" in plan;
}

/** "Hero title", or "3 blocks" once there is more than one. */
function subjectOf(document: BlockDocument, ids: readonly string[]): string {
  if (ids.length !== 1) return `${ids.length} blocks`;
  const only = ids[0];
  const node = only === undefined ? undefined : findIn(document.nodes, only);
  return node === undefined ? "1 block" : layerLabel(node);
}

function findIn(
  nodes: readonly BlockNode[],
  id: string
): BlockNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    for (const children of Object.values(node.slots ?? {})) {
      const found = findIn(children, id);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * Removing every selected block.
 *
 * **One lock refuses the WHOLE group**, and that follows from the group being
 * atomic rather than being a separate policy: there is no half-done delete to
 * fall back to, so the choice is all or nothing, and silently skipping the
 * locked one would leave an author who selected six blocks looking at one they
 * did not notice surviving.
 */
/**
 * The lock that stops this group being deleted, phrased, or `null`.
 *
 * Scanned across the WHOLE group before anything is planned, because the group
 * is atomic: the answer is all or nothing, so it has to be known before the
 * first op exists.
 */
function lockRefusal(
  document: BlockDocument,
  ids: readonly string[]
): SelectionRefusal | null {
  for (const id of ids) {
    const blocked = lockBlockingDelete(document, id);
    if (blocked === undefined) continue;
    const name = layerLabel(blocked);
    return {
      reason:
        blocked.id === id
          ? `${name} is locked. Unlock it to delete it.`
          : `The selection contains ${name}, which is locked. Unlock it to delete.`,
    };
  }
  return null;
}

/** The removals themselves, with what the announcement and the selection need. */
function removals(
  document: BlockDocument,
  ids: readonly string[]
): {
  ops: BuilderOp[];
  descendants: number;
  nextSelection: string | null;
} {
  const ops: BuilderOp[] = [];
  const candidates: string[] = [];
  const removing = new Set(ids);
  let descendants = 0;

  for (const id of ids) {
    const deletion = blockDeletion(document, id);
    // `null` means the document no longer holds it, which `normalizeSelection`
    // has already excluded — so this is unreachable rather than tolerated, and
    // skipping is the safe reading if it ever is not.
    if (deletion === null) continue;
    descendants += deletion.descendantCount;
    if (
      deletion.nextSelection !== null &&
      !removing.has(deletion.nextSelection)
    ) {
      candidates.push(deletion.nextSelection);
    }
    ops.push({
      kind: "remove",
      id: deletion.id,
      ...(deletion.dropSlotIfEmpty === undefined
        ? {}
        : { dropSlotIfEmpty: deletion.dropSlotIfEmpty }),
    });
  }

  return { ops, descendants, nextSelection: candidates[0] ?? null };
}

/**
 * Removing every selected block.
 *
 * **One lock refuses the WHOLE group**, and that follows from the group being
 * atomic rather than being a separate policy: there is no half-done delete to
 * fall back to, so the choice is all or nothing, and silently skipping the
 * locked one would leave an author who selected six blocks looking at one they
 * did not notice surviving.
 */
export function selectionDeletion(
  document: BlockDocument,
  selectedIds: readonly string[]
): SelectionPlan {
  const ids = normalizeSelection(document, selectedIds);
  if (ids.length === 0) return null;

  const refusal = lockRefusal(document, ids);
  if (refusal !== null) return refusal;

  const { ops, descendants, nextSelection } = removals(document, ids);
  if (ops.length === 0) return null;

  return {
    ops,
    count: ids.length,
    descendants,
    nextSelection,
    subject: subjectOf(document, ids),
  };
}

/** A duplication, with the ids the copies will have. */
export interface SelectionDuplication extends SelectionEdit {
  /** The copies, in document order, for selecting them afterwards. */
  readonly newIds: readonly string[];
}

/**
 * Copying every selected block, each beside its original.
 *
 * A lock does NOT refuse this: duplicating neither moves nor removes the
 * original, and refusing would mean an author could not copy the blocks they
 * had most deliberately protected. The copies carry the lock, as they do for a
 * single block.
 */
export function selectionDuplication(
  document: BlockDocument,
  selectedIds: readonly string[]
): SelectionDuplication | null {
  const ids = normalizeSelection(document, selectedIds);
  if (ids.length === 0) return null;

  const ops: BuilderOp[] = [];
  const newIds: string[] = [];
  // Reversed — see the module docblock. Forwards, the second copy's position is
  // computed against a document the first copy has already shifted.
  for (const id of [...ids].reverse()) {
    const duplication = blockDuplication(document, id);
    if (duplication === null) continue;
    ops.push({ kind: "insert", node: duplication.node, at: duplication.at });
    // Unshifted, so the ids come back in document order even though the ops go
    // out in reverse. A caller selecting the copies wants them the way a reader
    // meets them, not the way they were planned.
    newIds.unshift(duplication.node.id);
  }

  if (ops.length === 0) return null;
  return {
    ops,
    newIds,
    count: ids.length,
    descendants: 0,
    nextSelection: null,
    subject: subjectOf(document, ids),
  };
}

/**
 * Locking or unlocking every selected block.
 *
 * Order-independent: each op addresses one node and changes only its own flag.
 */
export function selectionLock(
  document: BlockDocument,
  selectedIds: readonly string[],
  locked: boolean
): SelectionEdit | null {
  const ids = normalizeSelection(document, selectedIds);
  if (ids.length === 0) return null;

  /*
   * Only the blocks this would actually change.
   *
   * `applyOp` REFUSES an update that writes what a node already holds — "a
   * history entry for it would undo to no visible effect" — and a group is
   * applied atomically, so a single already-locked block would abort the whole
   * edit and lock nothing. That is not hypothetical: locking a MIXED selection
   * is the ordinary case, and every one of them contains a block already in the
   * target state.
   *
   * Filtering here rather than loosening the op layer, because that rule is
   * right: an op that changes nothing does not belong on the undo stack. What
   * was wrong was planning one.
   */
  const changing = ids.filter(id => {
    const node = findIn(document.nodes, id);
    return node !== undefined && (node.locked === true) !== locked;
  });
  if (changing.length === 0) return null;

  return {
    ops: changing.map(id => lockOp(id, locked)),
    count: ids.length,
    descendants: 0,
    nextSelection: null,
    subject: subjectOf(document, ids),
  };
}

/** A planned reorder, with what to say about it. */
export interface SelectionMove {
  /** The moves, in the order they must apply. */
  readonly ops: readonly BuilderOp[];
  /** How many blocks the author selected, for phrasing. */
  readonly count: number;
  /** What to call the subject: the block's name, or "3 blocks". */
  readonly subject: string;
}

/** Either a reorder, the reason there is none, or `null` for nothing to say. */
export type SelectionMovePlan = SelectionMove | SelectionRefusal | null;

/**
 * Blocks that do not share one sibling list cannot travel together.
 *
 * Phrased as the remedy rather than the rule. "Different containers" describes
 * the document; selecting within one container is the thing an author can do
 * about it.
 */
const SPLIT_REFUSAL: SelectionRefusal = {
  reason:
    "These blocks sit in different containers. Move blocks that share one.",
};

/**
 * The lock that stops this group being moved, phrased, or `null`.
 *
 * Separate from the deletion refusal because the verb reaches the author: a
 * lock that forbids moving is not the same sentence as one that forbids
 * deleting, and `lockBlockingMove` and `lockBlockingDelete` do not answer alike
 * either — a locked child blocks a delete while the parent around it may still
 * be reordered.
 */
function moveLockRefusal(
  document: BlockDocument,
  ids: readonly string[]
): SelectionRefusal | null {
  for (const id of ids) {
    const blocked = lockBlockingMove(document, id);
    if (blocked === undefined) continue;
    const name = layerLabel(blocked);
    return {
      reason:
        blocked.id === id
          ? `${name} is locked. Unlock it to move it.`
          : `The selection contains ${name}, which is locked. Unlock it to move.`,
    };
  }
  return null;
}

/**
 * Moving every selected block one step, keeping their order and their spacing.
 *
 * **A set moves only within one container.** Duplicate and delete are the
 * single-block verb repeated and need nothing of each other; a move is a step
 * through a list, so blocks in different lists are not doing the same thing.
 * That is a refusal an author is told about, because nothing on the page says
 * the selection straddles a boundary.
 *
 * **One block at the edge refuses the WHOLE group**, like a lock. Letting the
 * others move would close the gaps between them, and the set would come back
 * differently arranged than it went, so `up` would no longer be undone by
 * `down`. Preserving that inverse is what the two move axes exist to protect,
 * and a group edit is where it is easiest to lose.
 *
 * **Every position is the single-block rule's**, asked once per block. Nothing
 * here re-decides what one step means.
 */
export function selectionMove(
  document: BlockDocument,
  selectedIds: readonly string[],
  direction: "up" | "down"
): SelectionMovePlan {
  const ids = normalizeSelection(document, selectedIds);
  if (ids.length === 0) return null;

  const refusal = moveLockRefusal(document, ids);
  if (refusal !== null) return refusal;

  // The ENGINE's rule, not a copy of it. Every composition planner asks the
  // same question — a pattern, a component and a converted selection are each
  // one run lifted out of one place — and a planner runs in a plugin's server
  // action where this package cannot be imported. Two implementations of "do
  // these share a list" would disagree the first time either moved.
  //
  // `siblingRun` also refuses an empty selection and an id the document does
  // not hold. Neither reaches here: `normalizeSelection` has already dropped
  // every absent id and the length guard above has returned. So a split is the
  // only cause left, and it keeps the sentence it always had.
  const found = siblingRun(document.nodes, ids);
  if (found.run === undefined) return SPLIT_REFUSAL;

  // Towards the destination first, so each block steps into an index its
  // neighbour has already left.
  const places = found.run.places;
  const order = direction === "up" ? places : [...places].reverse();

  const ops: BuilderOp[] = [];
  for (const place of order) {
    const step = keyboardMovePosition(document.nodes, place.id, direction);
    // At the edge of the container. Silent, like the single-block move: a
    // selection that cannot go further has said so by not going.
    if (step === null) return null;
    ops.push({ kind: "move", id: place.id, to: step.to });
  }

  return { ops, count: ids.length, subject: subjectOf(document, ids) };
}
