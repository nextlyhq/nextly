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
 * ## Order is load-bearing, and only for duplicate
 *
 * **Duplicating runs in REVERSE document order.** Each copy is inserted
 * immediately after its original, and inserting shifts every later sibling
 * along — so planning `[a, b, c]` forwards computes b's position against a
 * document that a's copy has already changed, and the second copy lands in the
 * wrong place. Reversed, every insert happens after the positions still to be
 * used, and each one is correct when it applies.
 *
 * **Deleting does not care**, and that is worth stating so nobody "fixes" it:
 * a remove addresses a node by id, ids do not move, and the op layer derives
 * each inverse from the document it was applied to. Both orders round-trip.
 * Document order is used anyway, so a group is deterministic.
 *
 * @module selection-ops
 */

import { type BlockDocument, type BlockNode } from "@nextlyhq/blocks-engine";

import { blockDeletion } from "./delete-block";
import { blockDuplication } from "./duplicate-block";
import { lockOp } from "./inspector";
import { layerLabel } from "./layers";
import { lockBlockingDelete } from "./locking";
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

/** Whether a plan can be applied. */
export function isRefusal(plan: SelectionPlan): plan is SelectionRefusal {
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
  return {
    ops: ids.map(id => lockOp(id, locked)),
    count: ids.length,
    descendants: 0,
    nextSelection: null,
    subject: subjectOf(document, ids),
  };
}
