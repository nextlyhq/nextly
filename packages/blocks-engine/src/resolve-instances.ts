/**
 * Inlining a linked component definition into the document that references it.
 *
 * A component INSTANCE is one node holding a reference, a variant id and a
 * set of overrides. What a reader has to draw is the definition's whole tree,
 * with those overrides applied and the instance's own slot content in place of
 * the definition's. Turning the first into the second is this module.
 *
 * ## Why the engine owns it, and only half of it
 *
 * Four consumers need a resolved tree and none of them is the renderer alone:
 * the canvas renders in the same document as the admin rather than in an
 * iframe, the class-usage index reads a resolved tree to know which classes a
 * page really applies, and SEO derivation reads one to find a page's heading.
 * A resolver living beside any one of them is reimplemented by the other three.
 *
 * The FETCH is deliberately not here. Only the stores know whether a caller
 * wants a draft definition or a published one, and that posture is the whole
 * difference between the editor's iframe and a served page. This module is
 * handed definitions and asks no questions about where they came from.
 *
 * ## What it guarantees
 *
 * - **Identity-preserving.** A document holding no instance comes back as the
 *   same object, so the ordinary page allocates nothing and a caller comparing
 *   stages by reference reads "unchanged" rather than "repaired".
 * - **Deterministic.** Every inlined node's id is derived from the instance and
 *   the definition node it came from, so two renders of one page produce the
 *   same ids. Styles, overlays, editor history and React keys all key on node
 *   ids; ids that changed per render would remount the tree on every request
 *   and detach every stylesheet rule from the markup it describes.
 * - **Per-instance failure.** A missing definition, a containment cycle, a
 *   nesting cap or an exhausted node budget leaves THAT instance unresolved and
 *   renders the rest of the page. Refusing the page would hand a visitor a
 *   blank screen for a fault in one region of it.
 *
 * ## What it does not do
 *
 * It does not evaluate bindings, prune hidden nodes, migrate, dedupe or drop
 * placeholders. Those are later stages of the read pipeline and they run over
 * the resolved tree — which is what makes a binding inside a definition resolve
 * against the HOST document's context, and a `visibility` exposure able to
 * decide whether a definition's node is served at all.
 *
 * @module resolve-instances
 */
import type { BlockDocument, ComponentDocument } from "./document";
import {
  DEFAULT_LIMITS,
  type DocumentLimits,
  MAX_COMPOSED_DEPTH,
} from "./limits";
import { boundedLimit } from "./measure-bytes";
import { isPlainRecord } from "./plain-record";
import type {
  ComponentLookup,
  ComponentUnresolvedReason,
  ResolveComponentOptions,
  ResolvedComposition,
} from "./resolve-instances-contract";
import {
  type ResolveRun,
  ROOT_SCOPE,
  surveyHost,
} from "./resolve-instances-run";
import { inlineForest } from "./resolve-instances-walk";

export { COMPONENT_UNRESOLVED_REASONS } from "./resolve-instances-contract";
export type {
  ComponentLookup,
  ComponentUnresolvedReason,
  DefinitionsById,
  PropExposure,
  ResolveComponentOptions,
  ResolvedBlockNode,
  ResolvedComposition,
  ResolvedDocument,
  UnresolvedInstance,
  WorkAllowance,
} from "./resolve-instances-contract";
export {
  componentIdsIn,
  componentPlacementsIn,
  componentReachIn,
  componentReferencesFrom,
  componentReferencesIn,
  componentUsageIn,
  variantNamesIn,
  variantReferencesIn,
} from "./resolve-instances-references";
export type {
  ComponentPlacement,
  ComponentReachSurvey,
  ComponentUsage,
  DocumentPlacements,
  PlacementReferences,
  VariantReferences,
} from "./resolve-instances-references";
export { composedRootTypes, placementTypesOf } from "./resolve-instances-roots";
export { readableDefinition } from "./resolve-instances-expand";
export {
  instanceExposure,
  variantPreview,
} from "./resolve-instances-exposures";
export type {
  ExposedPropertyState,
  ExposedValueSource,
  InstanceExposure,
  OverriddenBy,
} from "./resolve-instances-exposures";
export {
  claimedDomId,
  composedNodeId,
  hostIdsIn,
} from "./resolve-instances-clone";

/**
 * Inline every component instance the document holds.
 *
 * @param document the host document, as stored
 * @param definitions the definitions to inline, at the posture the caller chose
 */
export function resolveComponentInstances(
  document: BlockDocument,
  definitions: ComponentLookup,
  options: ResolveComponentOptions = {}
): ResolvedComposition {
  const unchanged: ResolvedComposition = {
    document,
    referenced: [],
    unresolved: [],
    renamedDomIds: new Map<string, string>(),
    loopsClosed: [],
  };
  if (!isPlainRecord(document) || !Array.isArray(document.nodes)) {
    return unchanged;
  }

  // Taken by name and validated once, rather than read from the caller's object
  // wherever a cap is wanted. Two separate faults meet on this line.
  //
  // A `NaN` cap is not a loose bound, it is NO bound: `budget <= 0` is false
  // against it, so the survey never stops and `survey.truncated` is never set —
  // and the refusal directly below, which exists because composing from a
  // partial survey is worse than not composing, silently never fires. Measured
  // on a document of `maxNodes + 11` entries: under the default cap the
  // resolver returns the document unchanged and references nothing, and under
  // a `NaN` cap it composes it. `limits.maxNodes - survey.count` is NaN too,
  // so the slot budget fails open as well.
  //
  // And `options.limits` is an object the CALLER owns, read four times here. A
  // member that answers differently between reads lets the survey validate
  // under one cap while the composition runs under another — the same fault
  // this module's planner neighbour was fixed for.
  //
  // `maxBytes` is carried but NOT validated: nothing here reads it, and
  // refusing a value this function never consults would reject callers it has
  // always served. It is taken by name so the snapshot is whole.
  const supplied = options.limits ?? DEFAULT_LIMITS;
  const limits: DocumentLimits = {
    maxDepth: boundedLimit(
      supplied.maxDepth,
      "maxDepth",
      "resolveComponentInstances"
    ),
    maxNodes: boundedLimit(
      supplied.maxNodes,
      "maxNodes",
      "resolveComponentInstances"
    ),
    maxBytes: supplied.maxBytes,
  };
  // Validated for the reason the caps above are: `left <= 0` is false against
  // `NaN`, so an unusable allowance would bound nothing while reading as a bound.
  if (options.work !== undefined) {
    boundedLimit(options.work.left, "work.left", "resolveComponentInstances");
  }
  const survey = surveyHost(document.nodes, limits.maxNodes);
  // A survey that stopped at the cap collected a PREFIX of the document's ids,
  // so every id minted afterwards would be checked against a set missing
  // whatever the walk never reached — and an unread later node carrying a
  // minted id is exactly the duplicate the seeding exists to prevent. A
  // document past `maxNodes` is therefore composed not at all rather than up
  // to the cap: proceeding on a partial answer is worse than not composing.
  if (survey.truncated) return unchanged;
  // An optimisation, and stated as one because no test can hold it: identity
  // is already guaranteed by `inlineForest`, which returns its input array
  // when nothing changed, so removing this line changes no output. What it
  // saves is building the run and walking the tree at all, which is the whole
  // cost this module adds to a page that uses no components.
  //
  // `hasStoredProvenance` is the exception, and it is why this is no longer
  // purely an optimisation. A document with no instances still has to be walked
  // when one of its nodes carries a stored `instanceOf`, because that claim is
  // stripped on the way through and returning early would leave it standing.
  if (!survey.hasInstance && !survey.hasStoredProvenance) return unchanged;

  const run: ResolveRun = {
    definitions,
    maxDepth: limits.maxDepth,
    maxNodes: limits.maxNodes,
    maxComposedDepth: options.maxComposedDepth ?? MAX_COMPOSED_DEPTH,
    exposures: options.exposures === true,
    carryConditions: options.conditioned === "carry",
    // What is LEFT under the cap, not the cap itself. `maxNodes` bounds a
    // document, and the composed tree IS the document every later pass walks —
    // the style compiler, the renderer, the SEO derivation. Starting a fresh
    // allowance here would let a page at the cap resolve to twice it while
    // every one of those passes believes it is reading a bounded document.
    budget: limits.maxNodes - survey.count,
    work: options.work,
    taken: survey.ids,
    takenDomIds: survey.domIds,
    renamedDomIds: new Map<string, string>(),
    minted: [],
    mintedDomIds: [],
    abort: undefined,
    referenced: [],
    referencedSeen: new Set<string>(),
    unresolved: [],
    loopsClosed: [],
    definitionsRead: new Map<
      string,
      ComponentDocument | ComponentUnresolvedReason
    >(),
  };
  const nodes = inlineForest(document.nodes, run, ROOT_SCOPE, 1);
  return {
    document: nodes === document.nodes ? document : { ...document, nodes },
    referenced: run.referenced,
    unresolved: run.unresolved,
    renamedDomIds: run.renamedDomIds,
    loopsClosed: run.loopsClosed,
  };
}
