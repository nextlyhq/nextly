/**
 * Where an op puts a node: checking a position, reading a node's current
 * position, and the prior values an inverse restores.
 *
 * @module ops-positions
 */
import type { BlockNode } from "./document";
import {
  isRemovableField,
  type NodePatch,
  type RemovableField,
} from "./ops-fields";
import { hasOnlyJsonOwnKeys, snapshot } from "./ops-values";
import {
  describe,
  inheritedValueWouldBeLost,
  OpError,
  type OpPosition,
  ownValue,
  type SlotAddress,
} from "./ops-vocabulary";
import { isPlainRecord } from "./plain-record";
// The engine's own predicate, so a slot name is judged the same way at a
// block's declaration and on every op that carries one. Two gates answering
// differently is how a name a position could not use gets in through a subtree.
import { isUsableSlotName } from "./registry";
import type { NodeLocation, TreePosition } from "./tree";

/**
 * Refuses a position whose fields cannot mean what they claim.
 *
 * A `TreePosition` from the compiler is well formed by construction. One from
 * `JSON.parse` is not, and the engine's primitives do not re-check it: `{}`
 * reaches `splice` with a `NaN` index and lands the node at the front, and a
 * `null` slot creates a child region literally named `"null"`. Both produce a
 * NEW forest, so the acceptance check reads them as edits that worked — the
 * document is quietly reordered or grows a slot no block declared.
 */
export function assertPositionContainer(at: unknown, verb: string): void {
  // The descriptor itself, before any field of it is read. A non-enumerable
  // `index` is accepted by the field checks and then dropped by JSON, so the
  // edit applies here and the stored op replays into a different position — or
  // is refused outright. An accessor would run during validation for the same
  // reason every other container now refuses one.
  // Only a RECORD with unwritable keys is this check's business. A non-record
  // falls through to `assertPosition`, whose diagnosis names the actual problem
  // instead of reporting it as a serialization one.
  if (isPlainRecord(at) && !hasOnlyJsonOwnKeys(at)) {
    throw new OpError(
      `${verb}: a position of ${describe(at)} is not one JSON can carry. A key ` +
        `it drops would replay as a different placement than the one applied.`
    );
  }
}

// RELOCATED, not written here — see the docblock of `ops.ts`. one refusal per malformed position field.
// fallow-ignore-next-line complexity
export function assertPosition(at: TreePosition, verb: string): void {
  // The container first. Every read below goes through `at`, so a `null` or a
  // string reaches them as a property access on a non-object and leaves this
  // module as a TypeError — an error the caller cannot tell apart from a bug in
  // the editor, rather than the refusal this module promises for a bad op.
  if (!isPlainRecord(at)) {
    throw new OpError(
      `${verb}: a position of ${describe(at)} names nowhere. A position ` +
        `is a record carrying an index, and a parent and slot when it is not at ` +
        `the document root.`
    );
  }
  // The position's own fields, by the rule the op envelope and every node field
  // already answer to. `hasOnlyJsonOwnKeys` inspects this record's DESCRIPTORS
  // and says nothing about which fields it OWNS, so with
  // `Object.prototype.index = 0` an insert carrying `at: {}` places a node — and
  // the persisted op contains `"at": {}`, which cannot reproduce that placement
  // after a restart.
  //
  // Read through `ownValue`, not checked beside each read: the list-bound shape
  // in this module's parts reached nine sites because each round added a guard
  // next to whichever instance it was shown, and this is the ownership class's
  // fifth.
  for (const field of ["index", "parentId", "slot"] as const) {
    if (inheritedValueWouldBeLost(at, field)) {
      throw new OpError(
        `${verb}: a position whose ${field} comes from the prototype rather ` +
          `than from the position cannot be applied: the placement would ` +
          `happen and the stored op could not reproduce it.`
      );
    }
  }
  const index = ownValue(at, "index");
  const parentId = ownValue(at, "parentId");
  const slot = ownValue(at, "slot");
  if (!Number.isInteger(index) || (index as number) < 0) {
    throw new OpError(
      `${verb}: an index of ${describe(index)} names no position. ` +
        `A missing or non-numeric index reaches the splice as NaN and puts the ` +
        `node at the front of its parent, which reads as a deliberate move.`
    );
  }
  if (parentId !== undefined && typeof parentId !== "string") {
    throw new OpError(
      `${verb}: a parent id of ${describe(parentId)} addresses nothing.`
    );
  }
  // A slot name that names an inherited member. `insertNode` reads
  // `slots[slot] ?? []` to find the existing children, and for "__proto__",
  // "constructor" or "toString" that read answers with something from
  // `Object.prototype` rather than `undefined` — so the engine throws a
  // TypeError on a non-iterable and the op escapes this module without the
  // OpError it promises for a bad op.
  //
  // Asked of `Object.prototype` rather than matched against a written list:
  // the list everyone writes is "__proto__" and "constructor", and "toString"
  // breaks it exactly the same way.
  // An EMPTY name is a usable object key and not a usable slot. The engine
  // creates the slot, the placement succeeds, and the inverse then carries
  // `dropSlotIfEmpty: { slot: "" }` — which `assertDropSlot` refuses for
  // naming no region. The operation applies and can never be undone.
  //
  // Checked on the destination as well as on the cleanup address, because the
  // two rules have to agree: whatever a position may CREATE, a cleanup must be
  // able to name.
  if (slot === "") {
    throw new OpError(
      `${verb}: a position naming an empty slot creates a child region with ` +
        `no name, and the undo of that placement could not name it back. Slots ` +
        `are named.`
    );
  }
  if (typeof slot === "string" && !isUsableSlotName(slot)) {
    throw new OpError(
      `${verb}: ${describe(slot)} is not a usable slot name. It resolves to a ` +
        `member every object inherits, so the document's own children could ` +
        `not be told apart from it.`
    );
  }
  if (parentId !== undefined && typeof slot !== "string") {
    throw new OpError(
      `${verb}: a position inside ${describe(parentId)} must name its slot as a ` +
        `string; ${describe(slot)} would create a child region no ` +
        `block declared.`
    );
  }
  // And the other half of it. A position naming a slot without a parent has no
  // meaning — a slot is a region OF something — and the engine does not refuse
  // it, it ignores the slot and places the node at the document root. So a
  // replayed history carrying `{ slot: "main", index: 0 }` silently becomes an
  // edit the author never made, in a different part of the document, and its
  // inverse addresses where it actually landed rather than where it said.
  //
  // Refused rather than reinterpreted: the op vocabulary's type already makes
  // this unsayable, and this is the same rule for input that never met it.
  if (at.parentId === undefined && at.slot !== undefined) {
    throw new OpError(
      `${verb}: a position naming slot ${describe(at.slot)} must also name ` +
        `the parent it is a slot of. At the top level there is no slot to ` +
        `name, and the node would be placed at the document root instead.`
    );
  }
}

/** Whether two locations name the same parent, slot and index. */
export function samePlace(a: NodeLocation, b: NodeLocation): boolean {
  return (
    a.parent?.id === b.parent?.id && a.slot === b.slot && a.index === b.index
  );
}

/** Where a located node sits, in the shape an op addresses. */
/**
 * Refuses a slot cleanup that names somewhere the node did not just leave.
 *
 * `dropSlotIfEmpty` exists to undo the CONTAINER an insert or a move created,
 * so the only slot it may remove is the one the node has just vacated. Accepting
 * any empty slot in the document makes it a second, unlogged deletion riding on
 * an unrelated edit: a remove naming some other parent's empty `extra` slot
 * deletes both the node and that slot, while the inverse reinserts only the
 * node. The slot is gone with nothing recording that it went.
 *
 * An op is data from storage or from an agent, so the address it carries is a
 * claim rather than a fact. This is where the claim is checked against where the
 * node actually sat.
 */
export function assertDropSlotWasVacated(
  address: SlotAddress | undefined,
  location: NodeLocation,
  verb: string
): void {
  if (address === undefined) return;
  const parentId = location.parent?.id;
  if (address.parentId !== parentId || address.slot !== location.slot) {
    throw new OpError(
      `${verb}: the slot to drop names ${describe(address.slot)} in ` +
        `${describe(address.parentId)}, which is not where this node sat. Only ` +
        `the slot a node has just left may be cleaned up, or the edit deletes ` +
        `a region its inverse cannot restore.`
    );
  }
}

// Exported to the module graph, deliberately not to the package entry: the
// inserter needs the same location-to-position answer the op layer uses, and a
// second conversion would disagree about the slot invariant below the first
// time either changed.
export function positionOf(location: NodeLocation): OpPosition {
  if (location.parent === undefined) return { index: location.index };
  // A parent with no slot is not a position an op can express, and building one
  // anyway would put an unapplicable op into the inverse: an undo that names
  // where to put the node back without saying which region of it. The engine
  // reports slot and parent independently, so this is the boundary where the
  // two become one answer.
  if (location.slot === undefined) {
    throw new OpError(
      `this node sits inside ${describe(location.parent.id)} without a named slot, so ` +
        `the edit could not be undone.`
    );
  }
  return {
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
export function priorValues(
  node: BlockNode,
  keys: readonly string[]
): { patch: NodePatch; unset: RemovableField[] } {
  const held = node as unknown as Record<string, unknown>;
  // Null prototype: a persisted op can carry `__proto__` as an own key, and
  // assigning it on an ordinary object rewrites the prototype instead of
  // recording a value — the entry then vanishes from the inverse silently.
  const patch: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  const unset: RemovableField[] = [];

  for (const key of keys) {
    // OWN, not merely resolvable. An inherited value read as prior state puts
    // the prototype's value into the inverse patch, so undoing an update
    // MATERIALISES a field the node never had instead of restoring its absence.
    const previous = ownValue(held, key);
    if (previous !== undefined) {
      patch[key] = previous;
      continue;
    }
    // Absent, so the inverse must REMOVE it to restore what was there. A field
    // the engine requires cannot legitimately be absent from a node that
    // validated, and recording it here would build an inverse whose own
    // application is refused — an undo that cannot run.
    if (!isRemovableField(key)) {
      throw new OpError(
        `update: this node is missing ${describe(key)}, which every node carries, so ` +
          `the edit could not be undone.`
      );
    }
    unset.push(key);
  }

  // Detached before it leaves. These values came out of the live document, so
  // the inverse would otherwise hold references into the very tree a later edit
  // rewrites — and undo would restore whatever those objects became rather than
  // what was there when the edit ran.
  return { patch: snapshot(patch), unset };
}
