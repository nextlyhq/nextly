/**
 * Applying ops: the options an apply takes, the Layers lock and document
 * identity checks, the envelope and SEO edits, and `applyOp` and `applyOps`.
 *
 * @module ops-apply
 */
import {
  type BlockDocument,
  type BlockNode,
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  isComponentDocument,
} from "./document";
import {
  layersLockBreak,
  type LayersLockBreak,
  lockedWithin,
} from "./layers-lock";
import {
  DEFAULT_LIMITS,
  type DocumentLimits,
  editorForestShape,
  treeDepth,
} from "./limits";
import {
  accepted,
  assertDropSlot,
  assertFitsCaps,
  assertForestEntries,
  assertIdIsUnique,
  assertNodeId,
  assertNodeShape,
  assertPatchNames,
  assertSubtreeIdsAreUnique,
  canonicalNode,
  dropEmptySlot,
  rebuild,
  slotCreatedBy,
  withoutKeys,
} from "./ops-checks";
import { isString, type NodePatch } from "./ops-fields";
import {
  assertDropSlotWasVacated,
  assertPosition,
  assertPositionContainer,
  positionOf,
  priorValues,
  samePlace,
} from "./ops-positions";
import {
  areJsonValues,
  assertUsableLimits,
  assertWalkable,
  COMPARISON_BUDGET,
  equalWithin,
  hasOnlyJsonOwnKeys,
  isJsonValue,
  measured,
  sameStoredValue,
  SHAPE_ONLY_LIMITS,
  snapshot,
} from "./ops-values";
import {
  addressesNoNode,
  type BuilderOp,
  describe,
  ENVELOPE_FIELDS,
  type EnvelopeField,
  inheritedValueWouldBeLost,
  isEnvelopeField,
  OP_VOCABULARY,
  OpError,
  ownValue,
} from "./ops-vocabulary";
import { isPlainRecord } from "./plain-record";
import {
  findNode,
  insertNode,
  locateNode,
  moveNode,
  removeNode,
  updateNode,
} from "./tree";
import { documentSeoIssues } from "./validation";

/**
 * How an op is applied, beyond the document's limits.
 *
 * @experimental
 */
export interface ApplyOptions {
  /**
   * Whether the Layers lock holds for this apply. `"enforce"`, the default,
   * refuses any op that changes, moves or removes a locked block or anything
   * inside it (see `layers-lock`).
   *
   * `"ignore"` is for a SYSTEM transform only: an edit the site makes to every
   * document for a reason no author chose, such as stripping the styles of a
   * breakpoint the site no longer defines. A lock protects what an author can
   * see; it is not meant to make a site-wide change hostage to every locked
   * block. Anything an author or an agent asks for applies with the default.
   *
   * Only the exact string `"ignore"` lifts the check, so a misspelled or
   * mistyped option enforces the lock rather than skipping it.
   */
  readonly layersLocks?: "enforce" | "ignore";
}

/**
 * What an op that breaks a Layers lock is refused with: which locked block,
 * and where it sits relative to the edit, so the remedy names the block to
 * unlock.
 */
function layersLockRefusal(
  op: Exclude<BuilderOp, { readonly kind: "envelope" | "seo" }>,
  lockedId: string,
  where: LayersLockBreak["where"]
): string {
  const locked = describe(lockedId);
  if (where === "destination") {
    return (
      `${op.kind}: the position given is inside ${locked}, which is locked, ` +
      `and nothing may be added to a locked block. Unlock it first.`
    );
  }
  const subject = op.kind === "insert" ? locked : describe(op.id);
  if (where === "around") {
    return (
      `${op.kind}: ${subject} sits inside ${locked}, which is locked, and a ` +
      `lock covers everything inside the block. Unlock ${locked} first.`
    );
  }
  switch (op.kind) {
    case "remove":
      return (
        `remove: ${locked} is locked and sits inside what this would ` +
        `delete. An author locked it against deletion, and removing its ` +
        `ancestor deletes it just as thoroughly.`
      );
    case "move":
      return (
        `move: ${locked} is locked and sits inside what this would ` +
        `relocate. A lock is easier to rely on when it means one thing — ` +
        `this node does not move or disappear until you unlock it — than ` +
        `when it holds for the node and not for the section around it.`
      );
    default:
      return (
        `${op.kind}: ${locked} is locked, so nothing about it may change, ` +
        `its name included. Unlock it first; changing the lock alone is ` +
        `always allowed.`
      );
  }
}

/**
 * Refuse an op that breaks a Layers lock, unless the apply was told to ignore
 * the lock. Asked by each branch of {@link applyOp} only once the op's own
 * fields have been checked, because the rule reads them.
 */
function assertKeepsLayersLocks(
  nodes: BlockNode[],
  op: BuilderOp,
  options: ApplyOptions
): void {
  if (options.layersLocks === "ignore") return;
  // An envelope or metadata edit changes no block, so no Layers lock stands
  // in its way.
  if (addressesNoNode(op)) return;
  // Refused rather than exempting the inverse from the lock: see the insert
  // branch of `applyOp`. With the lock ignored, the inverse is a remove the
  // same option lets through, so the round trip still holds.
  if (op.kind === "insert") {
    const lockedId = lockedWithin(op.node);
    if (lockedId !== undefined) {
      throw new OpError(
        `insert: ${describe(lockedId)} arrives locked, and a locked node cannot be ` +
          `removed — so this insert could never be undone. Unlock it before ` +
          `adding it to the document.`
      );
    }
  }
  const broken = layersLockBreak(nodes, op);
  if (broken === undefined) return;
  throw new OpError(layersLockRefusal(op, broken.lockedId, broken.where));
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
 * Every refusal that is about the DOCUMENT rather than about the edit.
 *
 * Extracted so a planner can ask it without applying anything. `applyOp` runs
 * these before it dispatches an op, so a plan built against a document that
 * fails any of them is a plan that cannot apply — and a dry run blind to them
 * advertises success for an edit that throws. `documentRefusal` is the
 * asking form.
 *
 * Three questions, asked in an order that is load-bearing: is this a record
 * whose fields are safe to read, are the values it holds ones an edit can save,
 * and does it say what it is. Each precedes the next because the next reads
 * something the previous one vouched for.
 */
export function assertEditableDocument(document: BlockDocument): void {
  assertEditableEnvelope(document);
  assertEnvelopeValues(document);
  assertDocumentIdentity(document);
}

/**
 * The envelope as a shape: a record, holding only keys JSON carries, with a
 * forest that is an array.
 *
 * First, and every check below it depends on that: each one reads a field off
 * the envelope, which is only safe once the envelope is known to be a record
 * whose fields are held rather than computed.
 */
function assertEditableEnvelope(document: BlockDocument): void {
  if (!isPlainRecord(document)) {
    throw new OpError(
      `a document of ${describe(document)} holds no forest to edit. Every ` +
        `document is a record whose nodes are an array.`
    );
  }
  // The ENVELOPE's own keys, by the same rule its contents are held to, and
  // before anything reads a field off it — `nodes` included.
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
  // NOW the forest, once reading a field off the envelope is known to be safe.
  if (!Array.isArray(document.nodes)) {
    throw new OpError(
      `a document whose nodes are ${describe(document.nodes)} holds no forest ` +
        `to edit. Every document is a record whose nodes are an array.`
    );
  }
}

/**
 * The envelope's VALUES, which its descriptors say nothing about.
 *
 * Separate from the shape because it answers a different question and pays a
 * different cost: this one walks, under a shared budget, and it is the check
 * that stops a value the edit cannot serialize from reaching a save.
 */
function assertEnvelopeValues(document: BlockDocument): void {
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
  //
  // ONE budget across every envelope field, not one per field. A fresh
  // `isJsonValue` call per key lets several fields referencing the same large
  // dense array each pay the full walk, so a two-million-element array named by
  // a handful of unknown envelope fields is cheap to construct and forces
  // hundreds of millions of visits before any cap runs. The same shared
  // decision the forest and an inserted subtree already use.
  const envelopeKeys: string[] = [];
  const envelopeValues: unknown[] = [];
  for (const [key, value] of Object.entries(document)) {
    if (key === "nodes") continue;
    envelopeKeys.push(key);
    envelopeValues.push(value);
  }
  if (!areJsonValues(envelopeValues)) {
    // The offender named on the failing branch only, where a second walk is
    // affordable because it runs once and then throws.
    for (let index = 0; index < envelopeValues.length; index += 1) {
      if (isJsonValue(envelopeValues[index])) continue;
      throw new OpError(
        `a document whose ${describe(envelopeKeys[index])} is ` +
          `${describe(envelopeValues[index])} cannot be edited: JSON cannot ` +
          `write that value, so the edit would apply and then fail to save.`
      );
    }
    throw new OpError(
      `this document's fields hold more values than an edit may examine, so ` +
        `it would not save.`
    );
  }
}

/**
 * What the document says it IS: its format and its kind, owned rather than
 * inherited, and both known to this version.
 *
 * Last, because it reads two fields and the checks above are what make reading
 * a field off this envelope safe.
 */
function assertDocumentIdentity(document: BlockDocument): void {
  // Every ENTRY, not just the array. A stored forest carrying a `null` or a
  // primitive passes the array check and then reaches helpers that read `.id`
  // off it, so the failure surfaces as a TypeError from inside the engine
  // rather than as a refusal naming the malformed document.
  // The format this module knows how to edit. A document written by a newer
  // version may carry fields with meanings this code does not have, and editing
  // it with current semantics silently rewrites them. Refused rather than
  // guessed: an editor that cannot read a document should say so, not save over
  // it.
  // OWN properties, not merely resolvable ones. `Object.prototype` can be given
  // a `formatVersion` or a `kind`, and a document owning only `nodes` then
  // satisfies both comparisons below by INHERITING them — while `withNodes`
  // spreads, which copies own enumerable properties only. The edit succeeds and
  // hands back `{ nodes: [] }` with neither mandatory field, so the document
  // that enters history is missing what every reader after it requires.
  for (const field of ["formatVersion", "kind"] as const) {
    if (!Object.hasOwn(document, field)) {
      throw new OpError(
        `a document that does not carry its own ${field} cannot be edited. ` +
          `The field resolves through the prototype, so the edit would return ` +
          `a document without it.`
      );
    }
  }
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
}

/**
 * Apply one op, returning the new forest and the op that undoes it.
 *
 * **A document handed to this function must be treated as immutable
 * afterwards.** The result SHARES structure with it: untouched nodes are the
 * same objects, and so are envelope fields like `settings`, because the engine's
 * tree primitives are persistent and `withNodes` spreads. Mutating the old
 * document therefore changes the new one, with no op recorded and nothing for
 * history or autosave to see. The cap check relies on it too: the size, count
 * and depth of each part are kept against the part (`kept-sizes`), so a part
 * changed in place after a check is judged as it was when first measured.
 *
 * Stated rather than prevented, deliberately. Detaching the result would mean
 * deep-copying the whole document on every edit — work proportional to the
 * document rather than to the edit, on the page builder's hottest path — and it
 * would discard the structural sharing the primitives exist to provide. That is
 * the same contract React state, Immer and Automerge run on.
 *
 * Note the asymmetry, which is intended: values the caller supplies IN THE OP
 * are detached by {@link snapshot}, because the caller keeps a reference to a
 * payload it is likely to reuse and a small copy settles it. The document is a
 * different size of object and gets a contract instead of a copy.
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
// RELOCATED, not written here — see the module docblock. the op dispatch itself: one branch per kind, each delegating.
// fallow-ignore-next-line complexity
export function applyOp(
  document: BlockDocument,
  op: BuilderOp,
  limits: DocumentLimits = DEFAULT_LIMITS,
  options: ApplyOptions = {}
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
  // A RECORD first, and nothing more. Reading `nodes` in the same condition put
  // a field access ahead of the descriptor check below, so a document whose
  // enumerable `nodes` is a throwing accessor ran its getter here and left this
  // module as a native error rather than the `OpError` it promises — the exact
  // fault the descriptor check exists to refuse, reached one line before it.
  assertEditableDocument(document);
  const nodes = document.nodes;
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
  assertWalkable(
    measured(() => editorForestShape(nodes).depth, "this document"),
    "this document"
  );

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
  // The op's EXTRA fields — the ones no branch below reads. An op is
  // PERSISTED: a crash buffer, a queued agent edit, a replayed history. A
  // `remove` carrying `metadata: 1n` applies perfectly and then throws when
  // anything writes the op down, so the edit happened and the record of it
  // cannot exist. Crash recovery and redo both lose it.
  //
  // Scoped to the extras deliberately. The vocabulary's own fields are checked
  // by the branch that reads them, with the domain rules that field actually
  // has — a patch's values are judged as patch values, at their own depth — and
  // re-checking them here from one level further out would refuse documents
  // those rules allow while naming the wrong reason.
  const extras: unknown[] = [];
  const extraKeys: string[] = [];
  for (const [key, value] of Object.entries(op)) {
    if (OP_VOCABULARY.has(key)) continue;
    extraKeys.push(key);
    extras.push(value);
  }
  if (!areJsonValues(extras)) {
    for (let index = 0; index < extras.length; index += 1) {
      if (isJsonValue(extras[index])) continue;
      throw new OpError(
        `an op carrying ${describe(extraKeys[index])}, which holds ` +
          `${describe(extras[index])}, cannot be applied: JSON cannot write ` +
          `that value, so the edit would run and the record of it would fail ` +
          `to save.`
      );
    }
    throw new OpError(
      `an op holding more values than an edit may examine cannot be applied.`
    );
  }

  // The op's OWN fields, before its discriminant is read. An op is DISPATCHED
  // on `kind` and then applied from the fields its branch consumes, and all of
  // those are persisted — so an op resolving them through `Object.prototype`
  // deletes a node and then serializes as `{}`. The edit happens; crash
  // recovery and redo replay nothing.
  //
  // Checked against the vocabulary rather than per branch, so a field added to
  // an op later cannot be dispatched on without being owned.
  for (const field of OP_VOCABULARY) {
    if (inheritedValueWouldBeLost(op, field)) {
      throw new OpError(
        `an op whose ${describe(field)} comes from the prototype rather than ` +
          `from the op cannot be applied: the edit would run and the op would ` +
          `be stored without it, so nothing could replay it.`
      );
    }
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
      assertWalkable(
        measured(() => treeDepth([op.node]), "insert"),
        "insert"
      );
      // A subtree arriving locked, and where it lands: a block put into a
      // locked one changes what the lock protects as surely as an edit to a
      // block already inside it. Both are the Layers lock's, so both stand
      // down together when the apply is told to ignore it.
      assertKeepsLayersLocks(nodes, op, options);
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
      // A locked block inside what this deletes, and a locked block this
      // takes something out of: both change what the lock protects.
      assertKeepsLayersLocks(nodes, op, options);
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
      assertDropSlotWasVacated(op.dropSlotIfEmpty, location, "remove");
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
      // The subtree it carries, the locked block it leaves and the locked
      // block it enters: each is a change to something a lock protects.
      assertKeepsLayersLocks(nodes, op, options);
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
      // The slot the original placement created, if this move is the undo of
      // one. After the relocation, because the slot the node has just left is
      // only empty once it is out.
      assertDropSlotWasVacated(op.dropSlotIfEmpty, location, "move");
      const settledForest =
        op.dropSlotIfEmpty === undefined
          ? moved
          : dropEmptySlot(moved, op.dropSlotIfEmpty);
      // Measured on the SETTLED forest, not the intermediate one. The cleanup
      // is part of this op, so the document it produces is the one that must
      // fit — and near the byte cap the transient state can be larger than
      // either end. An undo whose forward move created a slot then measures the
      // forest with that slot still present, is refused for crossing the cap,
      // and the edit becomes un-undoable while the state it would restore fits
      // comfortably.
      assertFitsCaps(
        document,
        withNodes(document, settledForest),
        "move",
        limits
      );
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
      // After the names are known to be patchable, because the rule reads them:
      // a patch naming `locked` alone is the one change a locked block takes.
      assertKeepsLayersLocks(nodes, op, options);
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
      // Canonicalised unconditionally, not only when fields were removed. A
      // patch that WRITES a field the node already had leaves it where it was,
      // while one that adds a field appends it — so two documents holding the
      // same values differ by which edit produced them, and the inverse of the
      // second does not restore the first.
      const updated = rebuild(written, current =>
        current.id === op.id
          ? canonicalNode(
              cleared.length === 0 ? current : withoutKeys(current, cleared)
            )
          : current
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

    case "envelope":
      return applyEnvelope(document, op, limits);

    case "seo":
      return applySeo(document, op, limits);

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

/**
 * Apply an `envelope` op: write or remove whole envelope fields of a component.
 *
 * Held to what `update` holds a node patch to, for the same reasons: the op is
 * persisted, so every name it carries is one this op may write and every value
 * one JSON writes unchanged; an op that changes nothing is refused rather than
 * recorded as an undo with no effect; and the result is judged against the
 * document's caps. The inverse is read from the document, never declared.
 */
function applyEnvelope(
  document: BlockDocument,
  op: Extract<BuilderOp, { kind: "envelope" }>,
  limits: DocumentLimits
): AppliedOp {
  // A page has no placements to offer anything to, and a field written onto
  // one would be refused by its next save as an envelope a page cannot hold.
  if (!isComponentDocument(document)) {
    throw new OpError(
      `envelope: only a component offers fields, slots and variants to its ` +
        `placements, and this document is a ${describe(document.kind)}.`
    );
  }
  const removed = assertEnvelopeOp(op);
  const touched = [...Object.keys(op.patch), ...removed];
  const held = document as unknown as Record<string, unknown>;
  const written = op.patch as Record<string, unknown>;
  const changesSomething = touched.some(key =>
    removed.includes(key as EnvelopeField)
      ? ownValue(held, key) !== undefined
      : !equalWithin(ownValue(held, key), written[key], COMPARISON_BUDGET)
  );
  if (!changesSomething) {
    throw new OpError(
      `envelope: the component already holds every value this op would ` +
        `write, so it changes nothing. A history entry for it would undo to ` +
        `no visible effect.`
    );
  }

  const prior: Record<string, unknown> = {};
  const absent: EnvelopeField[] = [];
  for (const key of touched as EnvelopeField[]) {
    const value = ownValue(held, key);
    if (value === undefined) absent.push(key);
    // Detached, as `update`'s prior values are: the inverse must restore the
    // field as it stood, whatever later touches the old document's copy.
    else prior[key] = snapshot(value);
  }

  const next: Record<string, unknown> = { ...held, ...snapshot(op.patch) };
  // Deleted rather than left holding `undefined`, which JSON cannot write and
  // this module's own value check would refuse on the next edit.
  for (const key of removed) delete next[key];
  const result = next as unknown as BlockDocument;
  assertFitsCaps(document, result, "envelope", limits);
  return {
    document: result,
    inverse: {
      kind: "envelope",
      patch: prior,
      ...(absent.length > 0 ? { unset: absent } : {}),
    },
  };
}

/**
 * Apply a `seo` op: write a document's metadata whole, or remove it.
 *
 * Held as `envelope` is: the value is one JSON writes unchanged and a save
 * would accept, an edit that changes nothing is refused, the result is judged
 * against the document's caps, and the inverse is read from the document.
 */
function applySeo(
  document: BlockDocument,
  op: Extract<BuilderOp, { kind: "seo" }>,
  limits: DocumentLimits
): AppliedOp {
  const written: unknown = op.seo;
  if (written !== null) assertDocumentSeo(written);
  const held = document as unknown as Record<string, unknown>;
  const settingsValue = ownValue(held, "settings");
  const settings = isPlainRecord(settingsValue) ? settingsValue : {};
  const prior = ownValue(settings, "seo");
  const unchanged =
    written === null
      ? prior === undefined
      : equalWithin(prior, written, COMPARISON_BUDGET);
  if (unchanged) {
    throw new OpError(
      `seo: the document already holds this metadata, so the edit changes ` +
        `nothing. A history entry for it would undo to no visible effect.`
    );
  }
  const result = withSeo(held, settings, written);
  assertFitsCaps(document, result, "seo", limits);
  return {
    document: result,
    // Detached, as `envelope`'s prior values are.
    inverse: {
      kind: "seo",
      seo: prior === undefined ? null : snapshot(prior),
    },
  };
}

/** Refuse a `seo` op's value that is not metadata a save would accept. */
function assertDocumentSeo(written: unknown): void {
  if (!isPlainRecord(written) || !isJsonValue(written)) {
    throw new OpError(
      `seo: ${describe(written)} is not a document's metadata. A seo op ` +
        `carries the metadata record, or null to remove it.`
    );
  }
  const problem = documentSeoIssues(written).find(
    issue => issue.severity === "error"
  );
  if (problem !== undefined) {
    throw new OpError(`seo: ${problem.path}: ${problem.message}`);
  }
}

/** The document with `written` as its metadata, or none for null. */
function withSeo(
  held: Record<string, unknown>,
  settings: Record<string, unknown>,
  written: unknown
): BlockDocument {
  const nextSettings: Record<string, unknown> = { ...settings };
  if (written === null) delete nextSettings.seo;
  else nextSettings.seo = snapshot(written);
  const next: Record<string, unknown> = { ...held };
  // Removed rather than left empty, so undoing a document's first metadata
  // gives back the document it was.
  if (Object.keys(nextSettings).length === 0) delete next.settings;
  else next.settings = nextSettings;
  return next as unknown as BlockDocument;
}

/**
 * The names an `envelope` op carries, judged: a record of envelope fields
 * whose values JSON writes unchanged, and a list of envelope fields to remove,
 * none of them also written. Answers the fields to remove.
 */
function assertEnvelopeOp(
  op: Extract<BuilderOp, { kind: "envelope" }>
): readonly EnvelopeField[] {
  if (!isPlainRecord(op.patch) || !hasOnlyJsonOwnKeys(op.patch)) {
    throw new OpError(
      `envelope: a patch of ${describe(op.patch)} names no fields. An ` +
        `envelope op carries a record of the fields to write.`
    );
  }
  const unset: unknown = op.unset ?? [];
  // The JSON domain FIRST, as `update`'s list is judged: reading an index of a
  // list holding an accessor would run it before anything refused the list.
  if (!Array.isArray(unset) || !isJsonValue(unset) || !unset.every(isString)) {
    throw new OpError(
      `envelope: \`unset\` of ${describe(unset)} is not a list of field names.`
    );
  }
  for (const key of [...Object.keys(op.patch), ...(unset as string[])]) {
    if (!isEnvelopeField(key)) {
      throw new OpError(
        `envelope: ${describe(key)} is not a field this op may write. It ` +
          `writes only ${ENVELOPE_FIELDS.join(", ")}.`
      );
    }
  }
  for (const key of unset as EnvelopeField[]) {
    if (Object.hasOwn(op.patch, key)) {
      throw new OpError(
        `envelope: ${describe(key)} is both written and removed, so the op ` +
          `says two things about one field.`
      );
    }
  }
  const values = Object.values(op.patch);
  if (values.some(value => value === undefined)) {
    throw new OpError(
      `envelope: a field set to undefined disappears when the op is stored; ` +
        `name it in \`unset\` instead.`
    );
  }
  if (!areJsonValues(values)) {
    throw new OpError(
      `envelope: the patch holds a value JSON cannot carry unchanged, so the ` +
        `edit would replay as something else, or not at all.`
    );
  }
  return unset as EnvelopeField[];
}

/**
 * A GROUP of ops applied as one edit.
 *
 * The caps are the caller's throughout: every step is judged as `applyOp` judges
 * it, because a document that transiently breaks its own invariant is a document
 * whose UNDO may not be applicable. `undo` pops its entry before replaying it
 * and does not put it back, so an inverse group the caps refuse on the way out
 * loses the edit it was meant to take back.
 *
 * Suspending the cap for the span of a group cannot be made safe. The inverses
 * it would then hold have to be bounded, or one group keeps hundreds of
 * megabytes alive in a single history entry; bounding them makes an accepted
 * group's own undo refusable; and establishing that the undo is applicable
 * requires the same question of the undo's redo, which does not terminate.
 *
 * The cost is that a group's outcome can depend on the ORDER its ops arrive in.
 * A group at the byte cap whose first op grows the document is refused, while
 * the same ops with a reduction first are not, for the same resulting document.
 * A caller that knows its ops are independent may order them; this function
 * cannot know that of an arbitrary group.
 *
 * Inverses come back in UNDO order — the last op's inverse first — because each
 * one describes the document as it stood when that op ran, and replaying them
 * forwards would meet a tree the later ops had already changed.
 */
export interface AppliedOps {
  readonly document: BlockDocument;
  /**
   * The inverses to record, in undo order.
   *
   * EMPTY when the group left the document as it found it, which is not a
   * failure: the ops were legitimate and each changed something, and the net
   * effect is still nothing to undo.
   */
  readonly inverses: readonly BuilderOp[];
}

export function applyOps(
  document: BlockDocument,
  ops: readonly BuilderOp[],
  limits: DocumentLimits = DEFAULT_LIMITS,
  options: ApplyOptions = {}
): AppliedOps {
  // The LIMITS are `applyOp`'s to judge, and it judges them on every op it
  // applies. Reading them here as well would observe a caller's accessor or
  // proxy twice for a single edit, and make the one-op path behave unlike the
  // single call it is supposed to be.
  //
  // A group with no ops therefore judges no limits, because it judges no edit:
  // nothing is measured against a cap that nothing is applied to.
  //
  // No branch for that empty group either. The fold runs no times, so the
  // endpoints are the same object and the comparison below already answers with
  // the document unchanged and nothing to record. A branch saying that again
  // would be a second statement of it, waiting to disagree.
  //
  // A group of one IS the single call. `applyOp` has already refused an op that
  // changes nothing, so the endpoint comparison below would walk two documents
  // to re-answer a question it just answered — on the commonest edit in the
  // builder, since the editor routes every single-block edit through here.
  if (ops.length === 1) {
    const only = applyOp(document, ops[0], limits, options);
    return { document: only.document, inverses: [only.inverse] };
  }

  let working = document;
  const inverses: BuilderOp[] = [];
  for (const op of ops) {
    const applied = applyOp(working, op, limits, options);
    working = applied.document;
    // Front, so undoing the group runs the LAST op's inverse first: each
    // inverse describes the document as it stood when its op ran.
    inverses.unshift(applied.inverse);
  }

  // ENDPOINTS, not ops. `applyOp` refuses an op that changes nothing, because a
  // history entry whose undo has no visible effect reads as the history being
  // broken — and a GROUP reaches the same place while every op in it changed
  // something: grow a value, then restore it. Compared with the predicate
  // `applyOp` uses for its own no-op check, rather than a second opinion about
  // what changing nothing means.
  //
  // Rooted at the DOCUMENT, where `applyOp` roots the same question at the
  // field, and the difference has a boundary worth naming: the comparison is
  // depth-bounded from wherever it starts, so the envelope and forest levels
  // this walk adds bring a value stored near the depth limit past it. Measured
  // — a value 510 levels deep compares equal field-rooted and different
  // document-rooted.
  //
  // Past that bound the comparison answers "different" and the group is
  // recorded. That is the safe direction: recording an entry that undoes to
  // nothing visible costs an author one wasted press, while dropping one the
  // comparison could not read costs them an edit they cannot take back.
  if (sameStoredValue(document, working)) return { document, inverses: [] };
  return { document: working, inverses };
}
