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
  walkNodes,
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

/**
 * Every field an update may name, as data rather than as a type.
 *
 * An op arrives from `JSON.parse` as often as from a compiler — this module says
 * so itself — so the key names in a patch are untrusted input and a type cannot
 * check them at runtime. This table is the runtime half.
 *
 * Its COMPLETENESS is checked by the compiler rather than by hand: the mapped
 * type requires an entry for every key of the engine's patch contract, so a
 * field added to `BlockNode` fails this file until it is classified. That is the
 * difference between a table derived from the contract and a list copied out of
 * it, which is the mistake this module already made once with `NodePatch`.
 *
 * `true` marks a field that may also be REMOVED. `version` and `props` are
 * required on every node, so they may be set and never unset — a node without
 * them is not a node.
 */
const PATCHABLE: { readonly [K in keyof Required<NodePatch>]: boolean } = {
  version: false,
  props: false,
  bindings: true,
  styles: true,
  classes: true,
  visibility: true,
  locked: true,
  name: true,
  customCss: true,
  cssId: true,
  attributes: true,
  migrationFailed: true,
};

/** One edit. The four shapes below are the whole vocabulary. */
export type BuilderOp =
  | {
      readonly kind: "insert";
      readonly node: BlockNode;
      readonly at: TreePosition;
    }
  | { readonly kind: "remove"; readonly id: string }
  | { readonly kind: "move"; readonly id: string; readonly to: TreePosition }
  | {
      readonly kind: "update";
      readonly id: string;
      readonly patch: NodePatch;
      /**
       * Fields to REMOVE, named rather than set to `undefined`.
       *
       * An op is persisted — a crash buffer, a queued agent edit, a replayed
       * history — and `JSON.stringify` drops a key whose value is `undefined`.
       * So an inverse that said `{ customCss: undefined }` arrived back from
       * storage as `{}`, and undoing an edit that ADDED a field left the field
       * in place. A list of names survives the round trip because it is data.
       */
      readonly unset?: readonly string[];
    };

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

/**
 * Refuses an op whose field names or values cannot be honoured.
 *
 * The document is validated all through this module — does the node exist, did
 * the engine accept the placement — but until here the OP itself was taken on
 * trust. It should not be: this module's own header says ops are persisted and
 * replayed, so a `kind`, a key name and a value can all arrive from
 * `JSON.parse` rather than from a compiler, and TypeScript is no longer in the
 * room.
 *
 * Three refusals, each for a failure that is silent rather than loud:
 *
 * - a name outside the patch contract. `unset: ["id"]` would strip a node's
 *   identity, and the inverse still addresses the old id — so it could not put
 *   back what it removed.
 * - `undefined` as a patch VALUE. It removes the field when applied and then
 *   `JSON.stringify` drops the key, so a replayed op silently does nothing.
 *   Removal has a spelling that survives storage, and this insists on it.
 * - a name that is not a field at all — `__proto__`, `constructor`,
 *   `prototype`. These reach an object's machinery rather than its data.
 */
function assertPatchNames(op: Extract<BuilderOp, { kind: "update" }>): void {
  for (const [key, value] of Object.entries(op.patch)) {
    if (!Object.hasOwn(PATCHABLE, key)) {
      throw new OpError(
        `update: "${key}" is not a field this op may set. Ids and types are ` +
          `identity, children move through the structural ops, and anything ` +
          `else named here is not part of a node.`
      );
    }
    if (value === undefined) {
      throw new OpError(
        `update: "${key}" is set to undefined. A value that disappears when the ` +
          `op is stored would make a replayed edit do nothing; name it in ` +
          `\`unset\` instead, which survives being written down.`
      );
    }
  }

  for (const key of op.unset ?? []) {
    if (!Object.hasOwn(PATCHABLE, key)) {
      throw new OpError(`update: "${key}" is not a field this op may remove.`);
    }
    if (!PATCHABLE[key as keyof typeof PATCHABLE]) {
      throw new OpError(
        `update: "${key}" is required on every node and cannot be removed. A ` +
          `node without it is not a node, and the inverse could not restore one.`
      );
    }
  }
}

/**
 * The id of a locked node anywhere in a subtree, or `undefined` if there is none.
 *
 * The whole subtree and not just its root, because removing a container removes
 * everything under it. A check that read only the node an op addresses would let
 * an author delete a locked block by deleting the column it sits in — the lock
 * honoured at the node and defeated one level up.
 */
function lockedWithin(node: BlockNode): string | undefined {
  let found: string | undefined;
  walkNodes([node], candidate => {
    if (found === undefined && candidate.locked === true) found = candidate.id;
  });
  return found;
}

/** Whether two locations name the same parent, slot and index. */
function samePlace(a: NodeLocation, b: NodeLocation): boolean {
  return (
    a.parent?.id === b.parent?.id && a.slot === b.slot && a.index === b.index
  );
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
function priorValues(
  node: BlockNode,
  keys: readonly string[]
): { patch: NodePatch; unset: string[] } {
  const held = node as unknown as Record<string, unknown>;
  // Null prototype: a persisted op can carry `__proto__` as an own key, and
  // assigning it on an ordinary object rewrites the prototype instead of
  // recording a value — the entry then vanishes from the inverse silently.
  const patch: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  const unset: string[] = [];

  for (const key of keys) {
    if (key in held && held[key] !== undefined) patch[key] = held[key];
    else unset.push(key);
  }

  return { patch, unset };
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
      // Refused rather than exempting the inverse from the lock. The inverse of
      // an insert is a remove, and a remove refuses a locked subtree — so
      // accepting this would put the document one edit from a state its own
      // undo could not leave. The alternative was a flag saying "this remove is
      // an undo", and a flag is a claim any caller can make: an op arrives from
      // storage, so nothing distinguishes the store's own inverse from a
      // forged one. Refusing at the door needs no such distinction.
      const lockedId = lockedWithin(op.node);
      if (lockedId !== undefined) {
        throw new OpError(
          `insert: "${lockedId}" arrives locked, and a locked node cannot be ` +
            `removed — so this insert could never be undone. Unlock it before ` +
            `adding it to the document.`
        );
      }
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

      const lockedId = lockedWithin(node);
      if (lockedId !== undefined) {
        throw new OpError(
          `remove: "${lockedId}" is locked and sits inside what this would ` +
            `delete. An author locked it against deletion, and removing its ` +
            `ancestor deletes it just as thoroughly.`
        );
      }
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
      assertUnlocked(node, "move");
      const moved = accepted(
        nodes,
        moveNode(nodes, op.id, op.to),
        `move: the document did not accept "${op.id}" at the position given. ` +
          `The position may name a parent the document does not hold, omit ` +
          `the slot it needs, or sit inside the subtree being moved.`
      );
      // A drop where the drag began. `moveNode` removes and reinserts, so it
      // hands back a NEW forest holding the same tree — the reference changed
      // and nothing else did. Recording it would put an entry in the history
      // whose undo visibly does nothing, which is worse than no entry: a user
      // pressing undo expects the last thing they see to come back.
      //
      // Compared as positions rather than by serializing the forest: the
      // question is whether this node ended up where it started, and asking it
      // that way stays cheap on a document of any size.
      const settled = locateNode(moved, op.id);
      if (settled !== undefined && samePlace(location, settled)) {
        throw new OpError(
          `move: "${op.id}" is already at the position given, so this move ` +
            `changes nothing. A history entry for it would undo to no visible ` +
            `effect.`
        );
      }
      return {
        nodes: moved,
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
      assertPatchNames(op);
      const touched = [...Object.keys(op.patch), ...(op.unset ?? [])];
      const before = priorValues(node, touched);
      // `unset` becomes `undefined` only HERE, at the moment of applying. The
      // engine's spread leaves the key present holding `undefined`, which the
      // document sheds the next time it is serialized; the op itself never
      // carries that value, so persisting it loses nothing.
      const removals = Object.fromEntries(
        (op.unset ?? []).map(key => [key, undefined])
      ) as NodePatch;

      // An update that writes what is already there. `updateNode` allocates a
      // new forest regardless, so the reference test the structural ops rely on
      // cannot see it — the values have to be compared. Recording it would add
      // a history entry whose undo has no visible effect, which is the same
      // thing the move branch refuses one case earlier.
      const held = node as unknown as Record<string, unknown>;
      const changesSomething = touched.some(key =>
        (op.unset ?? []).includes(key)
          ? held[key] !== undefined
          : held[key] !== (op.patch as Record<string, unknown>)[key]
      );
      if (!changesSomething) {
        throw new OpError(
          `update: "${op.id}" already holds every value this op would write, ` +
            `so it changes nothing. A history entry for it would undo to no ` +
            `visible effect.`
        );
      }

      return {
        nodes: updateNode(nodes, op.id, { ...op.patch, ...removals }),
        inverse: {
          kind: "update",
          id: op.id,
          patch: before.patch,
          ...(before.unset.length > 0 ? { unset: before.unset } : {}),
        },
      };
    }

    default: {
      // The discriminant is exhausted above, so TypeScript never reaches this.
      // A JavaScript caller, a queued agent edit and a buffer written by a
      // newer vocabulary all can: without this the switch falls through and
      // `applyOp` returns `undefined`, which the caller meets as an opaque
      // property access on nothing rather than as the refusal this module
      // promises.
      const unreachable: never = op;
      throw new OpError(
        `unknown op kind: ${JSON.stringify((unreachable as { kind?: unknown }).kind)}. ` +
          `This document may have been edited by a newer version of the editor.`
      );
    }
  }
}
