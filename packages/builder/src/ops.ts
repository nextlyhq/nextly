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
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  measureBytes,
  findNode,
  isNodeType,
  isNodeVersion,
  isPlainRecord,
  treeDepth,
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
type RemovableField = {
  [K in PatchField]: IsOptional<BlockNode, K> extends true ? K : never;
}[PatchField];

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

/** Whether a name is a field an update may remove, narrowing it to the union. */
function isRemovableField(key: string): key is RemovableField {
  return isPatchField(key) && mayRemove(key);
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
/**
 * How much of an untrusted value a diagnostic may quote.
 *
 * An op arrives from storage or from an agent, so the values named in these
 * messages are attacker-controlled. Interpolating one whole turns a 5 MB
 * malformed id into a 5 MB `OpError.message` — the memory doubled, and then
 * carried into every log and telemetry sink that records the refusal. The
 * message exists to tell an author which value was wrong, and a hundred
 * characters does that as well as five million.
 */
const MAX_QUOTED_LENGTH = 100;

/**
 * How long a refusal may be, whatever it names.
 *
 * A ceiling on the whole message rather than on each value it quotes. Generous
 * enough that no message this module writes is ever truncated by it — the
 * longest run well under a thousand characters — and low enough that an
 * untrusted value cannot ride out through a site that interpolated it directly.
 */
const MAX_MESSAGE_LENGTH = 2_000;

/**
 * An untrusted string cut to what a message may carry, without quoting it.
 *
 * Separate from {@link describe} so the two places that need a bounded string —
 * a quoted value and a path segment — share one implementation of the cut
 * rather than each carrying its own. A second copy agrees on the day it is
 * written and drifts the moment either limit moves.
 */
function clipped(value: string): string {
  return value.length > MAX_QUOTED_LENGTH
    ? `${value.slice(0, MAX_QUOTED_LENGTH)}…`
    : value;
}

function describe(value: unknown): string {
  if (typeof value === "string") {
    return `"${clipped(value)}"`;
  }
  // Numbers included: `BigInt` has no length bound either, and a literal with
  // millions of digits is as long a string as any.
  if (typeof value === "bigint") {
    return `${clipped(String(value))}n`;
  }
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
/**
 * How deep a single VALUE inside a node may nest.
 *
 * Not the node-tree depth, which `limits.maxDepth` governs: this bounds one
 * `props` or `styles` value. `JSON.stringify` is itself recursive and overflows
 * the stack in the low thousands, so a value nested past that crashes
 * serialization — in the byte cap, in the no-op comparison, in persistence —
 * before anything can refuse it. Bounding the walk turns that native
 * `RangeError` into an `OpError` naming the document.
 *
 * Generous against real content and far below where the engine gives out: a
 * hand-authored prop is single digits deep, and a generated one rarely passes
 * a few dozen.
 */
const MAX_VALUE_DEPTH = 512;

/**
 * How many parts a value may have before it is refused unexamined.
 *
 * A machine limit like {@link MAX_WALKABLE_DEPTH}, not a product one. The domain
 * walks below visit every key and every element, so a shallow object with
 * millions of enumerable properties costs a full traversal — and an in-process
 * or agent-written op can carry one. The byte cap would refuse such a value, but
 * only after these walks have already paid for it, which is the wrong order for
 * a guard whose job is to reject.
 *
 * Set well above `DEFAULT_LIMITS.maxBytes`, which is 2 MiB: every part
 * contributes at least one byte to serialized JSON, so a value with more parts
 * than this has more bytes than any default-configured document may hold, and
 * refusing it unexamined agrees with the answer a full walk would have reached.
 * A site that raises `maxBytes` past this is choosing a document larger than the
 * editor will edit, which the machine caps already say elsewhere.
 *
 * What this bounds, precisely: the descriptor lookups, the nested traversal and
 * the value reads, which are the costs that grow with what the value CONTAINS.
 * It does not bound `Reflect.ownKeys` itself, which materialises the key list in
 * one call before any loop can stop — and it cannot, because there is no way to
 * enumerate own keys including non-enumerable and symbol ones without building
 * that list. The op is already in memory by then, so this doubles a cost the
 * caller has paid rather than admitting an unbounded new one.
 */
const MAX_VALUE_PARTS = 4 * 1024 * 1024;

/**
 * How deep a node TREE may nest before the engine's helpers cannot walk it.
 *
 * A machine limit, not a product one: `limits.maxDepth` is a rule a site may
 * set and this is the point past which `findNode`, `locateNode` and
 * `lockedWithin` overflow the stack whatever any site says. Well beyond
 * `DEFAULT_LIMITS.maxDepth`, so it only ever fires on documents no product
 * setting would have allowed.
 */
const MAX_WALKABLE_DEPTH = 1_000;

/**
 * Limits that constrain SHAPE and nothing else.
 *
 * `assertNodeShape` answers two questions at once — is this a well-formed node,
 * and does it fit what a document may hold — and the second is wrong when the
 * subtree is one being REMOVED. It is already in the document; asking whether
 * it would fit today refuses the edit that repairs a lowered cap.
 *
 * Depth stays at the machine bound rather than going away, because that one is
 * not a product rule: past it the engine's recursive helpers cannot walk the
 * subtree at all, so an inverse carrying it could not be applied by anything.
 */
const SHAPE_ONLY_LIMITS: DocumentLimits = {
  maxDepth: MAX_WALKABLE_DEPTH,
  maxNodes: Number.MAX_SAFE_INTEGER,
  maxBytes: Number.MAX_SAFE_INTEGER,
};

/**
 * Refuses caps that cannot decide anything.
 *
 * A limit is only a limit if a comparison against it can come out false. `NaN`
 * fails that in the most dangerous way — every `>` against it is false, so the
 * cap reports "fits" for every input rather than refusing every input, and the
 * failure is invisible at the call site.
 *
 * `Infinity` is deliberately refused too, even though it reads as "no limit".
 * The engine's own walks stop counting at the machine bounds whatever a site
 * says, so an infinite cap is not the unlimited document it promises; and a
 * fractional one refuses at a boundary no document can sit exactly on, which
 * makes the refusal message name a count no author can act on.
 */
function assertUsableLimits(limits: DocumentLimits): void {
  for (const field of ["maxDepth", "maxNodes", "maxBytes"] as const) {
    const value = limits[field];
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new OpError(
        `a document limit of ${describe(value)} for ${field} cannot decide ` +
          `anything: every comparison against it answers the same way, so the ` +
          `cap would be skipped rather than applied. Limits are whole numbers ` +
          `of at least 1.`
      );
    }
  }
}

/** Refuses a tree the engine's recursive helpers cannot walk. */
function assertWalkable(depth: number, subject: string): void {
  if (depth > MAX_WALKABLE_DEPTH) {
    throw new OpError(
      `${subject} is nested ${String(depth)} levels deep and cannot be ` +
        `edited: past ${String(MAX_WALKABLE_DEPTH)} the tree helpers exhaust ` +
        `the call stack, so no edit to it — including one that would make it ` +
        `shallower — can be applied.`
    );
  }
}

/**
 * How many values a structural comparison may visit before it gives up.
 *
 * A MACHINE bound, deliberately not derived from `limits.maxBytes`. Deriving it
 * from the byte cap read as sound — a value with more parts than the cap has
 * bytes cannot fit under it — but that reasoning holds only while the cap check
 * downstream is entitled to refuse the result, and the repairability rule says
 * it is not. A site that lowers `maxBytes` under an existing document leaves an
 * update that rewrites an identical over-cap value exhausting the budget,
 * reported as a change, and then permitted by the cap check because it is
 * exactly the size the document already was: a no-op recorded in history whose
 * inverse is also a no-op, which is the entry this comparison exists to refuse.
 *
 * At the machine bound it is decisive instead of merely safe. `equalWithin`
 * descends only where both sides agree structurally, so the walk is driven by
 * the side taken from the document — and {@link assertForestEntries} has
 * already refused any document whose held values exceed this many parts. No
 * value reaching the comparison can exhaust it, so the "ran out" answer stops
 * being reachable rather than staying reachable and safe.
 */
const COMPARISON_BUDGET = MAX_VALUE_PARTS;

/**
 * Structural equality, bounded, and never through a serializer.
 *
 * Returns `false` when the budget runs out. That direction is the safe one: a
 * pair reported different is treated as a real change, which sends the op on to
 * the cap check rather than refusing it here as a no-op. Reporting them equal
 * would refuse an edit that might have changed something, which is the answer
 * with no recovery.
 *
 * Iterative, for the reason every other walk in this module is: a deep value
 * would otherwise exhaust the call stack and leave a native RangeError where
 * this module promises an `OpError`.
 */
function equalWithin(a: unknown, b: unknown, budget: number): boolean {
  const pending: [unknown, unknown][] = [[a, b]];
  let steps = 0;
  while (pending.length > 0) {
    if (steps++ > budget) return false;
    const pair = pending.pop();
    if (pair === undefined) break;
    const [left, right] = pair;
    if (left === right) continue;
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right)) return false;
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i += 1)
        pending.push([left[i], right[i]]);
      continue;
    }
    if (isPlainRecord(left) && isPlainRecord(right)) {
      const leftKeys = Object.keys(left);
      const rightKeys = Object.keys(right);
      if (leftKeys.length !== rightKeys.length) return false;
      for (const key of leftKeys) {
        if (!Object.hasOwn(right, key)) return false;
        pending.push([left[key], right[key]]);
      }
      continue;
    }
    // Primitives that were not `===`, or one record against one primitive.
    return false;
  }
  return true;
}

/**
 * A detached copy of a value the caller still holds a reference to.
 *
 * An op is DATA describing an edit, and the document it produces has to be that
 * edit's result rather than a live view of the caller's objects. Without this,
 * an in-process producer that passes a `props` object and later mutates it
 * rewrites the applied document — and the inverse in the history alongside it —
 * with no op recorded and nothing to undo. A history whose entries change after
 * the fact is not a history.
 *
 * Safe here because it runs only AFTER the value has been established as JSON:
 * no accessors, no cycles, no functions, nothing outside the domain, and
 * bounded in depth and parts. `structuredClone` would throw on the values this
 * module refuses, and by this point it cannot meet one.
 */
function snapshot<T>(value: T): T {
  return structuredClone(value);
}

function isJsonValue(value: unknown): boolean {
  // ITERATIVE, with an explicit stack. The recursive form exhausted the JS
  // stack on a deeply nested but otherwise legal value and leaked a native
  // RangeError, so a document could crash the guard that exists to refuse it
  // — and the byte cap never got the chance to reject it either.
  //
  // `open` tracks the ancestors of the value currently being read, which is
  // what makes a cycle detectable: a value that is its own descendant has no
  // JSON form and would otherwise make this walk run forever. Entries are
  // popped off `open` when their subtree is finished, so a value appearing
  // twice as SIBLINGS is legal, as JSON allows.
  const open = new Set<object>();
  const pending: { value: unknown; depth: number; exiting?: object }[] = [
    { value, depth: 1 },
  ];

  // Bounded as well as iterative. Depth is not the only way a value gets too
  // big to examine: a SHALLOW object with millions of properties costs a full
  // traversal here, before any cap has had the chance to refuse it.
  let parts = 0;
  while (pending.length > 0) {
    if (parts++ > MAX_VALUE_PARTS) return false;
    const entry = pending.pop();
    if (entry === undefined) break;
    if (entry.exiting !== undefined) {
      open.delete(entry.exiting);
      continue;
    }
    if (entry.depth > MAX_VALUE_DEPTH) return false;
    const current = entry.value;
    if (current === null) continue;
    if (typeof current === "string" || typeof current === "boolean") continue;
    if (typeof current === "number") {
      if (!Number.isFinite(current) || Object.is(current, -0)) return false;
      continue;
    }
    if (typeof current !== "object") return false;

    const held: object = current;
    if (open.has(held)) return false;
    if (!hasOnlyJsonOwnKeys(held)) return false;
    open.add(held);
    pending.push({ value: undefined, depth: entry.depth, exiting: held });

    if (Array.isArray(held)) {
      // The LENGTH first, before a single element is enqueued. Counting while
      // enqueueing still pays for the whole budget before refusing — four
      // million allocations, which is seconds under an instrumented runner and
      // was enough to time CI out while finishing in under one second here. An
      // array longer than the budget cannot fit under it whatever its contents
      // are, and that is knowable in one comparison.
      if (parts + held.length > MAX_VALUE_PARTS) return false;
      parts += held.length;
      // By index: `every` skips holes, and a hole serializes as `null`.
      for (let index = 0; index < held.length; index += 1) {
        pending.push({ value: held[index], depth: entry.depth + 1 });
      }
      continue;
    }
    if (!isPlainRecord(held)) return false;
    const members = Object.values(held);
    if (parts + members.length > MAX_VALUE_PARTS) return false;
    parts += members.length;
    for (const child of members) {
      pending.push({ value: child, depth: entry.depth + 1 });
    }
  }
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
  // Counted while enumerating, for the reason {@link MAX_VALUE_PARTS} exists:
  // `Reflect.ownKeys` on an object with millions of properties materialises
  // them all, and the byte cap that would refuse such a value has not run yet.
  let parts = 0;
  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (parts++ > MAX_VALUE_PARTS) return false;
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
    if (parts++ > MAX_VALUE_PARTS) return false;
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
/**
 * Where an op places a node: at the top level, or inside a named slot.
 *
 * A union rather than three independent optional fields, because the engine's
 * `TreePosition` makes `parentId` and `slot` optional of each other and the two
 * are not independent: naming a parent without a slot does not say where in
 * that parent the node goes, and `applyOp` has always refused it. Left as one
 * loose shape, a caller with a compiler can write `{ parentId: "outer", index:
 * 0 }`, put it in a typed history or a queue, and find out only when the op
 * executes — by which time it is recorded and its inverse is meaningless.
 *
 * Narrowed HERE rather than in the engine. `TreePosition` is the engine's
 * published type and its shape is what every other caller compiles against;
 * this is the op vocabulary's own statement of what an op may say, and it stays
 * assignable to `TreePosition` so the engine's helpers take it unchanged.
 *
 * The runtime checks remain, for the ops that arrive from storage having never
 * met a compiler.
 */
export type OpPosition =
  | {
      readonly parentId?: undefined;
      readonly slot?: undefined;
      readonly index: number;
    }
  | {
      readonly parentId: string;
      readonly slot: string;
      readonly index: number;
    };

/**
 * A slot an op should remove, IF the op leaves it empty.
 *
 * Placing a node into a slot the destination parent does not have makes the
 * engine create that slot, and removing the node again leaves it behind as an
 * empty array. An undo that restores every node and adds a region the author
 * never made has not undone the edit — the page-builder validator rejects an
 * undeclared empty slot, and no update can delete one, because updates exclude
 * `slots`.
 *
 * Carried on the INVERSE, derived by the store from what the placement actually
 * did rather than declared by a caller. Nothing else in this vocabulary can
 * express "and put the parent back the way it was".
 *
 * **If empty** is the whole of it, and it is what makes the field safe to
 * replay. By the time an undo runs, later edits may have put other nodes in
 * that slot; dropping it then would delete work nobody asked to delete. So this
 * is a request that the store checks rather than a command it obeys, and a slot
 * someone has since filled simply stays.
 */
export interface SlotAddress {
  readonly parentId: string;
  readonly slot: string;
  /**
   * Whether the placement created the parent's `slots` container itself.
   *
   * Removing the last slot is not the same edit as removing the container that
   * held it. A parent that arrived with an explicit `slots: {}` — which the
   * page-builder preserves deliberately for a block whose type it does not
   * recognise — must get that back, not lose the field. Only a placement that
   * created both may take both away.
   */
  readonly containerCreated?: boolean;
}

export type BuilderOp =
  | {
      readonly kind: "insert";
      readonly node: BlockNode;
      readonly at: OpPosition;
    }
  | {
      readonly kind: "remove";
      readonly id: string;
      readonly dropSlotIfEmpty?: SlotAddress;
    }
  | {
      readonly kind: "move";
      readonly id: string;
      readonly to: OpPosition;
      readonly dropSlotIfEmpty?: SlotAddress;
    }
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
      readonly unset?: readonly RemovableField[];
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
    // A backstop on what is STORED, and only that. The values these messages
    // name come from storage or from an agent, so they are
    // attacker-controlled: a 5 MB malformed id produced a 5 MB `message` and
    // carried it into every log and telemetry sink that records the refusal.
    // Every message passes through here, so no site can put an unbounded one
    // into a log.
    //
    // What it cannot bound is the ALLOCATION, because a template literal is
    // fully evaluated before the constructor is entered: a site interpolating a
    // 5 MB id builds the 5 MB string first and this slices a copy of it. That
    // is why the sites render untrusted values through `describe` or `clipped`
    // instead of interpolating them directly — the cut has to happen where the
    // string is composed, and this only catches what escapes that.
    super(
      message.length > MAX_MESSAGE_LENGTH
        ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…`
        : message
    );
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
        `update: ${describe(key)} is not a field this op may set. Ids and types are ` +
          `identity, children move through the structural ops, and anything ` +
          `else named here is not part of a node.`
      );
    }
    if (value === undefined) {
      throw new OpError(
        `update: ${describe(key)} is set to undefined. A value that disappears when the ` +
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
        `update: ${describe(key)} holds a value JSON cannot carry unchanged. A patch ` +
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
        `update: ${describe(key)} cannot hold ${describe(value)}. Writing it ` +
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

  // Read back as plain strings. `unset` is TYPED to the removable fields, which
  // is what stops a caller with a compiler naming `id` or `version` — but this
  // function exists for the ops that never met a compiler, and against those
  // the declared type is a claim rather than a fact. Iterating the narrowed
  // type would make both checks below look statically unreachable and leave
  // persisted input unguarded.
  const names: readonly string[] = op.unset ?? [];
  // A field cannot be both written and removed by one op. The spread that
  // applies the edit puts removals last, so the removal silently wins and the
  // value the caller supplied is discarded — an op recorded as accepted that
  // did something other than what it said. An agent producing both is stating
  // two intentions, and guessing which one it meant is worse than refusing.
  for (const key of names) {
    if (isPlainRecord(op.patch) && Object.hasOwn(op.patch, key)) {
      throw new OpError(
        `update: ${describe(key)} is named both as a value to write and as a field to ` +
          `remove. One op cannot do both, and applying it would keep neither ` +
          `the value nor a record of which was meant.`
      );
    }
  }
  for (const key of names) {
    if (!isPatchField(key)) {
      throw new OpError(
        `update: ${describe(key)} is not a field this op may remove.`
      );
    }
    if (!mayRemove(key)) {
      throw new OpError(
        `update: ${describe(key)} is required on every node and cannot be removed. A ` +
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

  // Counted as it is ENQUEUED, not as it is popped, and against one running
  // total. A subtree that already holds more nodes than a whole document may is
  // going to be refused by the cap check either way — but that check runs after
  // this walk has validated every descendant and after `insertNode` has walked
  // the subtree a second time to place it. Refusing at `maxNodes + 1` turns
  // work proportional to what the caller sent into work proportional to what
  // the document is allowed to hold.
  //
  // Counting on the way OUT is what made that guarantee false. A pop-side total
  // stays at 1 for as long as the root is being processed, so each slot's
  // length was compared against the cap on its own: a subtree with thousands of
  // slots holding 4,999 sparse entries each passes a 5,000-node limit slot by
  // slot and enqueues millions of entries before the first is popped. Every
  // entry pushed becomes a node or is refused as not being one, so the enqueued
  // total is the quantity the cap is about, and one counter answers for the
  // whole walk instead of each list answering for itself.
  //
  // Starts at 1 for the root, which `pending` already holds.
  let queued = 1;
  const enqueue = (list: readonly unknown[], describePath: string): void => {
    if (queued + list.length > limits.maxNodes) {
      throw new OpError(
        `${verb}: ${describePath} would put this subtree past the ` +
          `${String(limits.maxNodes)} nodes a whole document may hold, so no ` +
          `document could hold it. The edit would apply and then fail to save.`
      );
    }
    queued += list.length;
  };

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

    // Every OTHER own key's value. The loop below reads the fields this module
    // knows; a node may legitimately carry more, because a document written by
    // a newer version is data to be moved rather than an instruction to follow.
    // What it may not carry is a value JSON cannot write: the node would enter
    // the document and the next save would fail on it. Worse, a field pointing
    // back at its own node makes the byte counter walk forever, so this has to
    // run before anything measures the subtree.
    //
    // Preserved rather than rejected, deliberately. Refusing an unknown field
    // would make a document from a newer editor uneditable by this one, which
    // is the failure that costs an author their work rather than an edit.
    for (const [key, extra] of Object.entries(candidate)) {
      if (Object.hasOwn(NODE_FIELDS, key)) continue;
      if (!isJsonValue(extra)) {
        throw new OpError(
          `${verb}: ${path} carries ${describe(key)}, which holds ${describe(extra)} — ` +
            `a value JSON cannot write. The node would enter the document and ` +
            `the next save would be refused.`
        );
      }
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
          `${verb}: ${path} carries a slot named ${describe(slot)}, which every object ` +
            `already inherits. Its children could not be told apart from that ` +
            `member, and rebuilding the slot map would drop them.`
        );
      }
      const list = children as unknown[];
      // The LENGTH before the elements, like every other list this module
      // reads, and against the total rather than this list alone. Copying first
      // means a sparse `Array(100_000_000)` in one slot allocates a hundred
      // million pending entries before the count can reach the cap — and the
      // cap was already knowable from the lengths.
      enqueue(list, path);
      // An INDEX loop, for the same reason the string-array check uses one:
      // `forEach` skips holes, so a sparse slot array would be walked as
      // though the missing entries were not there. They serialize as `null`,
      // and a `null` in a child list is not a node.
      for (let index = 0; index < list.length; index += 1) {
        pending.push({
          // The slot segment CUT as it is composed, not where the path is
          // finally read. A path is inherited by every descendant, so an
          // unbounded slot name is copied into one string per node beneath it
          // — the allocation the refusal exists to avoid, paid before any
          // message is built.
          candidate: list[index],
          path: `${path}.slots.${clipped(slot)}[${index}]`,
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
 * Counted with the engine's own `countNodes` and `measureBytes` against its own
 * `MAX_NODES` and `DEFAULT_MAX_DOCUMENT_BYTES`, for the same reason the depth
 * bound asks `MAX_DEPTH`: a second opinion about how large a document may be is
 * a second contract to keep in step.
 */
/**
 * Refuses a forest nested deeper than the limit allows.
 *
 * Iterative, bounded by the limit itself, so a deep document cannot overflow
 * the stack before being refused. Judged against `before` on the same
 * repairability rule as the other caps: a document already too deep may be
 * edited toward shallower, just not deeper.
 */
/**
 * Refuses a forest holding anything that is not a node, at ANY depth.
 *
 * A top-level-only pass leaves a valid root whose slot holds a `null`, and the
 * helpers then read `.id` off it — so the failure arrives as a TypeError from
 * inside the engine rather than as a refusal naming the malformed document,
 * which is the whole reason ops refuse with `OpError`.
 *
 * Iterative, so a deep document cannot overflow the stack on the way to being
 * refused.
 */
/**
 * Refuses a list whose entries are computed rather than held.
 *
 * A forest and its slot children are ARRAYS, and an array's indexes can be
 * accessors like any other property. Reading one runs the document's own code
 * inside the guard deciding whether to trust it, and a throwing getter leaves
 * this module as a native error rather than an `OpError`.
 *
 * The same rule the envelope and every value are already held to, applied to
 * the containers in between — which were the only things reading their contents
 * without checking how those contents are held.
 */
function assertListIsData(list: unknown, subject: string): void {
  if (!Array.isArray(list) || !hasOnlyJsonOwnKeys(list)) {
    throw new OpError(
      `${subject} must be a plain list of nodes. One whose entries are ` +
        `computed rather than stored cannot be edited: reading it runs code, ` +
        `and what it returns is not what would be saved.`
    );
  }
}

function assertForestEntries(nodes: BlockNode[]): void {
  // Filled by loop rather than spread: `[...nodes]` is fine, but the pushes
  // below are not, and a forest wide enough to exceed V8's call-argument cap
  // would throw before this walk could refuse it.
  // The ARRAY, before a single element of it is read. `for...of` on a list whose
  // index is an accessor RUNS that accessor, so a throwing getter escapes as a
  // native error rather than the refusal this module promises — and the same
  // list is what every check below reads from.
  assertListIsData(nodes, "a document's nodes");
  const pending: unknown[] = [];
  // Every list this walk copies is bounded BEFORE the copy, against ONE running
  // total rather than per list. Copying first means a cheap sparse
  // `Array(100_000_000)` allocates a hundred million pending entries before the
  // first `undefined` can earn a refusal; a per-list bound closes that for one
  // wide list and leaves a document spreading the same width across many slots,
  // where every individual length passes. The total is what the caller
  // declared, so the total is what the walk is bounded by.
  let enqueued = 0;
  const enqueue = (list: readonly unknown[], subject: string): void => {
    if (enqueued + list.length > MAX_VALUE_PARTS) {
      throw new OpError(
        `${subject} would put this document past the ` +
          `${String(MAX_VALUE_PARTS)} entries an edit may walk. No document ` +
          `may hold that many nodes, so the answer is settled by the lengths ` +
          `alone.`
      );
    }
    enqueued += list.length;
    for (const entry of list) pending.push(entry);
  };
  enqueue(nodes, "a document's nodes");
  // Every node reached, so a document that holds itself is refused rather than
  // walked forever. A forest is a tree by intent and not by construction: an
  // in-process document can be handed to `applyOp` with a node inside its own
  // slot, and without this the walk pops and re-enqueues that node until memory
  // runs out — a synchronous hang where the contract promises an `OpError`.
  // Identity, not id: a cycle is the same OBJECT reached twice, and two
  // distinct nodes sharing an id are a different fault with its own guard.
  const seen = new Set<unknown>();
  // Collected and checked ONCE at the end rather than per node. `isJsonValue`
  // allocates a stack and a cycle set per call, so asking it per field turned a
  // 150,000-node document into six hundred thousand of those — correct, and
  // slow enough that CI timed out where this machine did not. An array of every
  // value is itself a JSON value, so one call answers for all of them with one
  // allocation and one shared budget.
  const heldValues: unknown[] = [];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (seen.has(entry)) {
      throw new OpError(
        `a document whose nodes contain themselves is malformed. A forest is ` +
          `a tree, so no node may sit inside its own slots.`
      );
    }
    seen.add(entry);
    if (!isPlainRecord(entry)) {
      throw new OpError(
        `a document holding ${describe(entry)} among its nodes is malformed. ` +
          `Every entry in a forest is a node, at every depth.`
      );
    }
    // The NODE's own keys, before any field of it is read. `entry.slots` on a
    // node whose `slots` is an accessor runs that getter, and every helper
    // downstream reads `id`, `locked` and the rest the same way — so a document
    // that computes its fields would be executing its own code inside the guard
    // deciding whether to trust it, and a throwing getter would leave this
    // module as a native error rather than a refusal.
    if (!hasOnlyJsonOwnKeys(entry)) {
      throw new OpError(
        `a node whose fields are computed rather than stored cannot be ` +
          `edited. Reading one runs code, and what it returns is not what ` +
          `would be saved.`
      );
    }
    // What the node HOLDS, not only how it holds it. Descriptors establish that
    // a field is stored rather than computed and say nothing about the value,
    // so an untouched node carrying `props: { bad: 1n }` passed every check and
    // a removal elsewhere in the document returned a result `JSON.stringify`
    // cannot write. A remove measures nothing — it only shrinks — so no later
    // pass caught it either.
    //
    // Every node in the document rather than only the edited one, because the
    // op store's promise is about the DOCUMENT it hands back: a successful edit
    // may not return something that cannot be saved.
    for (const [field, value] of Object.entries(entry)) {
      if (field === "slots") continue;
      heldValues.push(value);
    }
    // Read as `unknown` rather than cast: the entry has only been established
    // as a record, so claiming it is a BlockNode here would assert the very
    // thing this walk exists to check.
    const slots: unknown = entry.slots;
    if (slots === undefined) continue;
    if (!isPlainRecord(slots)) {
      throw new OpError(
        `a node whose slots are ${describe(slots)} is malformed. Slots name ` +
          `child regions and each holds a list.`
      );
    }
    // The slot MAP itself, before it is enumerated. The node's own descriptors
    // were checked above, which establishes that `slots` is held rather than
    // computed — and says nothing about the properties INSIDE it. A `slots.main`
    // defined as a getter runs on the next line.
    if (!hasOnlyJsonOwnKeys(slots)) {
      throw new OpError(
        `a node whose child regions are computed rather than stored cannot be ` +
          `edited. Reading one runs code, and what it returns is not what ` +
          `would be saved.`
      );
    }
    for (const [name, children] of Object.entries(slots)) {
      // The slot NAME, by the same rule an incoming position is held to. A
      // document already holding a slot called `__proto__` is accepted by a
      // check that only looks at the value — and then the engine's `mapForest`
      // rebuilds the node by assigning into an ordinary object, where that
      // name reaches the prototype setter instead of creating an own key. The
      // slot's entire child list disappears, the update reports success, and
      // its inverse cannot restore children it never saw.
      if (!isUsableSlotName(name)) {
        throw new OpError(
          `a document holding a slot named ${describe(name)} cannot be edited. That ` +
            `name resolves to a member every object inherits, so rebuilding ` +
            `the node would drop the slot's children instead of keeping them.`
        );
      }
      if (!Array.isArray(children)) {
        throw new OpError(
          `a slot holding ${describe(children)} is malformed. Each slot holds ` +
            `a list of nodes.`
        );
      }
      // Each child list by the same rule as the root's, and before it is read.
      assertListIsData(children, "a slot's children");
      // Through the same bounded copy as the root list. Pushed one at a time
      // rather than spread: `push(...children)` passes each child as a call
      // ARGUMENT, and V8 caps those around 100k — so a slot wide enough to
      // exceed it throws a native RangeError before this walk can refuse the
      // document, and before a removal could repair it.
      enqueue(children, "a slot's children");
    }
  }

  // One walk over everything the document holds. What a node HOLDS matters as
  // much as how it holds it: descriptors say a field is stored rather than
  // computed and say nothing about the value, so an untouched node carrying a
  // value JSON cannot write made a successful edit hand back a document that
  // cannot be saved.
  if (!isJsonValue(heldValues)) {
    // The precise offender, found only once the fast path has failed. Naming
    // the field costs a second walk, and paying for it on every op to describe
    // a failure that almost never happens is the wrong trade.
    for (const value of heldValues) {
      if (isJsonValue(value)) continue;
      throw new OpError(
        `a node holding ${describe(value)} cannot be edited: JSON cannot ` +
          `write that value, so the document would not save.`
      );
    }
    throw new OpError(
      `this document holds a value JSON cannot write, so it would not save.`
    );
  }
}

function assertFitsCaps(
  before: BlockDocument,
  result: BlockDocument,
  verb: string,
  limits: DocumentLimits
): void {
  // Judged against where the document STARTED, not against the limit alone. A
  // site that lowers its caps leaves existing documents already over them, and
  // a check reading only the result refuses every edit to such a document —
  // including the removals that would bring it back under. The author is locked
  // out of repairing the only thing that can fix it.
  //
  // So an edit is refused when it crosses a cap the document was inside, or
  // makes an existing overage worse. An edit that shrinks an over-large
  // document is always allowed, even while it stays over.
  // Depth on the RESULT, for the same reason as count and bytes: checking only
  // the incoming subtree misses the depth its PLACEMENT creates. A shallow
  // subtree dropped into a deep slot produces a forest deeper than either part.
  //
  // Asked of the ENGINE rather than measured here. A second depth walk in this
  // package agrees with the engine's on the day it is written and diverges the
  // moment the engine corrects how it treats a malformed node — leaving the cap
  // check and the document model with different answers about the same tree.
  //
  // Once for each side, not once per node. Comparing every over-deep node
  // against a freshly measured original made the original's cost proportional
  // to the number of offending nodes, so lowering `maxDepth` under a broad
  // document turned a linear edit into a quadratic one.
  const depth = treeDepth(result.nodes);
  if (depth > limits.maxDepth && depth > treeDepth(before.nodes)) {
    throw new OpError(
      `${verb}: this would leave the document nested ${String(depth)} ` +
        `levels deep, past the ${String(limits.maxDepth)} it may hold.`
    );
  }
  const total = countNodes(result.nodes);
  if (total > limits.maxNodes && total > countNodes(before.nodes)) {
    throw new OpError(
      `${verb}: this would leave the document holding ${String(total)} nodes, ` +
        `past the ${String(limits.maxNodes)} a document may hold. The edit would ` +
        `apply and then fail to save.`
    );
  }
  // Size as well as count. A single large string passes a node count and still
  // puts the document past what the engine will store, with the same result:
  // the edit applies, enters history, and every save afterwards is refused.
  //
  // COUNTED rather than produced. `documentBytes` answers by building the JSON
  // string and then a UTF-8 buffer of it, so deciding "is this too big" would
  // first allocate two copies of the thing being called too big — and an op
  // carrying a value far past the cap could exhaust the editor before the
  // refusal it earns. The engine's `measureBytes` walks and counts, stopping
  // as soon as the answer is settled, and the validator already decides this
  // question with it.
  //
  // The ceiling is what makes one bounded pass decisive. The rule is that an
  // edit is refused when it crosses the cap or worsens an existing overage —
  // equivalently, when the result is larger than both the cap and the document
  // it started from. So the ceiling is the larger of the two, and the common
  // case never pays for measuring `before` in full: a document already inside
  // the cap settles it, and only one already over the cap needs its exact size,
  // which is the repair case a site creates by lowering its own limit.
  const startingSize = measureBytes(before, limits.maxBytes);
  const ceiling = startingSize.exceeded
    ? measureBytes(before, Number.POSITIVE_INFINITY).bytes
    : limits.maxBytes;
  const size = measureBytes(result, ceiling);
  if (size.exceeded) {
    throw new OpError(
      `${verb}: this would leave the document over ${String(ceiling)} bytes, ` +
        `past the ${String(limits.maxBytes)} it may hold. The edit would ` +
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
/**
 * Every id inside a subtree, root included.
 *
 * Iterative, like every other walk here: a deep subtree would otherwise
 * exhaust the stack and leave a native RangeError where this module promises
 * an `OpError`.
 */
/**
 * Refuses a `dropSlotIfEmpty` that could not be carried out or stored.
 *
 * The store derives this field itself, so a well-formed one is the only kind it
 * produces — and an op arrives from storage as often as from here, where
 * nothing checked it. A slot name reaching the prototype is the sharp case: the
 * deletion would run against an inherited member rather than an own key.
 */
function assertDropSlot(address: unknown, verb: string): void {
  if (address === undefined) return;
  if (!isPlainRecord(address) || !hasOnlyJsonOwnKeys(address)) {
    throw new OpError(
      `${verb}: a slot to drop of ${describe(address)} names nothing. It is ` +
        `a parent id and the slot to remove from it.`
    );
  }
  // Read into locals and narrowed with `typeof`, because the shape predicates
  // in this module deliberately return `boolean` rather than claiming to have
  // checked a structure they only glanced at. Narrowing here rather than
  // asserting keeps that property and still gives the checks below a string.
  const { parentId, slot } = address;
  if (typeof parentId !== "string" || parentId.length === 0) {
    throw new OpError(
      `${verb}: a slot to drop must name the parent it belongs to; ` +
        `${describe(parentId)} addresses nothing.`
    );
  }
  if (typeof slot !== "string" || slot.length === 0) {
    throw new OpError(
      `${verb}: a slot to drop must name the slot; ${describe(slot)} names ` +
        `no region.`
    );
  }
  if (!isUsableSlotName(slot)) {
    throw new OpError(
      `${verb}: ${describe(slot)} is not a usable slot name. It resolves to a member ` +
        `every object inherits, so removing it would reach the prototype ` +
        `rather than the node's own children.`
    );
  }
  const { containerCreated } = address;
  if (containerCreated !== undefined && typeof containerCreated !== "boolean") {
    throw new OpError(
      `${verb}: a slot to drop says its container was created as ` +
        `${describe(containerCreated)}, which answers neither yes nor no.`
    );
  }
}

/** Whether `parentId` already holds a slot called `slot`. */
function parentHasSlot(nodes: BlockNode[], at: OpPosition): boolean {
  if (at.parentId === undefined) return true;
  const parent = findNode(nodes, at.parentId);
  if (parent === undefined) return true;
  return Object.hasOwn(parent.slots ?? {}, at.slot);
}

/**
 * The slot an op should offer to drop when undone, or nothing.
 *
 * Asked BEFORE the placement, because afterwards the slot exists either way and
 * the question is unanswerable. A top-level position creates no slot, and a
 * parent that already had it is not having one created.
 */
function slotCreatedBy(
  nodes: BlockNode[],
  at: OpPosition
): SlotAddress | undefined {
  if (at.parentId === undefined) return undefined;
  if (parentHasSlot(nodes, at)) return undefined;
  const parent = findNode(nodes, at.parentId);
  const containerCreated = parent !== undefined && parent.slots === undefined;
  return {
    parentId: at.parentId,
    slot: at.slot,
    ...(containerCreated ? { containerCreated: true } : {}),
  };
}

/**
 * Removes the named slot when the op has left it empty.
 *
 * Returns the forest unchanged in every other case — the parent is gone, the
 * slot is gone, or something else now lives there. A later edit may have filled
 * the slot between the original op and its undo, and deleting it then would
 * take work nobody asked to delete.
 */
function dropEmptySlot(nodes: BlockNode[], address: SlotAddress): BlockNode[] {
  const parent = findNode(nodes, address.parentId);
  if (parent === undefined) return nodes;
  const children = parent.slots?.[address.slot];
  if (!Array.isArray(children) || children.length > 0) return nodes;
  return rebuild(nodes, current => {
    if (current.id !== address.parentId) return current;
    const slots = { ...(current.slots ?? {}) };
    delete slots[address.slot];
    // The container goes only if this placement made it. A parent that arrived
    // with an explicit `slots: {}` gets that back: removing the last slot and
    // removing the field that held it are different edits, and the second is
    // not one the placement performed.
    return Object.keys(slots).length === 0 && address.containerCreated === true
      ? omitSlots(current)
      : { ...current, slots };
  });
}

/**
 * Rebuilds a forest, replacing each node with what `fn` returns for it.
 *
 * The engine's `mapForest` does exactly this and is private to `tree.ts`. This
 * is the one edit the engine's own primitives cannot express — `updateNode`
 * takes a patch that excludes `slots` by construction — so the choice was
 * between this and exporting another engine internal during its API freeze.
 *
 * Recursive, and bounded by the same machine cap the engine's own version
 * relies on: `assertWalkable` has already refused anything deeper than the
 * call stack survives by the time an op is applied, so this recurses exactly as
 * deep as `insertNode` and `moveNode` already do on the same document.
 */
function rebuild(
  nodes: BlockNode[],
  fn: (node: BlockNode) => BlockNode
): BlockNode[] {
  return nodes.map(node => {
    const mapped = fn(node);
    if (mapped.slots === undefined) return mapped;
    const slots: Record<string, BlockNode[]> = {};
    for (const [name, children] of Object.entries(mapped.slots)) {
      slots[name] = rebuild(children, fn);
    }
    return { ...mapped, slots };
  });
}

/** A node without the named keys, for an update that removed fields. */
function withoutKeys(node: BlockNode, keys: readonly string[]): BlockNode {
  const next: Record<string, unknown> = { ...node };
  for (const key of keys) delete next[key];
  // Asserted rather than narrowed: `keys` has already been established as
  // removable fields, which are optional on `BlockNode` by construction, so
  // what remains satisfies the type — but only the runtime check knows that.
  return next as unknown as BlockNode;
}

/** A node without its `slots` key, for a parent whose last slot just went. */
function omitSlots(node: BlockNode): BlockNode {
  // Destructured rather than deleted from a copy: `slots` is optional on
  // `BlockNode`, so what remains is a `BlockNode` by construction and needs no
  // assertion claiming so.
  const { slots: _dropped, ...rest } = node;
  return rest;
}

function assertSubtreeIdsAreUnique(
  nodes: BlockNode[],
  root: BlockNode,
  verb: string
): void {
  // The document counted ONCE, then every id of the subtree looked up in it.
  // Asking `assertIdIsUnique` per id would rescan the whole document for each
  // one, which is quadratic in the document size — and the subtree that most
  // needs this check is the large one.
  const counts = new Map<string, number>();
  const pending: BlockNode[] = [];
  for (const entry of nodes) pending.push(entry);
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (typeof current.id === "string") {
      counts.set(current.id, (counts.get(current.id) ?? 0) + 1);
    }
    for (const children of Object.values(current.slots ?? {})) {
      if (!Array.isArray(children)) continue;
      for (const child of children) {
        if (isPlainRecord(child)) pending.push(child);
      }
    }
  }
  for (const held of subtreeIds(root)) {
    if ((counts.get(held) ?? 0) > 1) {
      throw new OpError(
        `${verb}: ${describe(held)} addresses ${String(counts.get(held))} nodes and ` +
          `sits inside what this would remove. The inverse restores the whole ` +
          `subtree by insert, and an insert repeating an id is refused — so ` +
          `this edit would apply and could never be undone.`
      );
    }
  }
}

function subtreeIds(root: BlockNode): string[] {
  const ids: string[] = [];
  const pending: BlockNode[] = [root];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    if (typeof entry.id === "string") ids.push(entry.id);
    for (const children of Object.values(entry.slots ?? {})) {
      if (!Array.isArray(children)) continue;
      for (const child of children) {
        if (isPlainRecord(child)) pending.push(child);
      }
    }
  }
  return ids;
}

function assertIdIsUnique(nodes: BlockNode[], id: string, verb: string): void {
  // Counted with an explicit stack rather than through the engine's recursive
  // `walkNodes`. A document deep enough to need repairing is exactly the one
  // that made the recursive walker throw a native RangeError here — so the
  // guard broke on the input the repair was trying to fix.
  let seen = 0;
  const pending: BlockNode[] = [];
  for (const entry of nodes) pending.push(entry);
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (current.id === id) seen += 1;
    const slots = current.slots;
    if (slots === undefined) continue;
    for (const children of Object.values(slots)) {
      for (const child of children) pending.push(child);
    }
  }
  if (seen > 1) {
    throw new OpError(
      `${verb}: ${describe(id)} addresses ${String(seen)} nodes, and an id is ` +
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
      `${verb}: ${describe(at.slot)} is not a usable slot name. It resolves to a ` +
        `member every object inherits, so the document's own children could ` +
        `not be told apart from it.`
    );
  }
  if (at.parentId !== undefined && typeof at.slot !== "string") {
    throw new OpError(
      `${verb}: a position inside ${describe(at.parentId)} must name its slot as a ` +
        `string; ${describe(at.slot)} would create a child region no ` +
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
function samePlace(a: NodeLocation, b: NodeLocation): boolean {
  return (
    a.parent?.id === b.parent?.id && a.slot === b.slot && a.index === b.index
  );
}

/** Where a located node sits, in the shape an op addresses. */
function positionOf(location: NodeLocation): OpPosition {
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
function priorValues(
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
    if (key in held && held[key] !== undefined) {
      patch[key] = held[key];
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
  // The LIMITS, before anything is judged against them. Every cap in this
  // module is a `>` comparison, and every comparison against `NaN` is false —
  // so a single non-finite limit does not loosen a cap, it removes it, and it
  // does so silently: the walk runs, the check evaluates, and the answer is
  // always "fits". `{ ...DEFAULT_LIMITS, maxBytes: NaN }` accepts a 3 MB string
  // through a 2 MiB ceiling with nothing in the result saying a cap was
  // skipped.
  //
  // Checked here rather than trusted from the type. `DocumentLimits` says these
  // are numbers, which `NaN` and the infinities satisfy; a site reading a limit
  // from configuration, an environment variable or a JSON column produces one
  // by parsing a value that was not there.
  assertUsableLimits(limits);
  // The document itself, before its forest is read. An op arrives beside a
  // document from storage, so neither is more trustworthy than the other.
  if (!isPlainRecord(document) || !Array.isArray(document.nodes)) {
    throw new OpError(
      `a document of ${describe(document)} holds no forest to edit. Every ` +
        `document is a record whose nodes are an array.`
    );
  }
  // The ENVELOPE's own keys, by the same rule its contents are held to, and
  // before anything reads a field off it.
  //
  // `withNodes` builds the result by spreading, and a spread copies enumerable
  // own properties only — so a `kind` or `formatVersion` defined as
  // non-enumerable is read and accepted by the checks below and then absent
  // from the document they admitted. The result enters history without a field
  // every document must carry, and nothing downstream is looking.
  //
  // Accessors are refused for the second reason the value checks refuse them:
  // reading one runs code, and the guard would be executing the document's own
  // getters while deciding whether to trust it.
  if (!hasOnlyJsonOwnKeys(document)) {
    throw new OpError(
      `a document carrying a field JSON cannot write, or one computed rather ` +
        `than held, cannot be edited. Every field a document names must ` +
        `survive being written down and read back.`
    );
  }
  // The envelope's VALUES, not only its keys. Descriptors say a field is held
  // rather than computed; they say nothing about what is held. An in-process
  // document carrying `metadata: 1n` satisfies every check above, and then
  // `documentBytes` leaks `TypeError: Do not know how to serialize a BigInt`
  // from inside an insert, a move or an update — while a remove, which never
  // measures bytes, succeeds and hands back a document that cannot be saved.
  //
  // The forest is excluded deliberately rather than overlooked. `isJsonValue`
  // refuses past its own value-depth bound, which is far below the depth a
  // document may legitimately reach, so walking `nodes` through it would refuse
  // documents the machine cap allows and name the wrong reason for it. The
  // forest has its own entry walk, its own depth guard and its own per-op value
  // checks; this covers the fields none of those look at.
  for (const [key, value] of Object.entries(document)) {
    if (key === "nodes") continue;
    if (!isJsonValue(value)) {
      throw new OpError(
        `a document whose ${describe(key)} is ${describe(value)} cannot be edited: ` +
          `JSON cannot write that value, so the edit would apply and then ` +
          `fail to save.`
      );
    }
  }
  const nodes = document.nodes;
  // Every ENTRY, not just the array. A stored forest carrying a `null` or a
  // primitive passes the array check and then reaches helpers that read `.id`
  // off it, so the failure surfaces as a TypeError from inside the engine
  // rather than as a refusal naming the malformed document.
  // The format this module knows how to edit. A document written by a newer
  // version may carry fields with meanings this code does not have, and editing
  // it with current semantics silently rewrites them. Refused rather than
  // guessed: an editor that cannot read a document should say so, not save over
  // it.
  if (document.formatVersion !== DOCUMENT_FORMAT_VERSION) {
    throw new OpError(
      `a document in format ${describe(document.formatVersion)} cannot be ` +
        `edited by this version, which writes format ` +
        `${String(DOCUMENT_FORMAT_VERSION)}. Editing it would rewrite fields ` +
        `whose meaning this code does not know.`
    );
  }
  // The kind, asked of the engine's own set rather than restated here. A
  // document with a missing or unknown kind is accepted by every structural
  // check and then refused by `validate()` with `invalid-kind`, so the edit
  // enters history and every save afterwards fails.
  if (!DOCUMENT_KINDS.includes(document.kind)) {
    throw new OpError(
      `a document of kind ${describe(document.kind)} is not one this editor ` +
        `knows. Every document names a kind from: ${DOCUMENT_KINDS.join(", ")}.`
    );
  }
  assertForestEntries(nodes);
  // Depth the ENGINE can survive, checked before any of its helpers run.
  //
  // Three separate guards have now been moved off recursion because a deep
  // document broke them — the JSON walk, the forest walk, the uniqueness scan.
  // Each fix moved the overflow to the next recursive thing: `findNode`,
  // `locateNode` and `lockedWithin` are the engine's, and rewriting the engine
  // from here is not this module's business.
  //
  // So the boundary states the honest limit instead. A document nested past
  // what the call stack survives cannot be edited by anything downstream, and
  // saying so is better than letting a native RangeError escape from whichever
  // helper reaches it first. This is deliberately NOT `limits.maxDepth`: that
  // is a product rule a site may relax, and this is a machine one nothing can.
  assertWalkable(treeDepth(nodes), "this document");

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
      // The machine cap on the INCOMING subtree as well. A caller that raises
      // `limits.maxDepth` can otherwise hand in a subtree deeper than the
      // engine's helpers can walk, and the overflow lands after the document
      // has been checked rather than before.
      assertWalkable(treeDepth([op.node]), "insert");
      const lockedId = lockedWithin(op.node);
      if (lockedId !== undefined) {
        throw new OpError(
          `insert: ${describe(lockedId)} arrives locked, and a locked node cannot be ` +
            `removed — so this insert could never be undone. Unlock it before ` +
            `adding it to the document.`
        );
      }
      // Asked BEFORE the placement, because afterwards the slot exists whether
      // this insert made it or not, and the question cannot be answered.
      const createdSlot = slotCreatedBy(nodes, op.at);
      // A copy, placed rather than the caller's own object. Validation has just
      // established it is JSON, so the copy is exact — and the document no
      // longer shares a reference with whoever built the op.
      const incoming = snapshot(op.node);
      const placed = accepted(
        nodes,
        insertNode(nodes, incoming, op.at),
        `insert: the document did not accept ${describe(op.node.id)} at the position ` +
          `given. The position may name a parent the document does not hold ` +
          `or omit the slot it needs, or the subtree may carry an id the ` +
          `document already uses — ids are identity, so a repeat would make ` +
          `every later op ambiguous about which node it addresses.`
      );
      // Measured on the placed forest rather than on the loose subtree, which
      // is what makes an insert into a slot count the slot's own key.
      assertFitsCaps(document, withNodes(document, placed), "insert", limits);
      return {
        document: withNodes(document, placed),
        inverse: {
          kind: "remove",
          id: op.node.id,
          ...(createdSlot === undefined
            ? {}
            : { dropSlotIfEmpty: createdSlot }),
        },
      };
    }

    case "remove": {
      assertNodeId(op.id, "remove");
      const node = findNode(nodes, op.id);
      const location = locateNode(nodes, op.id);
      if (node === undefined || location === undefined) {
        throw new OpError(
          `remove: no node with id ${describe(op.id)} in the document.`
        );
      }

      assertDropSlot(op.dropSlotIfEmpty, "remove");
      assertIdIsUnique(nodes, op.id, "remove");
      // EVERY id the inverse would carry, not only the root's. The inverse of a
      // remove is an insert of the whole subtree, and `insertNode` refuses a
      // subtree that repeats an id — within itself or against the document. So
      // a container whose descendants collide is removable and then cannot be
      // put back: the edit applies, the history entry records an inverse, and
      // undo is refused. Checked before the removal for the same reason the
      // root is: an inverse that cannot run is worse than an edit that cannot.
      assertSubtreeIdsAreUnique(nodes, node, "remove");
      // And the subtree must be INSERTABLE, by the same boundary an incoming
      // one answers to. The inverse of a remove is an insert of exactly this
      // subtree, so a document imported with a node missing `props` — or any
      // other field the shape check requires — removes cleanly and then cannot
      // be put back. Uniqueness was only half of what makes an inverse
      // applicable; this is the other half.
      //
      // SHAPE only, and the product caps deliberately left out. A site that
      // lowers `maxNodes` below an existing container's subtree would otherwise
      // find that container unremovable: the check would judge the captured
      // subtree as though it were arriving new, and refuse the edit most likely
      // to bring the document back under the cap. Whether the RESULT fits is
      // `assertFitsCaps`' question, and it already answers it with the repair
      // policy — refuse an edit that crosses a cap or worsens an overage, allow
      // one that shrinks.
      assertNodeShape(node, "remove", SHAPE_ONLY_LIMITS);
      // The ORIGINAL parent too. The removed node may be unique while the
      // parent it sat under is not, and the inverse restores by naming that
      // parent — so an undo would place it under whichever match is found
      // first, which is not necessarily where it came from.
      if (location.parent !== undefined) {
        assertIdIsUnique(nodes, location.parent.id, "remove");
      }
      const lockedId = lockedWithin(node);
      if (lockedId !== undefined) {
        throw new OpError(
          `remove: ${describe(lockedId)} is locked and sits inside what this would ` +
            `delete. An author locked it against deletion, and removing its ` +
            `ancestor deletes it just as thoroughly.`
        );
      }
      // Both the node and where it sat, captured before it goes: neither is
      // recoverable from the forest afterwards, which is the whole reason the
      // inverse cannot be computed later.
      const without = accepted(
        nodes,
        removeNode(nodes, op.id),
        `remove: the document did not accept removing ${describe(op.id)}.`
      );
      // The slot the original placement created, if this remove is the undo of
      // one. Applied AFTER the removal, because the slot only becomes empty
      // once the node is out of it.
      const pruned =
        op.dropSlotIfEmpty === undefined
          ? without
          : dropEmptySlot(without, op.dropSlotIfEmpty);
      return {
        document: withNodes(document, pruned),
        // A copy in the inverse, for the same reason the insert placed one: the
        // removed node is still reachable from whoever handed us the document,
        // and an undo has to restore what was there when the edit ran rather
        // than whatever that object has become since.
        inverse: {
          kind: "insert",
          node: snapshot(node),
          at: positionOf(location),
        },
      };
    }

    case "move": {
      assertNodeId(op.id, "move");
      const node = findNode(nodes, op.id);
      const location = locateNode(nodes, op.id);
      if (node === undefined || location === undefined) {
        throw new OpError(
          `move: no node with id ${describe(op.id)} in the document.`
        );
      }
      assertIdIsUnique(nodes, op.id, "move");
      // Same on the origin side: the inverse moves the node BACK by naming its
      // original parent, so a duplicated one makes the undo ambiguous.
      if (location.parent !== undefined) {
        assertIdIsUnique(nodes, location.parent.id, "move");
      }
      assertPositionContainer(op.to, "move");
      assertPosition(op.to, "move");
      if (op.to.parentId !== undefined) {
        assertIdIsUnique(nodes, op.to.parentId, "move");
      }
      const lockedMoving = lockedWithin(node);
      if (lockedMoving !== undefined) {
        throw new OpError(
          `move: ${describe(lockedMoving)} is locked and sits inside what this would ` +
            `relocate. A lock is easier to rely on when it means one thing — ` +
            `this node does not move or disappear until you unlock it — than ` +
            `when it holds for the node and not for the section around it.`
        );
      }
      assertDropSlot(op.dropSlotIfEmpty, "move");
      // Before the relocation, for the same reason as insert: afterwards the
      // slot exists whether this move made it or not.
      const createdSlot = slotCreatedBy(nodes, op.to);
      const moved = accepted(
        nodes,
        moveNode(nodes, op.id, op.to),
        `move: the document did not accept ${describe(op.id)} at the position given. ` +
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
          `move: ${describe(op.id)} is already at the position given, so this move ` +
            `changes nothing. A history entry for it would undo to no visible ` +
            `effect.`
        );
      }
      // A move keeps the node count and can still grow the document: relocating
      // into a slot the parent did not have yet adds that slot's name to what is
      // stored, and a long enough name crosses the byte cap on its own.
      assertFitsCaps(document, withNodes(document, moved), "move", limits);
      // The slot the original placement created, if this move is the undo of
      // one. After the relocation, because the slot the node has just left is
      // only empty once it is out.
      const settledForest =
        op.dropSlotIfEmpty === undefined
          ? moved
          : dropEmptySlot(moved, op.dropSlotIfEmpty);
      return {
        document: withNodes(document, settledForest),
        inverse: {
          kind: "move",
          id: op.id,
          to: positionOf(location),
          ...(createdSlot === undefined
            ? {}
            : { dropSlotIfEmpty: createdSlot }),
        },
      };
    }

    case "update": {
      assertNodeId(op.id, "update");
      const node = findNode(nodes, op.id);
      if (node === undefined) {
        throw new OpError(
          `update: no node with id ${describe(op.id)} in the document.`
        );
      }
      assertIdIsUnique(nodes, op.id, "update");
      assertPatchNames(op);
      const touched = [...Object.keys(op.patch), ...(op.unset ?? [])];
      const before = priorValues(node, touched);
      // `unset` becomes `undefined` only HERE, at the moment of applying, and
      // the key is DELETED immediately afterwards. The engine's spread leaves
      // it present holding `undefined`, which serializing sheds — but nothing
      // serializes between one op and the next, and a field holding `undefined`
      // is not a value JSON can write. So the store handed back a document its
      // own next call refused: undoing an update that added `customCss`
      // succeeded, and the redo threw.
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
      //
      // COMPARED rather than serialized. Producing a JSON string of each side
      // materialises the whole value here, before the byte cap has had a chance
      // to refuse it — so an update carrying a string far past the cap allocates
      // it in full to answer a question whose answer cannot matter, and the
      // bounded counter downstream never gets to run.
      const same = (a: unknown, b: unknown): boolean =>
        equalWithin(a, b, COMPARISON_BUDGET);
      // A name set rather than `includes` on the typed list: the names being
      // compared are the patch's own keys, which are strings, and widening the
      // list to match them would give up the very narrowing that stops a caller
      // naming a field no update can remove.
      const removed = new Set<string>(op.unset ?? []);
      const changesSomething = touched.some(key =>
        removed.has(key)
          ? held[key] !== undefined
          : !same(held[key], (op.patch as Record<string, unknown>)[key])
      );
      if (!changesSomething) {
        throw new OpError(
          `update: ${describe(op.id)} already holds every value this op would write, ` +
            `so it changes nothing. A history entry for it would undo to no ` +
            `visible effect.`
        );
      }

      // An update changes no node count and is the easiest way past the byte
      // cap: one large string in `props` is a document the engine will refuse
      // to store, written by an edit nothing objected to.
      const written = updateNode(nodes, op.id, {
        ...snapshot(op.patch),
        ...removals,
      });
      // The keys removed rather than left holding `undefined`. A document is
      // stored as JSON, where an absent key and one holding `undefined` are the
      // same document — but every reader between here and storage sees the
      // difference, and this module's own value check is one of them.
      const cleared = op.unset ?? [];
      const updated =
        cleared.length === 0
          ? written
          : rebuild(written, current =>
              current.id === op.id ? withoutKeys(current, cleared) : current
            );
      assertFitsCaps(document, withNodes(document, updated), "update", limits);
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
