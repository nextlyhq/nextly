/**
 * Inserting a stored pattern into a page, and the refusals a stored or saved
 * pattern can earn.
 *
 * @module composition-planners-insert
 */
import type {
  InsertTarget,
  PlanRefusal,
  PlanResult,
  StoredPattern,
} from "./composition-planners-contract";
import { plannedSave } from "./composition-planners-patterns";
import { insertOps, withInsertOrigin } from "./composition-planners-provenance";
import {
  destinationOf,
  duplicateDomIdRefusal,
  freshCopy,
  internalNestingRefusal,
  lockRefusal,
  placementRefusal,
  shapeRefusal,
  takenDomIds,
} from "./composition-planners-refusals";
import { type BlockDocument, isPatternDocument } from "./document";
import type { NestingSource } from "./nesting";
import { documentRefusal, forestRefusal } from "./ops";
import { patternDigest } from "./pattern-digest";
import type { ComponentLookup } from "./resolve-instances";

/**
 * Insert a saved pattern, as a copy that keeps no link back.
 *
 * **Everything gets fresh ids.** A pattern may be inserted twice into one page,
 * and the stored copy carries whatever ids it was saved with, so placing it as
 * it stands would put two nodes with one id in a document — which the op layer
 * refuses and every id-keyed reader would misread. The roots are re-identified
 * TOGETHER so a reference crossing from one root to the next follows the copy.
 *
 * **`settings` is the destination's.** A pattern carries no document settings —
 * they describe a page, not a run — and the `"document"` target replaces the
 * root forest without touching them, so a full-page pattern does not repaint the
 * page it is starting.
 *
 * ## What it refuses, and why a planner refuses it rather than the apply
 *
 * The plan IS the dry run. A plan that reports success and then throws when it
 * is applied defeats the reason planning is separate from doing, so every
 * refusal the op layer will make that can be foreseen is made here:
 *
 * - a block that may not sit where it is being put, asked of the SHARED nesting
 *   rule, both halves of it — the child naming its permitted parents and the
 *   slot naming what it admits;
 * - a subtree arriving LOCKED, which `applyOp` refuses because the inverse of an
 *   insert is a remove and a remove refuses a locked subtree, so the insert
 *   could never be undone;
 * - a destination parent id the document holds twice, which `applyOp` refuses
 *   because the incoming node would be placed under both.
 *
 * The one refusal left to the apply is the machine cap on depth and size, which
 * depends on limits the caller passes there.
 *
 * **Each inserted root records where it came from.** A pattern is still
 * copy-on-insert and keeps no link back — nothing re-reads the pattern to
 * update the copy — but the roots carry an inert `origin` naming the pattern
 * and the digest it was copied at, so a surface can later ask whether the
 * source has moved on. Only the roots: the run is what was inserted, and
 * marking every node would make detaching one child read as a second
 * insertion.
 */
export function planInsertPattern(
  document: BlockDocument,
  pattern: StoredPattern,
  target: InsertTarget,
  nesting: NestingSource,
  definitions?: ComponentLookup
): PlanResult<never> {
  // The identity BEFORE anything is built on it. A record whose id is not a
  // non-empty string is one `isBlockOrigin` refuses, so the plan would succeed
  // and the insert throw. Checked at RUNTIME as well as in the type: this is a
  // published entry point, and the value reaching it comes from a JavaScript
  // caller or a stored row as often as from a typed one.
  if (typeof pattern.id !== "string" || pattern.id === "") {
    return { problem: "invalid-source" };
  }

  const stored = storedRefusal(document, pattern.document);
  if (stored !== undefined) return stored;

  const destination = destinationOf(document, target);
  if (destination.problem !== undefined) return destination;

  const copy = freshCopy(pattern.document.nodes, takenDomIds(document, target));
  if (copy.problem !== undefined) return copy;

  // Recorded on the way in, and OVERWRITTEN rather than filled in where absent:
  // a root can arrive carrying a record from an earlier copy. The digest is
  // taken from the pattern as it stands now, so a later reader can tell whether
  // the source has moved on since this copy was made.
  const marked = withInsertOrigin(
    copy.nodes,
    pattern.document.nodes,
    pattern.id,
    patternDigest(pattern.document.nodes),
    copy.renamed
  );

  const refusal =
    placementRefusal(marked, destination.place.where, nesting, definitions) ??
    internalNestingRefusal(marked, nesting, definitions) ??
    // The `"document"` target REMOVES what is there, and a remove refuses both
    // a locked subtree and a malformed node for the same reasons an insert
    // does. Only that target deletes anything; a positional insert adds.
    (target === "document"
      ? (lockRefusal(document.nodes, document.nodes) ??
        shapeRefusal(document.nodes))
      : undefined);
  if (refusal !== undefined) return refusal;

  return {
    pageOps: insertOps(marked, destination.place, document, target),
    warnings: [],
  };
}

/**
 * What must be true of the two STORED documents, asked before anything is
 * copied out of either.
 *
 * Before, and not after, because copying is itself a step that can fail on a
 * stored document: `structuredClone` throws on a value JSON cannot carry — a
 * function reaching `props` from an in-process caller — and it throws a native
 * `DOMException` rather than the refusal this module promises. The shape rule
 * catches that same node, so asking it first turns a crash into a cause.
 */
function storedRefusal(
  document: BlockDocument,
  pattern: BlockDocument
): PlanRefusal | undefined {
  const unusable = storedPatternRefusal(pattern);
  if (unusable !== undefined) return unusable;
  // BOTH envelopes, judged by the apply's own document rule rather than by a
  // field of it. The ops are built from one document and applied to the other,
  // and everything `applyOp` asks before it looks at an op — the envelope's
  // keys, its values, its format and its kind — is a way a plan can be built
  // against a destination that cannot be edited at all.
  // The DESTINATION's envelope and its whole forest, because `applyOp` walks
  // both before it applies anything — so a malformed entry nowhere near the
  // insertion point still refuses the op this plan promises.
  if (
    documentRefusal(document) !== undefined ||
    forestRefusal(document.nodes) !== undefined
  ) {
    return { problem: "unusable-document" };
  }
  return undefined;
}

/**
 * Everything about a PATTERN that refuses an insert, wherever it is going.
 *
 * Split from the destination's half because the two are asked at different
 * moments by different callers. A planner asks both, in that order. A palette
 * asks only this one, and asks it ONCE per stored row rather than per candidate
 * position — the answer cannot depend on where the pattern is being put.
 *
 * Not published on its own: {@link patternRefusal} is what a caller outside
 * this module wants, and the two differ only in whether the nesting rule has
 * been asked. Keeping the narrow one private is what stops a caller composing
 * an incomplete preflight by accident.
 */
function storedPatternRefusal(pattern: BlockDocument): PlanRefusal | undefined {
  if (!isPatternDocument(pattern)) return { problem: "not-a-pattern" };
  if (pattern.nodes.length === 0) return { problem: "empty" };
  if (documentRefusal(pattern) !== undefined) {
    return { problem: "unusable-document" };
  }
  return shapeRefusal(pattern.nodes) ?? duplicateDomIdRefusal(pattern.nodes);
}

/**
 * Whether a stored pattern could be inserted ANYWHERE, and why not.
 *
 * The complete pattern-only preflight, published because a palette has to
 * refuse exactly what the planner refuses. Offering a row the planner will
 * reject is a tile that accepts a click and then fails, and the ways a stored
 * pattern can be unusable are not a short list a surface should be keeping its
 * own copy of: the wrong kind, no nodes, an envelope the apply cannot read, a
 * node whose shape it cannot apply, two nodes rendering one DOM id, and an
 * internal placement the rules no longer allow.
 *
 * That last one is why the nesting source is a parameter: a pattern is stored
 * once and inserted for as long as it exists, so the rules can move underneath
 * it.
 *
 * The DESTINATION's half is deliberately not here. Whether a particular page
 * can be edited, and whether these roots may sit at a particular position, are
 * questions about somewhere the pattern is going — asked per placement, by
 * `placementVerdict` and the planner itself.
 */
export function patternRefusal(
  pattern: BlockDocument,
  nesting: NestingSource,
  definitions?: ComponentLookup
): PlanRefusal | undefined {
  return (
    storedPatternRefusal(pattern) ??
    internalNestingRefusal(pattern.nodes, nesting, definitions)
  );
}

/**
 * Whether this selection could be saved as a pattern, and why not.
 *
 * The counterpart to {@link patternRefusal}, published for the same reason and
 * against the opposite mistake. That one stops a palette OFFERING a stored
 * pattern the planner would reject; this one stops a surface offering to SAVE a
 * selection the planner would reject — a button that accepts a click and then
 * fails, which is the same defect on the write side.
 *
 * Asked of the PLANNER rather than restated. The ways a selection can be
 * unsavable are not a short list a toolbar should keep its own copy of: a
 * selection that is not one contiguous run, a block that may not be a document
 * root, a node whose shape the op layer will not carry, a descendant nested
 * somewhere the rules no longer allow, one DOM id on two of the run's own
 * nodes, and a document that will not fit the byte cap. A surface enumerating
 * those drifts the first time the planner learns a new way to say no, and it
 * drifts SILENTLY — the button stays enabled and the save fails.
 *
 * Before this, the only way to ask was to call `planSaveAsPattern` with a
 * `target` invented for the purpose, which is a collection name and a field set
 * a caller asking "may I?" does not have yet.
 *
 * A THIN VIEW over the planner's own preflight rather than a second walk: the
 * same `plannedSave` the two save planners call, so a question answered here
 * and a save attempted afterwards cannot disagree. It therefore does the same
 * work a save does, up to building the stored document — which is what makes it
 * exact, and what makes it worth memoising on the selection rather than calling
 * per render.
 *
 * It takes NO limits of its own, deliberately. `planSaveAsPattern` has
 * none either — it plans under the defaults — so a preflight that accepted them
 * would answer a question the planner never asks: a caller passing a lower
 * `maxNodes` would see a save disabled that the planner then accepts, and a
 * higher one the reverse. A preflight whose whole purpose is to agree with the
 * planner must not take an input the planner cannot take.
 */
export function saveAsPatternRefusal(
  document: BlockDocument,
  selectedIds: readonly string[],
  nesting: NestingSource
): PlanRefusal | undefined {
  const saved = plannedSave(document, selectedIds, nesting);
  return saved.problem === undefined ? undefined : saved;
}
