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
  countNodes,
  DEFAULT_LIMITS,
  documentBytes,
  findNode,
  isNodeType,
  isNodeVersion,
  isPlainRecord,
  walkNodes,
  insertNode,
  locateNode,
  moveNode,
  removeNode,
  updateNode,
  type BlockDocument,
  type DocumentLimits,
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
const NODE_FIELDS: {
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
  attributes: { holds: isStringRecord, optional: true },
  migrationFailed: { holds: isBoolean, optional: true },
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
  attributes: true,
  migrationFailed: true,
};

/** A field name an update may address. */
type PatchField = keyof typeof PATCH_FIELDS;

/**
 * Whether a slot name can be stored and read back as its own key.
 *
 * ONE policy, asked wherever a slot name appears — a destination position and a
 * slot carried inside an inserted subtree are the same question, and answering
 * it in only one place is what let a subtree smuggle in the name a position
 * could not.
 *
 * The rejected names are the ones `Object.prototype` owns. Reading
 * `slots[name]` for one of those answers with an inherited member instead of
 * `undefined`, and ASSIGNING it — which the engine does when it rebuilds a slot
 * map — sets the prototype rather than creating an own property, dropping that
 * whole child list. Asked of `Object.prototype` rather than matched against a
 * written list, because the list everyone writes is `__proto__` and
 * `constructor` while `toString` behaves identically.
 */
function isUsableSlotName(name: string): boolean {
  return !Object.prototype.hasOwnProperty.call(Object.prototype, name);
}

function isPatchField(key: string): key is PatchField {
  return Object.hasOwn(PATCH_FIELDS, key);
}

/**
 * Whether an update may REMOVE this field, from the engine's own declaration.
 *
 * A required field may be set and never unset: a node without `version` or
 * `props` is not a node, and an inverse could not restore one it never saw.
 */
function mayRemove(key: PatchField): boolean {
  return NODE_FIELDS[key].optional;
}

function isString(value: unknown): boolean {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function isBoolean(value: unknown): boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): boolean {
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
 * A value rendered for a diagnostic, without ever throwing.
 *
 * `JSON.stringify` is not usable here: a bigint makes it throw, and the branches
 * that need to describe a value are the rejection branches — so building the
 * message about a bad value would itself fail, and the caller would meet a
 * `TypeError` in place of the refusal this module promises.
 */
function describe(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "bigint") return `${String(value)}n`;
  if (typeof value === "object" && value !== null) {
    return Array.isArray(value) ? "an array" : "an object";
  }
  return String(value);
}

/**
 * Whether a value is one JSON can carry without changing it.
 *
 * An op is stored as JSON, so a value outside that domain does not survive the
 * round trip — and the two ways it fails to survive need the same answer for
 * opposite reasons:
 *
 * - a bigint or a cycle makes `JSON.stringify` THROW, which is loud;
 * - a function, a symbol or an `undefined` inside an object is dropped
 *   SILENTLY, which is worse. The live document keeps the value, the persisted
 *   op does not, and a crash replay rebuilds a different document than the one
 *   the author was looking at.
 *
 * Checking the domain answers both. A catch around `stringify` only ever
 * answers the first, which is why it is not what this does.
 *
 * `NaN` and the infinities are excluded for the same reason: they serialize to
 * `null`, so the value that comes back is not the value written.
 */
function isJsonValue(value: unknown, seen: Set<object> = new Set()): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") {
    // Negative zero is finite and survives nothing: `JSON.stringify(-0)` writes
    // `0`, so an accepted op replays as a DIFFERENT value and `1 / offset`
    // flips sign after a crash restore. Refused rather than canonicalized,
    // because silently rewriting an author's value is the other way to make the
    // live document and its stored form disagree.
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (typeof value !== "object") return false;

  const held = value;
  // A cycle has no JSON form, and without this the walk would not return.
  if (seen.has(held)) return false;
  seen.add(held);

  if (!hasOnlyJsonOwnKeys(held)) return false;

  if (Array.isArray(value)) {
    // By index: `every` skips holes, and a hole serializes as `null`.
    for (let index = 0; index < value.length; index += 1) {
      if (!isJsonValue(value[index], seen)) return false;
    }
    seen.delete(held);
    return true;
  }

  if (!isPlainRecord(value)) return false;
  for (const entry of Object.values(value)) {
    if (!isJsonValue(entry, seen)) return false;
  }
  seen.delete(held);
  return true;
}

/**
 * Whether every OWN key of an object is one JSON will write.
 *
 * Asked of arrays, of records, and of a patch object alike, because it is one
 * question and answering it per traversal is what let three different shapes of
 * invisible key through in turn: a symbol on a record, a named property on an
 * array, a symbol on the patch itself. Each was found only after the previous
 * traversal was tightened, which is the signal that the traversals — not the
 * cases — were the problem.
 *
 * What JSON writes is narrow. For a record: enumerable, string-keyed. For an
 * array: the indexed elements and nothing else, so a `list.note = "x"` is kept
 * in the live document and dropped from the stored op. Anything else stays in
 * memory and vanishes on the round trip, which is a document diverging from
 * itself with no error anywhere.
 *
 * Both shapes must also hold plain VALUES, which is {@link holdsAValue}.
 */
/**
 * Whether a key is a canonical array INDEX, not merely a numeric string.
 *
 * The range matters. An array's length is a uint32, so the largest index is
 * 2^32 - 2; a property named `"4294967295"` is an ordinary string key that
 * leaves `length` untouched. `JSON.stringify` writes it nowhere, so accepting
 * it keeps a value in the live document that replay silently drops.
 */
function isArrayIndex(key: string): boolean {
  return /^(?:0|[1-9]\d*)$/.test(key) && Number(key) <= 4294967294;
}

function hasOnlyJsonOwnKeys(value: object): boolean {
  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      // `length` is an own property of every array and is never serialized as
      // a member, so it is the one key that is expected rather than lost.
      if (key === "length") continue;
      if (typeof key !== "string") return false;
      if (!isArrayIndex(key)) return false;
      // Enumerability is deliberately NOT required of an index: `JSON.stringify`
      // reads an array by position from `0` to `length`, so a non-enumerable
      // index still round-trips and refusing it would reject a value that
      // serializes correctly.
      if (!holdsAValue(Object.getOwnPropertyDescriptor(value, key))) {
        return false;
      }
    }
    return true;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable) return false;
    if (!holdsAValue(descriptor)) return false;
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
function holdsAValue(descriptor: PropertyDescriptor | undefined): boolean {
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
 * The child NODES are not checked here — the walk in {@link assertNodeShape}
 * reaches them, and checking them twice would mean two answers to the same
 * question.
 */
function isSlotMap(value: unknown): boolean {
  return isPlainRecord(value) && Object.values(value).every(Array.isArray);
}

/**
 * One edit to the NODE TREE. The four shapes below are the whole vocabulary
 * for that, and deliberately not for the document as a whole.
 *
 * `BlockDocument.settings` — page-scoped styles, `customCss` — has no op here:
 * `update` addresses a node by id and `NodePatch` is read off `updateNode`'s
 * signature, which excludes the envelope. So an editor changing page settings
 * has to write them outside this module, and that change is absent from undo,
 * autosave, crash replay and review.
 *
 * Stated rather than quietly true. Adding a fifth op widens the PERSISTED
 * format, which every later version has to keep reading, so its shape wants its
 * own design pass rather than being appended to whichever change notices the
 * gap. Nothing bypasses undo in practice yet, because nothing consumes this
 * module.
 */
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
  if (!isPlainRecord(op.patch)) {
    throw new OpError(
      `update: a patch of ${describe(op.patch)} names no fields. An ` +
        `update carries a record of the values to write.`
    );
  }

  // The patch OBJECT, by the same rule as the values inside it. `Object.entries`
  // below reports only enumerable string keys, while the spread that applies
  // the patch copies symbol keys onto the node too — so an unchecked symbol
  // field reaches the live document and is dropped from the stored op.
  if (!hasOnlyJsonOwnKeys(op.patch)) {
    throw new OpError(
      `update: the patch carries a field JSON cannot write. A patch is stored ` +
        `as JSON, so a key it drops would apply here and be absent on replay.`
    );
  }

  for (const [key, value] of Object.entries(op.patch)) {
    if (!isPatchField(key)) {
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
    // The JSON domain FIRST, before any shape predicate reads the value.
    // `isStringArray` and `isStringRecord` enumerate what they are given, so an
    // accessor at `classes[0]` runs during validation: a throwing getter leaves
    // this module as its own native error rather than an OpError, and a
    // returning one is read as though the document held it. Ordering is the
    // whole fix — the predicates stay simple and nothing reaches them until the
    // value is known to be plain data.
    if (!isJsonValue(value)) {
      throw new OpError(
        `update: "${key}" holds a value JSON cannot carry unchanged. A patch ` +
          `is stored as JSON, so a value it drops or rewrites would replay as ` +
          `something else — or not at all.`
      );
    }
    // The VALUE, not only the name. A patch reaching `updateNode` is spread
    // onto the node whatever it holds, so `{ version: "3" }` from a replayed
    // buffer replaces a number with a string and the document is corrupt from
    // then on, with nothing between the op and the tree to notice.
    if (!NODE_FIELDS[key].holds(value)) {
      throw new OpError(
        `update: "${key}" cannot hold ${describe(value)}. Writing it ` +
          `would leave the node holding a value of the wrong kind, which every ` +
          `later read treats as data.`
      );
    }
  }

  // The JSON domain before the shape predicate, for the reason every other
  // field already gets it: `isStringArray` enumerates what it is handed, so an
  // accessor at an index would run during validation.
  if (op.unset !== undefined && !isJsonValue(op.unset)) {
    throw new OpError(
      `update: an unset of ${describe(op.unset)} holds a value JSON cannot ` +
        `carry unchanged, so it would replay as something else.`
    );
  }
  if (op.unset !== undefined && !isStringArray(op.unset)) {
    throw new OpError(
      `update: an unset of ${describe(op.unset)} names no fields. It is ` +
        `a list of field names.`
    );
  }

  for (const key of op.unset ?? []) {
    if (!isPatchField(key)) {
      throw new OpError(`update: "${key}" is not a field this op may remove.`);
    }
    if (!mayRemove(key)) {
      throw new OpError(
        `update: "${key}" is required on every node and cannot be removed. A ` +
          `node without it is not a node, and the inverse could not restore one.`
      );
    }
  }
}

/**
 * Refuses a node whose shape the document could not hold.
 *
 * The engine's tree primitives place a node without inspecting it, so an
 * `insert` carrying `{ id: "bad" }` produces a NEW forest and every check that
 * asks the primitive whether it acted reports success. The document is then
 * holding something that is not a node, and the failure surfaces at render or
 * at the next save — far from the op that caused it, and by then in the history
 * as an edit that appeared to work.
 *
 * The whole SUBTREE, because an insert places one. A check on the root would
 * pass a container whose children are junk, and those children are just as much
 * in the document afterwards.
 *
 * What it does not do is decide whether the node is MEANINGFUL — whether its
 * type is registered, its styles legal, its bindings resolvable. That is the
 * engine's `validate()`, which the editor runs where a block registry is in
 * hand. See {@link NODE_FIELDS} for why the split is there.
 */
function assertNodeShape(
  node: BlockNode,
  verb: string,
  limits: DocumentLimits
): void {
  const seen = new Set<unknown>();
  // An explicit stack rather than recursion. A well-formed but very deep
  // subtree from an agent exhausts the JavaScript stack, and a `RangeError`
  // leaving this module is the same failure as any other native throw: the
  // caller cannot tell a bad op from a broken editor.
  const pending: Array<{ candidate: unknown; path: string; depth: number }> = [
    { candidate: node, path: "the node", depth: 1 },
  ];

  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    const { candidate, path, depth } = entry;

    // The engine's own limit, asked rather than restated. A subtree deeper than
    // a document may hold is refused here rather than after it is placed.
    if (depth > limits.maxDepth) {
      throw new OpError(
        `${verb}: ${path} is nested deeper than ${String(limits.maxDepth)} levels, ` +
          `which is as deep as a document goes.`
      );
    }

    if (!isPlainRecord(candidate)) {
      throw new OpError(
        `${verb}: ${path} is ${describe(candidate)}, which is not a node. ` +
          `A node is a record with an id, a type, a version and props.`
      );
    }
    // A subtree arriving from an in-process caller can be cyclic — JSON cannot
    // express that, but a caller holding live objects can, and the walk would
    // not return.
    if (seen.has(candidate)) {
      throw new OpError(
        `${verb}: ${path} appears inside itself. A node cannot contain the ` +
          `subtree it belongs to.`
      );
    }
    seen.add(candidate);

    // The container, before a single field is read. A required `props` that is
    // non-enumerable is accepted by the loop below and then serializes away, so
    // the live document holds a node the stored one does not; a top-level
    // accessor would run here for the same reason. The same rule the patch and
    // every nested record already answer to.
    if (!hasOnlyJsonOwnKeys(candidate)) {
      throw new OpError(
        `${verb}: ${path} carries keys JSON cannot write, so the stored node ` +
          `would differ from the one in the document.`
      );
    }

    for (const [field, contract] of Object.entries(NODE_FIELDS)) {
      const value = candidate[field];
      if (value === undefined) {
        if (contract.optional) continue;
        throw new OpError(
          `${verb}: ${path} has no ${field}, which every node needs.`
        );
      }
      // Same ordering as the patch check, for the same reason: a shape
      // predicate enumerates what it is handed, so an accessor would run before
      // anything established the value was plain data.
      //
      // `slots` is the exception, and deliberately so. Its contents are CHILD
      // NODES, which this walk already reaches one at a time — running the
      // recursive JSON check over them would both ask the same question twice
      // and recurse without a depth bound, overflowing the stack on a subtree
      // deeper than the limit before the bounded walk below could refuse it.
      // Its own keys still get the descriptor rule, so an accessor on the slot
      // map or on a slot's array cannot run either.
      if (field === "slots") {
        const safe =
          isPlainRecord(value) &&
          hasOnlyJsonOwnKeys(value) &&
          Object.values(value).every(
            entry => Array.isArray(entry) && hasOnlyJsonOwnKeys(entry as object)
          );
        if (!safe) {
          throw new OpError(
            `${verb}: ${path}.slots names child regions JSON cannot carry ` +
              `unchanged, so they would replay as something else.`
          );
        }
      } else if (!isJsonValue(value)) {
        throw new OpError(
          `${verb}: ${path}.${field} holds a value JSON cannot carry ` +
            `unchanged, so it would replay as something else.`
        );
      }
      if (!contract.holds(value)) {
        throw new OpError(
          `${verb}: ${path}.${field} cannot hold ${describe(value)}.`
        );
      }
    }

    const slots: unknown = candidate.slots;
    if (!isPlainRecord(slots)) continue;
    for (const [slot, children] of Object.entries(slots)) {
      // The same policy a destination position is held to. A subtree carrying
      // `slots.__proto__` reaches the engine's slot rebuild, where assigning
      // that name sets the prototype instead of creating an own key and the
      // whole child list disappears during an unrelated later edit.
      if (!isUsableSlotName(slot)) {
        throw new OpError(
          `${verb}: ${path} carries a slot named "${slot}", which every object ` +
            `already inherits. Its children could not be told apart from that ` +
            `member, and rebuilding the slot map would drop them.`
        );
      }
      const list = children as unknown[];
      // An INDEX loop, for the same reason the string-array check uses one:
      // `forEach` skips holes, so a sparse slot array would be walked as
      // though the missing entries were not there. They serialize as `null`,
      // and a `null` in a child list is not a node.
      for (let index = 0; index < list.length; index += 1) {
        pending.push({
          candidate: list[index],
          path: `${path}.slots.${slot}[${index}]`,
          depth: depth + 1,
        });
      }
    }
  }
}

/**
 * Refuses an edit whose RESULT would exceed what the engine will store.
 *
 * The engine's builders place whatever they are handed, so an edit past either
 * cap enters history as a success — and the strict validator then refuses every
 * save and publish afterwards. The author is left with a document they cannot
 * store and an undo entry for the edit that did it.
 *
 * Measured on the forest the op actually produced, never on an estimate of it.
 * Estimating is what the earlier version did, and both of its estimates were
 * wrong in the permissive direction: it summed the incoming subtree as a new
 * ROOT, so an insert into a slot never counted the slot's own key, and an
 * `update` was not measured at all because there was no subtree to add. A
 * measurement of the result cannot drift from the placement, because it IS the
 * placement.
 *
 * Safe to run after the builder because the builders are pure — they copy at
 * every level and return the original forest untouched when they refuse — so
 * nothing is committed until `applyOp` returns. The quota is still enforced
 * before any caller can adopt the result, which is what a quota has to promise.
 *
 * Counted with the engine's own `countNodes` and `documentBytes` against its own
 * `MAX_NODES` and `DEFAULT_MAX_DOCUMENT_BYTES`, for the same reason the depth
 * bound asks `MAX_DEPTH`: a second opinion about how large a document may be is
 * a second contract to keep in step.
 */
function assertFitsCaps(
  result: BlockDocument,
  verb: string,
  limits: DocumentLimits
): void {
  const total = countNodes(result.nodes);
  if (total > limits.maxNodes) {
    throw new OpError(
      `${verb}: this would leave the document holding ${String(total)} nodes, ` +
        `past the ${String(limits.maxNodes)} a document may hold. The edit would ` +
        `apply and then fail to save.`
    );
  }
  // Size as well as count. A single large string passes a node count and still
  // puts the document past what the engine will store, with the same result:
  // the edit applies, enters history, and every save afterwards is refused.
  const bytes = documentBytes(result);
  if (bytes > limits.maxBytes) {
    throw new OpError(
      `${verb}: this would leave the document at ${String(bytes)} bytes, past ` +
        `the ${String(limits.maxBytes)} it may hold. The edit would ` +
        `apply and then fail to save.`
    );
  }
}

/**
 * Refuses an id the document holds more than once.
 *
 * `removeNode` filters EVERY child whose id matches, at the top level and in
 * every slot, while the inverse this module derives captures one node and one
 * location. So a document that already carries a duplicate id loses the second
 * subtree on remove and the undo restores only the first — a silent deletion
 * that no later read can attribute to the edit that caused it. `move`
 * delegates through the same filter and destroys the duplicate the same way.
 *
 * Refused rather than repaired. Which of two nodes sharing an id the author
 * meant is not knowable here, and picking one would make the op layer decide a
 * question the document itself has no answer to. Ids are identity: a document
 * holding two is already broken, and the honest response is to say so rather
 * than to edit it further.
 */
function assertIdIsUnique(nodes: BlockNode[], id: string, verb: string): void {
  let seen = 0;
  walkNodes(nodes, node => {
    if (node.id === id) seen += 1;
  });
  if (seen > 1) {
    throw new OpError(
      `${verb}: "${id}" addresses ${String(seen)} nodes, and an id is ` +
        `identity. Removing or moving it would delete every one of them while ` +
        `the undo restored a single node, so the rest would vanish with no ` +
        `record of the edit that took them.`
    );
  }
}

/**
 * Refuses an id that addresses nothing.
 *
 * `findNode` answers `undefined` for a non-string just as it does for an id the
 * document does not hold, so without this the two are indistinguishable to the
 * caller: a `remove` carrying `id: null` is reported as a missing node, which
 * sends the reader looking for a deleted block rather than at the malformed op
 * in front of them. The refusal is the same; only the diagnosis differs, and
 * the diagnosis is the whole value.
 */
function assertNodeId(id: string, verb: string): void {
  if (!isNonEmptyString(id)) {
    throw new OpError(`${verb}: an id of ${describe(id)} addresses no node.`);
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
function assertPositionContainer(at: unknown, verb: string): void {
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

function assertPosition(at: TreePosition, verb: string): void {
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
  if (!Number.isInteger(at.index) || at.index < 0) {
    throw new OpError(
      `${verb}: an index of ${describe(at.index)} names no position. ` +
        `A missing or non-numeric index reaches the splice as NaN and puts the ` +
        `node at the front of its parent, which reads as a deliberate move.`
    );
  }
  if (at.parentId !== undefined && typeof at.parentId !== "string") {
    throw new OpError(
      `${verb}: a parent id of ${describe(at.parentId)} addresses nothing.`
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
  if (typeof at.slot === "string" && !isUsableSlotName(at.slot)) {
    throw new OpError(
      `${verb}: "${at.slot}" is not a usable slot name. It resolves to a ` +
        `member every object inherits, so the document's own children could ` +
        `not be told apart from it.`
    );
  }
  if (at.parentId !== undefined && typeof at.slot !== "string") {
    throw new OpError(
      `${verb}: a position inside "${at.parentId}" must name its slot as a ` +
        `string; ${describe(at.slot)} would create a child region no ` +
        `block declared.`
    );
  }
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
  readonly document: BlockDocument;
  readonly inverse: BuilderOp;
}

/**
 * The same document with a new forest in it.
 *
 * Spread rather than rebuilt, so `settings`, `assets` and any field the format
 * gains later survive an edit without this module being taught about them. A
 * synthesized envelope silently drops whatever it does not name, and what it
 * drops is invisible until something reads the field that vanished.
 */
function withNodes(document: BlockDocument, nodes: BlockNode[]): BlockDocument {
  return { ...document, nodes };
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
  document: BlockDocument,
  op: BuilderOp,
  limits: DocumentLimits = DEFAULT_LIMITS
): AppliedOp {
  // The document itself, before its forest is read. An op arrives beside a
  // document from storage, so neither is more trustworthy than the other.
  if (!isPlainRecord(document) || !Array.isArray(document.nodes)) {
    throw new OpError(
      `a document of ${describe(document)} holds no forest to edit. Every ` +
        `document is a record whose nodes are an array.`
    );
  }
  const nodes = document.nodes;
  // Every ENTRY, not just the array. A stored forest carrying a `null` or a
  // primitive passes the array check and then reaches helpers that read `.id`
  // off it, so the failure surfaces as a TypeError from inside the engine
  // rather than as a refusal naming the malformed document.
  for (const entry of nodes) {
    if (!isPlainRecord(entry)) {
      throw new OpError(
        `a document holding ${describe(entry)} among its nodes is malformed. ` +
          `Every entry in a forest is a node.`
      );
    }
  }

  // The op itself, before its discriminant is read. `op.kind` on a `null`
  // leaves this module as a TypeError, which a caller cannot distinguish from
  // the editor having a bug — and the whole point of `OpError` is that a
  // refusal says which op was wrong and why.
  if (!isPlainRecord(op) || !hasOnlyJsonOwnKeys(op)) {
    throw new OpError(
      `an op of ${describe(op)} is not an edit. Every op is a record ` +
        `naming its kind.`
    );
  }

  switch (op.kind) {
    case "insert": {
      // Refused rather than exempting the inverse from the lock. The inverse of
      // an insert is a remove, and a remove refuses a locked subtree — so
      // accepting this would put the document one edit from a state its own
      // undo could not leave. The alternative was a flag saying "this remove is
      // an undo", and a flag is a claim any caller can make: an op arrives from
      // storage, so nothing distinguishes the store's own inverse from a
      // forged one. Refusing at the door needs no such distinction.
      assertPositionContainer(op.at, "insert");
      assertPosition(op.at, "insert");
      // A parent id held twice places the incoming node under BOTH, which mints
      // duplicate ids the inverse cannot unpick — the destination side of the
      // same identity defect the addressed id already refuses.
      if (op.at.parentId !== undefined) {
        assertIdIsUnique(nodes, op.at.parentId, "insert");
      }
      // Before `lockedWithin` walks it and before the engine places it. Both
      // accept whatever they are handed, so a malformed subtree is in the
      // document by the time anything downstream could object.
      assertNodeShape(op.node, "insert", limits);
      const lockedId = lockedWithin(op.node);
      if (lockedId !== undefined) {
        throw new OpError(
          `insert: "${lockedId}" arrives locked, and a locked node cannot be ` +
            `removed — so this insert could never be undone. Unlock it before ` +
            `adding it to the document.`
        );
      }
      const placed = accepted(
        nodes,
        insertNode(nodes, op.node, op.at),
        `insert: the document did not accept "${op.node.id}" at the position ` +
          `given. The position may name a parent the document does not hold ` +
          `or omit the slot it needs, or the subtree may carry an id the ` +
          `document already uses — ids are identity, so a repeat would make ` +
          `every later op ambiguous about which node it addresses.`
      );
      // Measured on the placed forest rather than on the loose subtree, which
      // is what makes an insert into a slot count the slot's own key.
      assertFitsCaps(withNodes(document, placed), "insert", limits);
      return {
        document: withNodes(document, placed),
        inverse: { kind: "remove", id: op.node.id },
      };
    }

    case "remove": {
      assertNodeId(op.id, "remove");
      const node = findNode(nodes, op.id);
      const location = locateNode(nodes, op.id);
      if (node === undefined || location === undefined) {
        throw new OpError(
          `remove: no node with id "${op.id}" in the document.`
        );
      }

      assertIdIsUnique(nodes, op.id, "remove");
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
        document: withNodes(
          document,
          accepted(
            nodes,
            removeNode(nodes, op.id),
            `remove: the document did not accept removing "${op.id}".`
          )
        ),
        inverse: { kind: "insert", node, at: positionOf(location) },
      };
    }

    case "move": {
      assertNodeId(op.id, "move");
      const node = findNode(nodes, op.id);
      const location = locateNode(nodes, op.id);
      if (node === undefined || location === undefined) {
        throw new OpError(`move: no node with id "${op.id}" in the document.`);
      }
      assertIdIsUnique(nodes, op.id, "move");
      assertPositionContainer(op.to, "move");
      assertPosition(op.to, "move");
      if (op.to.parentId !== undefined) {
        assertIdIsUnique(nodes, op.to.parentId, "move");
      }
      const lockedMoving = lockedWithin(node);
      if (lockedMoving !== undefined) {
        throw new OpError(
          `move: "${lockedMoving}" is locked and sits inside what this would ` +
            `relocate. A lock is easier to rely on when it means one thing — ` +
            `this node does not move or disappear until you unlock it — than ` +
            `when it holds for the node and not for the section around it.`
        );
      }
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
      // A move keeps the node count and can still grow the document: relocating
      // into a slot the parent did not have yet adds that slot's name to what is
      // stored, and a long enough name crosses the byte cap on its own.
      assertFitsCaps(withNodes(document, moved), "move", limits);
      return {
        document: withNodes(document, moved),
        inverse: { kind: "move", id: op.id, to: positionOf(location) },
      };
    }

    case "update": {
      assertNodeId(op.id, "update");
      const node = findNode(nodes, op.id);
      if (node === undefined) {
        throw new OpError(
          `update: no node with id "${op.id}" in the document.`
        );
      }
      assertIdIsUnique(nodes, op.id, "update");
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
      // Compared by serialized content, not by reference. A persisted patch is
      // freshly parsed, so `{ props: {} }` is never the same object as the
      // node's `{}` and a reference test calls every replayed op a change —
      // which is the invisible history entry this guard exists to refuse.
      // Safe to serialize: `assertPatchNames` has already refused any value
      // outside the JSON domain, so neither side can make `stringify` throw.
      const same = (a: unknown, b: unknown): boolean =>
        a === b || JSON.stringify(a) === JSON.stringify(b);
      const changesSomething = touched.some(key =>
        (op.unset ?? []).includes(key)
          ? held[key] !== undefined
          : !same(held[key], (op.patch as Record<string, unknown>)[key])
      );
      if (!changesSomething) {
        throw new OpError(
          `update: "${op.id}" already holds every value this op would write, ` +
            `so it changes nothing. A history entry for it would undo to no ` +
            `visible effect.`
        );
      }

      // An update changes no node count and is the easiest way past the byte
      // cap: one large string in `props` is a document the engine will refuse
      // to store, written by an edit nothing objected to.
      const updated = updateNode(nodes, op.id, { ...op.patch, ...removals });
      assertFitsCaps(withNodes(document, updated), "update", limits);
      return {
        document: withNodes(document, updated),
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
        `unknown op kind: ${describe((unreachable as { kind?: unknown }).kind)}. ` +
          `This document may have been edited by a newer version of the editor.`
      );
    }
  }
}
