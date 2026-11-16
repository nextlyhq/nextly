/**
 * Judging the values an op carries: the limits an op is measured under,
 * comparing stored values in any key order within a budget, and whether a
 * value is plain JSON.
 *
 * @module ops-values
 */
import {
  type DocumentLimits,
  ForestTooLargeError,
  MAX_VALUE_PARTS,
} from "./limits";
import { holdsAValue } from "./ops-fields";
import { describe, OpError } from "./ops-vocabulary";
import { isPlainRecord } from "./plain-record";

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
export const SHAPE_ONLY_LIMITS: DocumentLimits = {
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
export function assertUsableLimits(limits: DocumentLimits): void {
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
/**
 * Measure a forest, reporting a refusal to measure as an `OpError`.
 *
 * `countNodes` and `treeDepth` refuse a forest whose entries outrun
 * {@link MAX_VALUE_PARTS} rather than answering from a partial walk, and
 * that refusal has to arrive here wearing this module's error type. Six
 * `...Refusal` helpers in this file are written as
 * `catch (error) { if (error instanceof OpError) return error.message; throw error; }`
 * — so an error of any other type is rethrown, and a helper whose whole purpose
 * is to hand back a reason instead throws at its caller.
 *
 * The message is carried verbatim: it already names the cause a reader has to
 * act on, and restating it here would be a second spelling of one explanation.
 */
export function measured(measure: () => number, verb: string): number {
  try {
    return measure();
  } catch (error) {
    if (error instanceof ForestTooLargeError) {
      throw new OpError(`${verb}: ${error.message}`);
    }
    throw error;
  }
}

export function assertWalkable(depth: number, subject: string): void {
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
 * the side taken from the document — and `assertForestEntries` has
 * already refused any document whose held values exceed this many parts. No
 * value reaching the comparison can exhaust it, so the "ran out" answer stops
 * being reachable rather than staying reachable and safe.
 */
export const COMPARISON_BUDGET: number = MAX_VALUE_PARTS;

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
 *
 * Bounded in DEPTH as well as in parts, and the depth is what stops a cycle.
 * The parts budget alone is a machine-size number, so two distinct
 * self-referential values compare by descending forever until four million
 * entries are spent — measured at roughly half a second for one pair, on a
 * read a panel performs per address. {@link isJsonValue} already bounds its own
 * walk this way and refuses such a value in a few steps; this now matches it,
 * so a cycle costs {@link MAX_VALUE_DEPTH} rather than the whole budget.
 *
 * Answering "different" past the bound is the same safe direction the budget
 * takes, and no value from a document reaches it: anything nested deeper is
 * refused before it can be stored.
 */
/**
 * The keys two records must agree on value by value, or `null` when their key
 * sets already settle it.
 *
 * Asked BEFORE any value is compared, because it is a different question: two
 * records can disagree on their keys alone, and answering that first means the
 * walk never queues a pair for a record that was never going to match.
 *
 * ORDER, not just membership, unless the caller's domain sorts. A stored
 * document's identity is its serialized form, and `JSON.stringify` writes keys
 * in insertion order — so `{ first: 1, second: 2 }` and `{ second: 2, first: 1 }`
 * are different stored documents, and a block rendering `Object.entries(props)`
 * produces different output from them. Comparing membership alone calls that
 * reordering a no-op and refuses an edit that changes what the reader sees.
 *
 * Sorting both lists is what lets ONE comparison answer the other domain, where
 * a compiler sorts the keys before emitting them and a reorder changes nothing.
 * A second walk for that would be a second answer to drift from this one.
 */
function comparableKeys(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
  keyOrderMatters: boolean,
  limit: number
): readonly string[] | null {
  const leftKeys = ownKeysWithin(left, limit);
  if (leftKeys === null) return null;
  const rightKeys = ownKeysWithin(right, limit);
  if (rightKeys === null) return null;
  if (leftKeys.length !== rightKeys.length) return null;
  if (!keyOrderMatters) {
    leftKeys.sort();
    rightKeys.sort();
  }
  for (let index = 0; index < leftKeys.length; index += 1) {
    if (leftKeys[index] !== rightKeys[index]) return null;
  }
  return leftKeys;
}

/**
 * A record's own enumerable keys, or `null` when there are more than `limit`.
 *
 * Counted DURING enumeration rather than after it. `Object.keys(value)` builds
 * the whole list before anything can refuse it, and sorting it costs more
 * again — so a value carrying hundreds of thousands of keys, which an import or
 * a corrupt document can produce, is paid for in full before the budget is
 * consulted even once.
 *
 * `for...in` reaches the prototype, so `Object.hasOwn` filters; the pair reads
 * exactly what `Object.keys` would, one key at a time and interruptibly.
 */
function ownKeysWithin(
  value: Readonly<Record<string, unknown>>,
  limit: number
): string[] | null {
  const keys: string[] = [];
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (keys.length >= limit) return null;
    keys.push(key);
  }
  return keys;
}

/**
 * What two holders store at one position, or `null` when either cannot be read
 * without running code.
 *
 * The comparison walks values a caller supplied and does it while a panel is
 * inspecting a selection, so a bracket read is not a neutral act: an own
 * accessor would run — a side-effecting getter from rendering alone, a throwing
 * one aborting the read — and an inherited one would answer for a value the
 * holder does not have. Descriptors read only what is stored, and only what is
 * stored HERE.
 *
 * `null` for three cases that are all "there is nothing to compare": an
 * accessor, an inherited property, and a HOLE in a sparse array. The caller
 * reports different, which is the same direction the budget and the depth bound
 * take — the one that cannot hide a disagreement behind something unreadable.
 *
 * Asked as a PAIR because the two sides are only ever read together, and asked
 * once because an array index and a record key are the same question about
 * different positions. Answering it in both branches is how one of them came to
 * read descriptors while the other still used brackets.
 */
function ownDataPair(
  left: object,
  right: object,
  key: string | number
): [unknown, unknown] | null {
  const leftPart = Object.getOwnPropertyDescriptor(left, key);
  if (leftPart === undefined || !("value" in leftPart)) return null;
  const rightPart = Object.getOwnPropertyDescriptor(right, key);
  if (rightPart === undefined || !("value" in rightPart)) return null;
  return [leftPart.value, rightPart.value];
}

// RELOCATED, not written here — see the module docblock. structural equality, one arm per comparable shape.
// fallow-ignore-next-line complexity
export function equalWithin(
  a: unknown,
  b: unknown,
  budget: number,
  /**
   * Whether two records holding the same keys in a different order differ.
   *
   * True for a STORED value, false for a STYLE value, and the difference is a
   * property of who reads them rather than a preference. The reasoning for each
   * sits at {@link sameStoredValue} and {@link sameStyleValue}.
   */
  keyOrderMatters = true
): boolean {
  const pending: [unknown, unknown, number][] = [[a, b, 1]];
  // Charged at ENQUEUE, not on the way out. A budget checked per pop still
  // allocates one tuple per element before the next check can run, so a dense
  // array near the parts ceiling builds millions of temporary pairs to answer a
  // question whose answer is already settled by the lengths. The count is what
  // the walk is about to do, not what it has already done.
  let queued = 1;
  while (pending.length > 0) {
    const pair = pending.pop();
    if (pair === undefined) break;
    const [left, right, depth] = pair;
    if (left === right) continue;
    if (depth > MAX_VALUE_DEPTH) return false;
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right)) return false;
      if (left.length !== right.length) return false;
      if (queued + left.length > budget) return false;
      queued += left.length;
      for (let i = 0; i < left.length; i += 1) {
        const pair = ownDataPair(left, right, i);
        if (pair === null) return false;
        pending.push([pair[0], pair[1], depth + 1]);
      }
      continue;
    }
    if (isPlainRecord(left) && isPlainRecord(right)) {
      const keys = comparableKeys(
        left,
        right,
        keyOrderMatters,
        budget - queued
      );
      if (keys === null) return false;
      queued += keys.length;
      for (const key of keys) {
        const pair = ownDataPair(left, right, key);
        if (pair === null) return false;
        pending.push([pair[0], pair[1], depth + 1]);
      }
      continue;
    }
    // Primitives that were not `===`, or one record against one primitive.
    return false;
  }
  return true;
}

/**
 * Whether two stored values are the same one, by the comparison an `update` op
 * uses to decide it changes nothing.
 *
 * Exported so a caller BUILDING an update can ask before `applyOp` answers by
 * throwing. A surface that proposed an op which changes nothing would be
 * advertising an operation that cannot be applied — and the natural cases are
 * ordinary rather than exotic: resetting a control that was already unset, or
 * retyping the value a node already holds.
 *
 * The same predicate rather than a second one, because the two would disagree
 * about exactly the values that are hard — a token reference against an equal
 * token reference, a composite whose keys were written in another order — and
 * the disagreement surfaces as a thrown error from an op the caller was told
 * was fine.
 */
export function sameStoredValue(a: unknown, b: unknown): boolean {
  return equalWithin(a, b, COMPARISON_BUDGET);
}

/**
 * Whether two STYLE values are the same one, by the comparison the style
 * compiler's own output makes.
 *
 * Differs from {@link sameStoredValue} in exactly one way — key order is not a
 * difference — and the reason is not a preference. `partDeclarations` sorts a
 * composite's keys before emitting it, and says so beside the sort: "two
 * documents differing only in the order their keys were written compile to the
 * same bytes". So for a style value, a reorder changes nothing anybody can see,
 * and reporting it as a change means an edit that rewrites the document and
 * costs an undo entry while rendering identically.
 *
 * The general predicate stays order sensitive because a general stored value
 * has no such compiler: a block rendering `Object.entries(props)` really does
 * produce different output from a reordered record.
 *
 * ONE walk with a flag, not a second implementation. Two comparisons of "are
 * these the same value" drift, and they drift about exactly the composites that
 * are hard.
 *
 * Weaker than {@link sameStoredValue}, which is the safe direction here: every
 * pair this calls different is one that calls different too, so an op built on
 * this answer is never one `applyOp` would refuse as a no-op.
 */
export function sameStyleValue(a: unknown, b: unknown): boolean {
  return equalWithin(a, b, COMPARISON_BUDGET, false);
}

/**
 * Whether two stored values hold the same data, whatever order their keys were
 * written in.
 *
 * For a value read back from a database column against one a writer sends:
 * PostgreSQL's `jsonb` and MySQL's JSON type both rewrite key order when they
 * store a document, so a page an editor sends back untouched can differ from
 * what it read in nothing but that order. The same walk as
 * {@link sameStyleValue}, asked for that reason rather than for a compiler's.
 */
export function sameValueInAnyKeyOrder(a: unknown, b: unknown): boolean {
  return equalWithin(a, b, COMPARISON_BUDGET, false);
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
export function snapshot<T>(value: T): T {
  return structuredClone(value);
}

export function isJsonValue(value: unknown): boolean {
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
  return walkIsJson(pending, open);
}

/**
 * The same question asked of many values at once, each as its own root.
 *
 * NOT `isJsonValue(values)`. Wrapping them in an array makes that array the
 * root, so every value is examined one level deeper than it really sits — and a
 * value nested at exactly {@link MAX_VALUE_DEPTH} is then refused at 513 by the
 * aggregate that the per-field check had already accepted at 512.
 *
 * That gap is the shape this module treats as the serious one: the forward edit
 * succeeds, and the document it produces is refused by the next call, so the
 * inverse cannot be applied and a successful operation cannot be undone.
 *
 * Kept as ONE call rather than a loop over `isJsonValue`, which is why this
 * exists at all. Each call allocates a stack and a cycle set, so asking per
 * field turned a 150,000-node document into six hundred thousand of those.
 * Seeding the walk with every value at depth 1 keeps the single allocation and
 * the shared budget while leaving each value at its true depth.
 */
export function areJsonValues(values: readonly unknown[]): boolean {
  // The LENGTH before the seed, like every other list this module copies — and
  // this one is worth stating plainly, because the helper was WRITTEN to fix an
  // instance of exactly this shape and then contained another. `values.map`
  // allocates one pending record per value before the walk can enforce
  // anything, so a document whose nodes each hold four fields reaches four
  // million records while the forest guard, which counts NODES, is still happy.
  //
  // A local fix to one instance of a class does not make the class go away, and
  // writing the fix is not a reason to think it did.
  if (values.length > MAX_VALUE_PARTS) return false;
  const seed: { value: unknown; depth: number; exiting?: object }[] = [];
  for (let index = 0; index < values.length; index += 1) {
    seed.push({ value: values[index], depth: 1 });
  }
  return walkIsJson(seed, new Set<object>());
}

// RELOCATED, not written here — see the module docblock. the JSON-value predicate: one arm per type the format admits.
// fallow-ignore-next-line complexity
function walkIsJson(
  pending: { value: unknown; depth: number; exiting?: object }[],
  open: Set<object>
): boolean {
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

// RELOCATED, not written here — see the module docblock. an own-key scan with one guard per disallowed key kind.
// fallow-ignore-next-line complexity
export function hasOnlyJsonOwnKeys(value: object): boolean {
  // Counted while enumerating, for the reason {@link MAX_VALUE_PARTS} exists:
  // `Reflect.ownKeys` on an object with millions of properties materialises
  // them all, and the byte cap that would refuse such a value has not run yet.
  let parts = 0;
  if (Array.isArray(value)) {
    // The PROTOTYPE, before any own key. Everything downstream — this module's
    // own walks, and the engine's `findNode`, `moveNode` and `mapForest` —
    // reaches a list with `for...of` or a spread, and both run
    // `Symbol.iterator`, which is inherited. An array subclass or a prototype
    // supplying its own iterator therefore passes an own-keys check and then
    // executes the document's code inside the guard deciding whether to trust
    // it; a null-prototype array fails the other way, with a native "not
    // iterable" even though its indexed JSON form is valid.
    //
    // Refusing the exotic prototype outright rather than avoiding iteration
    // here, because avoiding it HERE fixes one caller: the engine iterates too,
    // and this is the boundary that decides what reaches it. Nothing is lost by
    // the refusal — an array subclass does not survive `JSON.stringify` or
    // `structuredClone` as a subclass anyway, so it is already outside what
    // this module promises to store faithfully.
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (parts++ > MAX_VALUE_PARTS) return false;
      // `length` is an own property of every array and is never serialized as
      // a member, so it is the one key that is expected rather than lost.
      if (key === "length") continue;
      if (typeof key !== "string") return false;
      if (!isArrayIndex(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      // Enumerability IS required of an index, against the intuition that
      // `JSON.stringify` reads an array by position and so round-trips one
      // without it. That is true of `JSON.stringify` and false of the copier
      // this module actually uses: measured, `["x","y","z"]` with index `1`
      // redefined non-enumerable stringifies as `["x","hidden","z"]` and
      // `structuredClone`s to `["x",null,"z"]`.
      //
      // So accepting it admits a value that passes every check and is then
      // silently altered by `snapshot`: the update succeeds, the stored array
      // holds a `null` the author never wrote, and the inverse derived
      // alongside it is refused by the next edit — a successful operation that
      // cannot be undone. Refusing it is the same rule the envelope and the
      // object branch already apply, for the same reason.
      if (descriptor === undefined || !descriptor.enumerable) return false;
      if (!holdsAValue(descriptor)) return false;
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
