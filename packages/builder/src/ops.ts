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
 * Mirrors what the engine's `updateNode` accepts rather than restating it: `id`
 * and `type` are not patchable (an id is identity, a type change is a conversion
 * with its own semantics) and children move through the structural ops.
 */
export type NodePatch = Partial<Omit<BlockNode, "id" | "type" | "slots">>;

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
export function applyOp(nodes: BlockNode[], op: BuilderOp): AppliedOp {
  switch (op.kind) {
    case "insert": {
      if (findNode(nodes, op.node.id) !== undefined) {
        throw new OpError(
          `insert: a node with id "${op.node.id}" is already in the document. ` +
            `Ids are identity, so inserting a second one would make every later ` +
            `op ambiguous about which it addresses.`
        );
      }
      return {
        nodes: insertNode(nodes, op.node, op.at),
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
      // Both the node and where it sat, captured before it goes: neither is
      // recoverable from the forest afterwards, which is the whole reason the
      // inverse cannot be computed later.
      return {
        nodes: removeNode(nodes, op.id),
        inverse: { kind: "insert", node, at: positionOf(location) },
      };
    }

    case "move": {
      const location = locateNode(nodes, op.id);
      if (location === undefined) {
        throw new OpError(`move: no node with id "${op.id}" in the document.`);
      }
      return {
        nodes: moveNode(nodes, op.id, op.to),
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
