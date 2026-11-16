/**
 * The fields an op may carry: the node and patch field lists, which fields an
 * update may remove, and the value predicates the other parts share.
 *
 * @module ops-fields
 */
import { type BlockNode, isBlockOrigin } from "./document";
import { isPlainRecord } from "./plain-record";
import type { updateNode } from "./tree";
import { isNodeType, isNodeVersion } from "./validation";

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
 * Whether `K` is OPTIONAL on `T`, as a type the compiler can evaluate.
 *
 * `Omit<T, K>` drops the field; if it is still assignable to `T`, the field was
 * one `T` can do without. That is optionality read off the declaration rather
 * than restated beside it, which matters because the alternative — a hand-kept
 * boolean per field — compiles just as happily after the declaration changes
 * underneath it.
 */
type IsOptional<T, K extends keyof T> = Omit<T, K> extends T ? true : false;

/**
 * What the op layer checks about each node field, and whether a node can do
 * without it.
 *
 * **`optional` is DERIVED, never asserted.** Writing `true` next to a field the
 * engine has since made required is a compile error, because the mapped type
 * demands the literal that `IsOptional` computes. A table of hand-kept booleans
 * would still compile and would then let an update REMOVE a field every node
 * needs — the engine's contract and this module's idea of it agreeing only
 * until the engine moved.
 *
 * **`holds` is SHALLOW, and the boundary is deliberate.** It answers "is this
 * the kind of value the field takes" — a record, an array of strings, a finite
 * number — and nothing about whether the contents mean anything. Deep validity
 * (does this block type exist, is this style value legal, does this breakpoint
 * resolve) is `validate()` in the engine, which needs a block registry and a
 * breakpoint set that a tree operation has no business requiring. Restating any
 * of it here would put a second, stricter document validator in the repository,
 * rejecting documents the engine itself accepts.
 *
 * It returns `boolean` rather than a type predicate for the same reason. A guard
 * typed `value is NodeStyles` would be claiming to have checked a structure it
 * only glanced at, and every caller downstream would be entitled to believe it.
 *
 * Completeness is the compiler's job: `Required<BlockNode>` forces an entry per
 * field, so a field added to the engine fails this file until someone says what
 * it is.
 */
export const NODE_FIELDS: {
  readonly [K in keyof Required<BlockNode>]: {
    readonly holds: (value: unknown) => boolean;
    readonly optional: IsOptional<BlockNode, K>;
  };
} = {
  id: { holds: isNonEmptyString, optional: false },
  // The engine's own rules, asked rather than restated. A `typeof === "string"`
  // check here accepts `"box"` and a `typeof === "number"` accepts `0` and
  // `-2.5`, all of which strict validation refuses — so an op carrying one
  // would enter history and leave a document that fails on the next read.
  type: { holds: isNodeType, optional: false },
  version: { holds: isNodeVersion, optional: false },
  props: { holds: isPlainRecord, optional: false },
  bindings: { holds: isPlainRecord, optional: true },
  slots: { holds: isSlotMap, optional: true },
  styles: { holds: isPlainRecord, optional: true },
  classes: { holds: isStringArray, optional: true },
  visibility: { holds: isPlainRecord, optional: true },
  locked: { holds: isBoolean, optional: true },
  name: { holds: isString, optional: true },
  customCss: { holds: isString, optional: true },
  cssId: { holds: isString, optional: true },
  nosnippet: { holds: isBoolean, optional: true },
  attributes: { holds: isStringRecord, optional: true },
  migrationFailed: { holds: isBoolean, optional: true },
  origin: { holds: isBlockOrigin, optional: true },
};

/**
 * Every field name an update may address.
 *
 * A key set rather than a lookup — the `true` carries no information, and the
 * value it would otherwise carry (may this be removed?) is read from
 * {@link NODE_FIELDS} so there is one statement of the node contract and not
 * two. What this table adds is the narrower question of which of a node's
 * fields an UPDATE may touch at all: `id` and `type` are identity, and children
 * move through the structural ops.
 *
 * Read off the engine's patch signature, so a field the engine stops accepting
 * fails here rather than being quietly applied to nothing.
 */
const PATCH_FIELDS: { readonly [K in keyof Required<NodePatch>]: true } = {
  version: true,
  props: true,
  bindings: true,
  styles: true,
  classes: true,
  visibility: true,
  locked: true,
  name: true,
  customCss: true,
  cssId: true,
  nosnippet: true,
  attributes: true,
  migrationFailed: true,
  // Patchable, like `migrationFailed`, rather than sealed. Provenance is a
  // record and not a lock: an author who deliberately severs the link to a
  // pattern should be able to, and a field an update can never address is one
  // that can only be removed by deleting the node it sits on.
  origin: true,
};

/** A field name an update may address. */
type PatchField = keyof typeof PATCH_FIELDS;

/**
 * A field name an update may REMOVE.
 *
 * Computed from the engine's own node shape rather than listed, so it is the
 * same statement of optionality that {@link mayRemove} enforces at runtime and
 * cannot drift from it. A field the engine makes required leaves this union the
 * day it changes.
 *
 * It exists so the vocabulary cannot SPELL the ops that are always refused.
 * With `unset` typed as arbitrary strings a caller in TypeScript can write
 * `unset: ["id"]` or `unset: ["version"]`, get no complaint from the compiler,
 * and discover at apply time — inside a history replay, where the op is already
 * recorded — that the edit was never applicable. The runtime guard stays for
 * persisted input, which reaches `applyOp` from `JSON.parse` with no compiler
 * anywhere in the room.
 */
export type RemovableField = {
  [K in PatchField]: IsOptional<BlockNode, K> extends true ? K : never;
}[PatchField];

export function isPatchField(key: string): key is PatchField {
  return Object.hasOwn(PATCH_FIELDS, key);
}

/**
 * Whether an update may REMOVE this field, from the engine's own declaration.
 *
 * A required field may be set and never unset: a node without `version` or
 * `props` is not a node, and an inverse could not restore one it never saw.
 */
export function mayRemove(key: PatchField): boolean {
  return NODE_FIELDS[key].optional;
}

/** Whether a name is a field an update may remove, narrowing it to the union. */
export function isRemovableField(key: string): key is RemovableField {
  return isPatchField(key) && mayRemove(key);
}

export function isString(value: unknown): boolean {
  return typeof value === "string";
}

export function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function isBoolean(value: unknown): boolean {
  return typeof value === "boolean";
}

export function isStringArray(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  // An INDEX loop, not `every`. `Array.prototype.every` skips holes, so
  // `Array(1)` reports that every entry is a string when there is no entry at
  // all — and the hole serializes as `null`, which strict validation rejects.
  // The engine's own class check uses an index loop for this reason.
  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== "string") return false;
  }
  return true;
}

/**
 * Whether a property holds a value rather than running code to produce one.
 *
 * An accessor is not something a document HOLDS, and admitting one costs twice.
 * Reading it runs caller code during validation: a throwing getter leaves this
 * module as its own native error, and a caller cannot tell that from the editor
 * having a bug — which is the whole reason ops refuse with `OpError`.
 *
 * The successful getter is the worse case, because nothing reports it. The
 * accessor stays in the live document while `JSON.stringify` writes whatever it
 * returned at serialization time, so the op replays from storage as a plain
 * data property. The document and its own persisted form disagree about what
 * kind of thing that key is, and the disagreement surfaces later as a value
 * that stopped tracking whatever the getter computed from.
 *
 * Asked of the descriptor rather than of the object so the record branch, which
 * has already read one to check enumerability, does not read it twice.
 */
export function holdsAValue(
  descriptor: PropertyDescriptor | undefined
): boolean {
  return descriptor !== undefined && "value" in descriptor;
}

function isStringRecord(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    Object.values(value).every(entry => typeof entry === "string")
  );
}

/**
 * Named child regions: a record of arrays.
 *
 * The child NODES are not checked here — the walk in `assertNodeShape`
 * reaches them, and checking them twice would mean two answers to the same
 * question.
 */
function isSlotMap(value: unknown): boolean {
  return isPlainRecord(value) && Object.values(value).every(Array.isArray);
}
