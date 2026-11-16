/**
 * What an op must satisfy before it applies: the patch's field names, a
 * node's shape, every forest entry, the document's caps, the slots a drop
 * names, and unique ids; with the rebuild a structural edit returns.
 *
 * @module ops-checks
 */
import { byteCapRefusal } from "./byte-cap";
import type { BlockDocument, BlockNode } from "./document";
import {
  type DocumentLimits,
  editorForestShape,
  MAX_VALUE_PARTS,
} from "./limits";
import {
  isNonEmptyString,
  isPatchField,
  isStringArray,
  mayRemove,
  NODE_FIELDS,
} from "./ops-fields";
import {
  areJsonValues,
  assertWalkable,
  hasOnlyJsonOwnKeys,
  isJsonValue,
  measured,
} from "./ops-values";
import {
  type BuilderOp,
  clipped,
  describe,
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
import { keptList } from "./structural-sharing";
import { findNode } from "./tree";

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
export function accepted(
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
// RELOCATED, not written here — see the module docblock. one refusal per unpatchable field name.
// fallow-ignore-next-line complexity
export function assertPatchNames(
  op: Extract<BuilderOp, { kind: "update" }>
): void {
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

  // Every patch value on ONE budget, before any of them is walked individually.
  // A per-value `isJsonValue` gives each a fresh ceiling, so a patch carrying
  // `props` and `bindings` that are each just under it is accepted — and the
  // next `applyOp` refuses the document it produced, whose held values share a
  // budget. The forward update succeeds and its own inverse cannot run.
  //
  // The per-value checks below stay: they name WHICH field is wrong, which this
  // aggregate cannot, and they run only once the whole patch is known to fit.
  if (!areJsonValues(Object.values(op.patch))) {
    for (const [key, value] of Object.entries(op.patch)) {
      if (isJsonValue(value)) continue;
      throw new OpError(
        `update: ${describe(key)} holds a value JSON cannot carry unchanged. ` +
          `A patch is stored as JSON, so a value it drops or rewrites would ` +
          `replay as something else — or not at all.`
      );
    }
    throw new OpError(
      `update: this patch holds more values than an edit may examine, so the ` +
        `document it produced could not be edited again.`
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
// RELOCATED, not written here — see the module docblock. one refusal per malformed field, flat and exhaustive by design.
// fallow-ignore-next-line complexity
export function assertNodeShape(
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

  // Every value the subtree HOLDS, collected here and judged once at the end
  // against one shared parts budget — the same decision the document walk makes
  // in `areJsonValues`. Two boundaries answering the same question with
  // different budgets is how an accepted insert becomes a document the next op
  // refuses.
  const heldValues: unknown[] = [];

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

    // The MACHINE bound as well, and inside the walk rather than after it. A
    // site may raise `maxDepth` above what the engine's recursive helpers can
    // walk, and the check that refuses such a subtree unconditionally runs only
    // once this walk has finished — so a subtree nested far past the machine
    // bound was traversed in full first, building a longer diagnostic path for
    // every descendant on the way down, to reach a verdict that was settled at
    // level 1,001. Stopping here makes the traversal end as soon as the outcome
    // is known.
    //
    // WITHOUT the path, unlike every other refusal in this walk. At a thousand
    // levels the path is a thousand `.slots.main[0]` segments, which is longer
    // than a message may be — so interpolating it truncates the reason away and
    // leaves the author reading fifteen kilobytes of breadcrumb with no verdict
    // at the end. The depth is the actionable fact here, and the path is not:
    // nothing can be done about level 1,001 except make the tree shallower.
    assertWalkable(depth, `${verb}: this subtree`);

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
    // COLLECTED, then judged once for the whole subtree. Checking each value
    // with its own `isJsonValue` call gives each a FRESH parts budget, so a
    // node carrying several values that are individually under the ceiling and
    // together over it is accepted here — and then refused by the next
    // `applyOp`, whose `areJsonValues` shares one budget across the document.
    // The insert succeeds and the document it produces cannot be edited again,
    // its own inverse included.
    for (const [key, extra] of Object.entries(candidate)) {
      if (Object.hasOwn(NODE_FIELDS, key)) continue;
      heldValues.push(extra);
    }

    for (const [field, contract] of Object.entries(NODE_FIELDS)) {
      const value = ownValue(candidate, field);
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
      } else {
        // Into the same shared budget as the extras, for the same reason:
        // a fresh budget per field lets a node carry several values that pass
        // individually and fail together.
        heldValues.push(value);
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

  // One decision for the whole subtree, matching what the document walk makes.
  // A per-value budget accepts a node carrying several values that are each
  // under the ceiling and together over it; this refuses it here, before the
  // node is placed, rather than leaving the next `applyOp` to refuse the
  // document this one produced.
  if (!areJsonValues(heldValues)) {
    // The offender, found only once the fast path has failed. The PATH is gone
    // by this point — the walk has finished and its per-node breadcrumbs with
    // it — so the value is named instead. Keeping paths for a branch that
    // almost never runs would cost one string per node on every op, which is
    // the trade the aggregate exists to avoid.
    for (const value of heldValues) {
      if (isJsonValue(value)) continue;
      throw new OpError(
        `${verb}: this subtree holds ${describe(value)} — a value JSON cannot ` +
          `write. The node would enter the document and the next save would ` +
          `be refused.`
      );
    }
    throw new OpError(
      `${verb}: this subtree holds more values than an edit may examine, so ` +
        `no document could hold it.`
    );
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
export function assertListIsData(list: unknown, subject: string): void {
  if (!Array.isArray(list) || !hasOnlyJsonOwnKeys(list)) {
    throw new OpError(
      `${subject} must be a plain list of nodes. One whose entries are ` +
        `computed rather than stored cannot be edited: reading it runs code, ` +
        `and what it returns is not what would be saved.`
    );
  }
}

// RELOCATED, not written here — see the module docblock. one refusal per way a forest entry can be unusable.
// fallow-ignore-next-line complexity
export function assertForestEntries(nodes: BlockNode[]): void {
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
  // CHARGING and COPYING are separate, because not everything the walk pays for
  // ends up in the queue. A node's slot MAP costs one visit per entry whether or
  // not those slots hold children, so it must be charged without being enqueued
  // — folding the two together queues slot names as though they were nodes.
  const charge = (count: number, subject: string): void => {
    if (enqueued + count > MAX_VALUE_PARTS) {
      throw new OpError(
        `${subject} would put this document past the ` +
          `${String(MAX_VALUE_PARTS)} entries an edit may walk. No document ` +
          `may hold that many nodes, so the answer is settled by the lengths ` +
          `alone.`
      );
    }
    enqueued += count;
  };
  const enqueue = (list: readonly unknown[], subject: string): void => {
    charge(list.length, subject);
    // An INDEX loop, never `for...of`. Iteration runs `Symbol.iterator`, and
    // that method is INHERITED — `hasOnlyJsonOwnKeys` checks own keys, so an
    // array subclass or a prototype supplying a custom iterator passes it and
    // then has its code executed by this walk, leaking a native error where an
    // `OpError` is promised. A null-prototype array is the same fault from the
    // other side: its indexed JSON form is perfectly valid and `for...of`
    // throws "not iterable" on it. The indices were already checked; read them.
    for (let index = 0; index < list.length; index += 1) {
      pending.push(list[index]);
    }
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
    // The slot MAP's own size, charged before its entries are walked. An empty
    // slot list adds nothing to the enqueued total, so a document whose nodes
    // each carry a wide map of empty slots stays under the node ceiling forever
    // while this loop materialises and visits every entry — and pays a fresh
    // descriptor walk per node. The work the budget exists to bound is the
    // number of entries VISITED, not only the children queued from them.
    charge(Object.keys(slots).length, "a node's slots");
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
  //
  // Each value as its OWN root. `isJsonValue(heldValues)` would make the array
  // the root and examine every value one level deeper than it sits, so a field
  // accepted at exactly `MAX_VALUE_DEPTH` by the per-field check is refused at
  // 513 here — the edit succeeds and the document it returns cannot be edited
  // again, inverse included.
  if (!areJsonValues(heldValues)) {
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

export function assertFitsCaps(
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
  const depth = measured(() => editorForestShape(result.nodes).depth, verb);
  if (
    depth > limits.maxDepth &&
    depth > measured(() => editorForestShape(before.nodes).depth, verb)
  ) {
    throw new OpError(
      `${verb}: this would leave the document nested ${String(depth)} ` +
        `levels deep, past the ${String(limits.maxDepth)} it may hold.`
    );
  }
  const total = measured(() => editorForestShape(result.nodes).count, verb);
  if (
    total > limits.maxNodes &&
    total > measured(() => editorForestShape(before.nodes).count, verb)
  ) {
    throw new OpError(
      `${verb}: this would leave the document holding ${String(total)} nodes, ` +
        `past the ${String(limits.maxNodes)} a document may hold. The edit would ` +
        `apply and then fail to save.`
    );
  }
  // Size as well as count, asked of `byte-cap`, which answers from the sizes
  // kept for each part and falls back to the full measurement.
  const bytes = byteCapRefusal(before, result, limits.maxBytes, verb);
  if (bytes !== undefined) throw new OpError(bytes);
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
// RELOCATED, not written here — see the module docblock. one refusal per malformed slot address.
// fallow-ignore-next-line complexity
export function assertDropSlot(address: unknown, verb: string): void {
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
export function slotCreatedBy(
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
export function dropEmptySlot(
  nodes: BlockNode[],
  address: SlotAddress
): BlockNode[] {
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
export function rebuild(
  nodes: BlockNode[],
  fn: (node: BlockNode) => BlockNode
): BlockNode[] {
  return nodes.map(node => {
    const mapped = fn(node);
    if (mapped.slots === undefined) return mapped;
    // What did not change keeps its identity (see `structural-sharing`).
    let changed = mapped !== node;
    const slots: Record<string, BlockNode[]> = {};
    for (const [name, children] of Object.entries(mapped.slots)) {
      slots[name] = keptList(rebuild(children, fn), children);
      if (slots[name] !== children) changed = true;
    }
    return changed ? { ...mapped, slots } : mapped;
  });
}

/**
 * A node whose own fields are written in the DECLARED order.
 *
 * An inverse restores a removed field by writing it again, and a written key
 * lands at the END of the object. So undoing an `unset` of a field that was not
 * last gives back every value and a different key sequence — and a document is
 * compared, stored and hashed as JSON, where that is a different document. The
 * round trip then fails on an edit that restored the data perfectly.
 *
 * Ordering the fields the same way every time removes the question rather than
 * tracking the answer: the alternative is recording the original key sequence on
 * each inverse, which makes the property hold only while that bookkeeping stays
 * correct. JSON objects are formally unordered and mature document models do not
 * treat a node's own field order as meaningful — Automerge's maps have no
 * insertion order at all, and ProseMirror builds `attrs` from its schema.
 *
 * The order comes from {@link NODE_FIELDS}, so there is one statement of the
 * node's shape rather than a second list that drifts from it. Fields the table
 * does not know follow, keeping their existing relative order, so a document
 * written by a newer editor survives a round trip through an older one.
 *
 * Order INSIDE a value is untouched. `props` is author data, observable through
 * `Object.entries`, and `equalWithin` compares it order-sensitively for
 * that reason.
 *
 * Assigned through `defineProperty` rather than `out[field] = ...` because a
 * forward-compatible field could be named `__proto__`, where plain assignment
 * sets the prototype instead of creating an own property and the field vanishes
 * from what is stored.
 */
export function canonicalNode(node: BlockNode): BlockNode {
  const source = node as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const write = (field: string): void => {
    Object.defineProperty(out, field, {
      value: source[field],
      writable: true,
      enumerable: true,
      configurable: true,
    });
  };
  for (const field of Object.keys(NODE_FIELDS)) {
    if (Object.hasOwn(source, field)) write(field);
  }
  for (const field of Object.keys(source)) {
    if (!Object.hasOwn(out, field)) write(field);
  }
  // Asserted rather than narrowed: every own field of a validated node is
  // carried across unchanged, so the result holds exactly what the input did.
  return out as unknown as BlockNode;
}

/** A node without the named keys, for an update that removed fields. */
export function withoutKeys(
  node: BlockNode,
  keys: readonly string[]
): BlockNode {
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

// RELOCATED, not written here — see the module docblock. a duplicate-id walk over a subtree.
// fallow-ignore-next-line complexity
export function assertSubtreeIdsAreUnique(
  nodes: BlockNode[],
  root: BlockNode,
  verb: string
): void {
  // The document counted ONCE, then every id of the subtree looked up in it.
  // Asking `assertIdIsUnique` per id would rescan the whole document for each
  // one, which is quadratic in the document size — and the subtree that most
  // needs this check is the large one.
  const counts = new Map<string, number>();
  // `unknown` rather than `BlockNode`: the declared type says node, and this
  // walk exists to work on documents that may not honour it.
  const pending: unknown[] = [];
  // Indices rather than iteration, for the reason the entry walk uses them:
  // `Symbol.iterator` is inherited, so a document-supplied array can run its
  // own code inside a walk that has only vouched for own keys.
  for (let index = 0; index < nodes.length; index += 1) {
    pending.push(nodes[index]);
  }
  while (pending.length > 0) {
    const current = pending.pop();
    if (!isPlainRecord(current)) continue;
    if (typeof current.id === "string") {
      counts.set(current.id, (counts.get(current.id) ?? 0) + 1);
    }
    const slots: unknown = current.slots;
    if (!isPlainRecord(slots)) continue;
    for (const children of Object.values(slots)) {
      if (!Array.isArray(children)) continue;
      // Indices rather than iteration: `Symbol.iterator` is inherited, so a
      // document-supplied array can run its own code here.
      for (let index = 0; index < children.length; index += 1) {
        const child: unknown = children[index];
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

// RELOCATED, not written here — see the module docblock. an id collector over a subtree.
// fallow-ignore-next-line complexity
function subtreeIds(root: BlockNode): string[] {
  const ids: string[] = [];
  // `unknown` rather than `BlockNode`, because that is what a slot's children
  // have been established to be at the moment they are read: the declared type
  // says node, and this walk exists to work on documents that may not honour it.
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!isPlainRecord(entry)) continue;
    if (typeof entry.id === "string") ids.push(entry.id);
    const slots: unknown = entry.slots;
    if (!isPlainRecord(slots)) continue;
    for (const children of Object.values(slots)) {
      if (!Array.isArray(children)) continue;
      // Indices rather than iteration: `Symbol.iterator` is inherited, so a
      // document-supplied array can run its own code here.
      for (let index = 0; index < children.length; index += 1) {
        const child: unknown = children[index];
        if (isPlainRecord(child)) pending.push(child);
      }
    }
  }
  return ids;
}

export function assertIdIsUnique(
  nodes: BlockNode[],
  id: string,
  verb: string
): void {
  // Counted with an explicit stack rather than through the engine's recursive
  // `walkNodes`. A document deep enough to need repairing is exactly the one
  // that made the recursive walker throw a native RangeError here — so the
  // guard broke on the input the repair was trying to fix.
  let seen = 0;
  const pending: BlockNode[] = [];
  // Indices rather than iteration, for the reason the entry walk uses them:
  // `Symbol.iterator` is inherited, so a document-supplied array can run its
  // own code inside a walk that has only vouched for own keys.
  for (let index = 0; index < nodes.length; index += 1) {
    pending.push(nodes[index]);
  }
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (current.id === id) seen += 1;
    const slots = current.slots;
    if (slots === undefined) continue;
    for (const children of Object.values(slots)) {
      for (let index = 0; index < children.length; index += 1) {
        pending.push(children[index]);
      }
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
export function assertNodeId(id: string, verb: string): void {
  if (!isNonEmptyString(id)) {
    throw new OpError(`${verb}: an id of ${describe(id)} addresses no node.`);
  }
}
