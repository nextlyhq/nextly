/**
 * The op vocabulary: the edits an editor applies, and how each one is undone.
 *
 * ## Why this is not in `operations.ts`
 *
 * That module holds the operation NAMES the format reserves, and `format.ts`
 * re-exports it — the entry point whose whole value is what it does not reach,
 * so that a generator or a schema publisher does not also load the validator,
 * the migrations and the style compiler's CSS parser. Applying an op needs the
 * tree primitives, the registry's slot-name predicate and the node validators,
 * which reach both `picomatch` and `css-tree`. Putting the vocabulary beside
 * the names would have pulled all of it through `format.ts` — which is exactly
 * the regression `format-boundary.test.ts` exists to catch, and did.
 *
 * ## Why it is in the ENGINE at all
 *
 * Applying an edit is not an editing-surface concern. A plugin route, a script
 * or an agent has the same right to the operations the editor applies, and each
 * would otherwise grow its own vocabulary that agrees with this one only until
 * one of them changed. `@nextlyhq/builder` re-exports these unchanged.
 *
 * ## The complexity suppressions in this module's parts
 *
 * Eleven functions in this module's parts carry `fallow-ignore-next-line
 * complexity`, and they are all the same case: this module was RELOCATED from
 * `packages/builder/src/ops.ts` byte for byte. Every one of them predates the
 * move and was inherited — and so ungated — in its previous home. The audit
 * calls them new only because the builder file has to keep existing to serve
 * the published `@nextlyhq/builder/ops` subpath, so git records an add rather
 * than a rename. Verified by experiment: deleting that file makes git report a
 * 98% rename and the audit passes with every finding marked inherited.
 *
 * They cannot be tested down. The health check scores CRAP against a flat
 * coverage estimate, so the threshold fails at cyclomatic 10 whatever the tests
 * do — and the op tests are thorough. Reducing them means restructuring
 * the editor's core mutation path, which is not a safe companion to a move
 * whose whole value is being provably behaviour-preserving.
 *
 * Suppressed INLINE rather than by a path in `.fallowrc.jsonc`, because that
 * config explains why: a path glob "would blind a path permanently and
 * silently". A new complex function added to any part still gets caught; only
 * these eleven, named one by one, do not.
 *
 * @module ops
 */

import type { BlockDocument, BlockNode } from "./document";
import type { DocumentLimits } from "./limits";
import { assertEditableDocument } from "./ops-apply";
import {
  assertForestEntries,
  assertListIsData,
  assertNodeShape,
  assertSubtreeIdsAreUnique,
} from "./ops-checks";
import { assertPosition, assertPositionContainer } from "./ops-positions";
import { SHAPE_ONLY_LIMITS } from "./ops-values";
import { OpError } from "./ops-vocabulary";
import type { TreePosition } from "./tree";

export type { NodePatch } from "./ops-fields";
export {
  sameStoredValue,
  sameStyleValue,
  sameValueInAnyKeyOrder,
} from "./ops-values";
export { OpError, addressesNoNode } from "./ops-vocabulary";
export type {
  BuilderOp,
  EnvelopeField,
  EnvelopePatch,
  OpPosition,
  SlotAddress,
} from "./ops-vocabulary";
export { positionOf } from "./ops-positions";
export { applyOp, applyOps } from "./ops-apply";
export type { AppliedOp, AppliedOps, ApplyOptions } from "./ops-apply";

/**
 * Why the op layer would refuse this FOREST, or `undefined`.
 *
 * The companion to {@link documentRefusal}, and needed beside it because that
 * one reads the envelope: its keys, its values, its format and its kind. It
 * says nothing about the nodes, and `applyOp` walks the whole forest before it
 * applies anything — so a document with a malformed entry the planner never
 * selected passes the envelope check, produces a plan, and throws on apply.
 *
 * That is the dry run disagreeing with the run it predicts, in the direction
 * that costs most: a composition action creates its library row first, so the
 * refusal lands after the write it cannot take back.
 *
 * Walked rather than sampled, because the fault can be anywhere: a `null` among
 * the roots, a node inside its own slots, a field that is a getter rather than
 * stored.
 */
export function forestRefusal(nodes: unknown): string | undefined {
  try {
    assertForestEntries(nodes as BlockNode[]);
    return undefined;
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
}

/**
 * Why this DOCUMENT could not be edited at all, or `undefined`.
 *
 * The third of these asking forms, and the broadest: it covers everything
 * `applyOp` checks before it looks at the op — the envelope being a record, its
 * keys being ones JSON carries, `nodes` being an array, the envelope's values
 * being serializable, `formatVersion` and `kind` being owned and known.
 *
 * A planner needs it because a stored destination can fail any of those and a
 * plan built against one advertises an edit that throws. Checking a single
 * field instead — the format version, say — closes the case that is easy to
 * imagine and leaves the ones that are not: a page whose `kind` was written by
 * a newer version, or one carrying a `BigInt` in an envelope field.
 *
 * Reported rather than thrown, and never re-implemented: the assertion is the
 * rule, and a second predicate spelling of it would agree only until one moved.
 */
export function documentRefusal(document: unknown): string | undefined {
  try {
    assertEditableDocument(document as BlockDocument);
    return undefined;
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
}

/**
 * Why this list cannot be treated as stored data, or `undefined`.
 *
 * Published for the reason the other refusals here are: a planner reads lists a
 * caller supplied, and reading one whose INDICES are accessors runs that
 * caller's code — a throwing getter escaping as a native error where the module
 * promises a refusal, and a getter that appends extending `length` underneath
 * the loop that is supposed to be bounded by it.
 *
 * Neither the array type nor a shadowed-method check answers this: the value
 * can be a genuine array, with well-formed entries, and still compute them.
 */
export function listRefusal(
  list: unknown,
  subject: string
): string | undefined {
  try {
    assertListIsData(list, subject);
    return undefined;
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
}

/**
 * Why removing this subtree would be refused, or `undefined`.
 *
 * Published for the reason {@link nodeShapeRefusal} and {@link positionRefusal}
 * are: a planner that emits a `remove` has to know whether the apply will take
 * it, and the rule is not the one a caller would guess. `remove` refuses when
 * any id ANYWHERE IN THE SUBTREE it is about to take occurs more than once in
 * the document — not merely when the root's own id does — because the inverse
 * it records could not put that subtree back.
 *
 * A planner checking only the root passes a selection whose deep child shares an
 * id with a node elsewhere on the page, and the apply then throws on the first
 * op of a group whose library row has already been written. That is the failure
 * the plan/apply split exists to prevent.
 */
export function subtreeRemovalRefusal(
  nodes: BlockNode[],
  root: BlockNode
): string | undefined {
  try {
    assertSubtreeIdsAreUnique(nodes, root, "remove");
    return undefined;
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
}

/**
 * Why this node would be refused as an insert's subtree, or `undefined`.
 *
 * The companion to {@link positionRefusal} and published for the same reason: a
 * planner has to know whether the subtree it is about to hand over will be
 * taken. A stored pattern can hold a node that is type-compatible and
 * structurally invalid — `version: 0` is the cheap example — and without this
 * the plan reports success and the apply throws.
 *
 * Judged with the SHAPE-ONLY limits by default, which is what makes this usable
 * from a planner. The structural rules do not depend on limits; the caps on
 * depth and size do, and those belong to whoever applies — a host that raises
 * `maxDepth` would otherwise have a plan refuse a document its own apply
 * accepts, which is the dry run disagreeing with the run it predicts in the
 * direction nobody can debug. The same constant the remove path uses, for the
 * same reason: it asks whether this is a node, not whether it fits.
 *
 * A caller may pass its own limits to have the node-count and depth caps judged
 * as well. The BYTE cap is not among them and cannot be: `assertFitsCaps`
 * measures the document the node is going into, and this is handed a subtree
 * with no destination. A caller that needs the byte cap judged has to ask the
 * apply, which is where the destination is.
 */
export function nodeShapeRefusal(
  node: BlockNode,
  verb = "insert",
  limits: DocumentLimits = SHAPE_ONLY_LIMITS
): string | undefined {
  try {
    assertNodeShape(node, verb, limits);
    return undefined;
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
}

/**
 * Why this position would be refused, phrased as the op layer phrases it, or
 * `undefined` when it would be accepted.
 *
 * The SAME rule the apply runs, reached without applying anything. A planner
 * has to know whether the position it is about to emit will be taken, and the
 * alternative — a second, non-throwing copy of `assertPosition` — is the
 * parallel implementation this package refuses everywhere else: it would agree
 * on the day it was written and diverge the first time either moved.
 *
 * Expressed by catching rather than by restructuring the validator, and that is
 * deliberate. `assertPosition` reports a different sentence per malformed field,
 * so a predicate form of it IS this function; and it carries a
 * `fallow-ignore-next-line complexity` suppression as RELOCATED code, so
 * rewriting it here would reopen a move that was made byte-for-byte on purpose.
 * Only an `OpError` is treated as a refusal — anything else is a fault in this
 * module and is rethrown rather than reported as a bad position.
 */
export function positionRefusal(
  at: unknown,
  verb = "insert"
): string | undefined {
  try {
    assertPositionContainer(at, verb);
    assertPosition(at as TreePosition, verb);
    return undefined;
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
}

/**
 * The first locked node anywhere in a subtree, or `undefined`.
 *
 * Stated in `layers-lock`, beside the rest of the Layers lock's rule, and
 * re-exported here because planners and the builder have always imported it
 * from the op vocabulary.
 */
export { lockedWithin } from "./layers-lock";
