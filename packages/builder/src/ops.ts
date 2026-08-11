/**
 * The op vocabulary the editor edits through, and how an op is applied.
 *
 * Every change to a document is an op: the canvas, the layers panel, the
 * inspector and an agent all produce these and nothing else. That is what makes
 * undo, autosave, crash restore and edit review one mechanism rather than four —
 * each of them reads or replays this list.
 *
 * **Ops address nodes by id, never by path.** A path is a description of the
 * tree at the moment it was written, so an op holding one is invalidated by any
 * edit above it — which is precisely the situation undo, a replayed buffer and a
 * queued agent edit are all in. An id survives its neighbours moving.
 *
 * **Tree manipulation is delegated to the engine, not reproduced here.** The
 * engine owns what a document IS; this module owns what an edit MEANS. Writing a
 * second insert/remove/move here would put two answers to "where does this node
 * go" in the repository, and they would agree until the day they did not.
 *
 * This module is free of React and of any DOM, so the store can be exercised
 * without mounting anything.
 *
 * @module ops
 */

import {
  findNode,
  insertNode,
  locateNode,
  moveNode,
  removeNode,
  updateNode,
  type BlockNode,
  type NodeLocation,
  type TreePosition,
} from "@nextlyhq/blocks-engine";

/**
 * The fields an `update` op may carry.
 *
 * Read OFF the engine's signature rather than written to match it. `id` and
 * `type` are not patchable (an id is identity, a type change is a conversion
 * with its own semantics) and children move through the structural ops — but
 * saying so again here would be a second statement of the engine's contract,
 * and the two would agree only until the engine narrowed. Then `BuilderOp`
 * would keep accepting a field `updateNode` had stopped applying, and the
 * inverse would be derived for an edit that did not happen.
 */
export type NodePatch = Parameters<typeof updateNode>[2];

/** One edit. The four shapes below are the whole vocabulary. */
export type BuilderOp =
  | {
      readonly kind: "insert";
      readonly node: BlockNode;
      readonly at: TreePosition;
    }
  | { readonly kind: "remove"; readonly id: string }
  | { readonly kind: "move"; readonly id: string; readonly to: TreePosition }
  | { readonly kind: "update"; readonly id: string; readonly patch: NodePatch };

/**
 * An op that could not be applied to the document it was given.
 *
 * Thrown rather than returned as a no-op, because the caller is a history: an op
 * that silently did nothing would still be recorded, and its inverse would then
 * undo an edit that never happened. A stale op is a bug in whoever held it, and
 * the only safe answer is to refuse it loudly.
 */
export class OpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpError";
  }
}

/**
 * The forest a primitive produced, or a refusal if it declined to act.
 *
 * The engine's tree functions report a refusal by returning the forest they
 * were GIVEN — `moveNode` says so in its own body (`next === without ? nodes :
 * next`) — so identity is the contract rather than a trick. They decline for
 * more reasons than a caller can readily enumerate: an unknown parent, a slot
 * position that names no slot, a destination inside the moving subtree, a
 * duplicate id anywhere beneath the inserted root.
 *
 * Asked of the RESULT rather than re-derived as preconditions. Restating those
 * rules here would be a second copy of the engine's placement logic, correct on
 * the day it was written; and a check that enumerates four of five reasons
 * admits the fifth silently, which for a history means recording an edit that
 * never happened and an inverse that throws when someone undoes it.
 */
function accepted(
  before: BlockNode[],
  after: BlockNode[],
  refusal: string
): BlockNode[] {
  if (after === before) throw new OpError(refusal);
  return after;
}

/**
 * Refuses a structural edit to a node its author locked.
 *
 * The flag is deliberately invisible to the engine — `BlockNode.locked`
 * documents itself as "an author-facing policy flag, not a data-layer
 * guarantee", and the pure tree primitives do not read it — which makes this
 * module the boundary that has to enforce it. Nothing below here will.
 *
 * Structural edits only. A locked node may still be restyled and re-configured;
 * the lock is against moving and deleting, which is what an author sets it to
 * prevent.
 */
function assertUnlocked(node: BlockNode, verb: string): void {
  if (node.locked === true) {
    throw new OpError(
      `${verb}: node "${node.id}" is locked. An author locked it against being ` +
        `moved or deleted; unlock it before editing its place in the tree.`
    );
  }
}

/** Where a located node sits, in the shape an op addresses. */
function positionOf(location: NodeLocation): TreePosition {
  return location.parent === undefined
    ? { index: location.index }
    : {
        parentId: location.parent.id,
        slot: location.slot,
        index: location.index,
      };
}

/**
 * The prior value of every key a patch names, including the keys the node did
 * not have.
 *
 * An absent key has to be represented, not skipped. Undoing an edit that ADDED
 * `customCss` means removing it again, and a patch that simply omits the key
 * would leave the added value in place — an undo that silently keeps part of
 * what it undid. `undefined` is how that is said, and it survives the round trip
 * because a document is stored as JSON, where a key set to `undefined` and an
 * absent key are the same document.
 */
function priorValues(node: BlockNode, patch: NodePatch): NodePatch {
  const prior: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    prior[key] = (node as unknown as Record<string, unknown>)[key];
  }
  return prior;
}

/**
 * Who an op is acting for.
 *
 * An author lock constrains the AUTHOR. It does not constrain undo: withdrawing
 * an edit that was just made is not the author reaching for a node someone
 * locked, and treating it as one makes an op the store itself produced
 * inapplicable. The rule the two together preserve is that `applyOp` never
 * returns an inverse `applyOp` would refuse.
 *
 * Defaulted to `"author"`, so an unmarked call gets the constrained reading and
 * a caller has to say the word "undo" to be relieved of it.
 */
export type OpSource = "author" | "undo";

/** The result of applying one op: the new forest, and the op that undoes it. */
export interface AppliedOp {
  readonly nodes: BlockNode[];
  readonly inverse: BuilderOp;
}

/**
 * Apply one op, returning the new forest and the op that undoes it.
 *
 * **The inverse is derived from the state the op is applied TO, never declared
 * by the caller.** A caller-supplied inverse is a second statement of a fact the
 * document already holds, and the two drift the moment anything about the op
 * changes: a `remove` whose caller forgot the node's slot undoes into the wrong
 * parent, and nothing detects it until someone presses undo. Deriving it here
 * means there is one answer and no way to disagree with it.
 *
 * That is also why the inverse is computed BEFORE the mutation rather than by
 * comparing the two forests afterwards: a diff would have to guess which of
 * several edits could have produced the difference, and for a move between two
 * positions holding identical nodes there is no unique answer.
 */
export function applyOp(
  nodes: BlockNode[],
  op: BuilderOp,
  source: OpSource = "author"
): AppliedOp {
  switch (op.kind) {
    case "insert": {
      return {
        nodes: accepted(
          nodes,
          insertNode(nodes, op.node, op.at),
          `insert: the document did not accept "${op.node.id}" at the position ` +
            `given. The position may name a parent the document does not hold ` +
            `or omit the slot it needs, or the subtree may carry an id the ` +
            `document already uses — ids are identity, so a repeat would make ` +
            `every later op ambiguous about which node it addresses.`
        ),
        inverse: { kind: "remove", id: op.node.id },
      };
    }

    case "remove": {
      const node = findNode(nodes, op.id);
      const location = locateNode(nodes, op.id);
      if (node === undefined || location === undefined) {
        throw new OpError(
          `remove: no node with id "${op.id}" in the document.`
        );
      }
      if (source === "author") assertUnlocked(node, "remove");
      // Both the node and where it sat, captured before it goes: neither is
      // recoverable from the forest afterwards, which is the whole reason the
      // inverse cannot be computed later.
      return {
        nodes: accepted(
          nodes,
          removeNode(nodes, op.id),
          `remove: the document did not accept removing "${op.id}".`
        ),
        inverse: { kind: "insert", node, at: positionOf(location) },
      };
    }

    case "move": {
      const node = findNode(nodes, op.id);
      const location = locateNode(nodes, op.id);
      if (node === undefined || location === undefined) {
        throw new OpError(`move: no node with id "${op.id}" in the document.`);
      }
      if (source === "author") assertUnlocked(node, "move");
      return {
        nodes: accepted(
          nodes,
          moveNode(nodes, op.id, op.to),
          `move: the document did not accept "${op.id}" at the position given. ` +
            `The position may name a parent the document does not hold, omit ` +
            `the slot it needs, or sit inside the subtree being moved.`
        ),
        inverse: { kind: "move", id: op.id, to: positionOf(location) },
      };
    }

    case "update": {
      const node = findNode(nodes, op.id);
      if (node === undefined) {
        throw new OpError(
          `update: no node with id "${op.id}" in the document.`
        );
      }
      return {
        nodes: updateNode(nodes, op.id, op.patch),
        inverse: {
          kind: "update",
          id: op.id,
          patch: priorValues(node, op.patch),
        },
      };
    }
  }
}
