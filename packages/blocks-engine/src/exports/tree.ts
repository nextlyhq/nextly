/**
 * The engine's public exports: the tree primitives, the copy-relink rules, sibling runs, the composition planners, provenance records and node selection.
 *
 * Part of the package's root entry, `../index.ts`, which re-exports every
 * part in a fixed order. Nothing here imports that entry.
 */
export {
  newId,
  makeNode,
  expandSlotDefaults,
  walkNodes,
  // The one forest rewrite. A caller changing a field across a stored tree
  // needs its three learned behaviours — a cycle entry dropped, a malformed
  // entry passed through, a malformed slot preserved — and writing a second
  // traversal inherits none of them.
  mapForest,
  findNode,
  locateNode,
  insertNode,
  removeNode,
  moveNode,
  reidSubtree,
  // The forest form, which is the shape a saved selection actually has: a
  // pattern is a run of siblings, and re-identifying its roots one at a time
  // leaves a reference that crosses between them pointing at the original.
  reidForestWithMap,
  type DomIdPolicy,
  // The one rule for what a copied DOM id becomes. Public because two copiers
  // apply it — pattern insert and component composition — and a page may hold
  // the output of both, so a second spelling would put two ids on one target.
  mintDomId,
  // Which nodes the renderer prunes, inherited down the subtree. Published
  // because "is this id actually on the page" is asked by the planners, the
  // copier and the editor's attribute panel, and three readings of it is three
  // ways to disagree.
  hiddenSubtreeNodes,
  // And the other half of it: an id that MOVED leaves every reference to it
  // pointing at nothing, and `aria-labelledby` resolving to nothing is an
  // element losing its accessible name in silence. Published as data and as a
  // function, because a surface that copies nodes without going through these
  // helpers still has to know which attributes carry an id.
  ID_REFERENCE_ATTRIBUTES,
  remapIdReferences,
  // And what such a value IS, once its separators are gone. A consumer that
  // fingerprints or compares copied content has to tokenise it exactly where
  // the remapper does, and a `split` of their own agrees only until one moves.
  idReferenceTokens,
  // Which of a set of candidate ids a subtree's references actually reach,
  // answered by running the relink pass rather than by enumerating the carriers
  // a second time. Published for the same reason the two above are: a surface
  // recording what a copy renamed has to agree with what the copier rewrote,
  // and a parallel walk agrees only until one of them gains a carrier.
  referencedDomIds,
  duplicateNode,
  updateNode,
} from "../tree";
export type {
  NodeLocation,
  ReidentifiedForest,
  SlotDefaultSource,
  TreePosition,
  // Beside `walkNodes`, because a caller BOUNDING a walk has to hold its
  // options in a variable to build one — and the option that says the budget
  // ran out is useless to anyone who cannot name the type carrying it.
  WalkOptions,
} from "../tree";

// The one rule for which prop of a copied node holds a link, and what happens
// to it. Published because the module claims to be the single source for every
// copying surface, and a rule a consumer cannot import is a rule they will
// write again — which is exactly how the fragment remap came to exist twice.
export {
  FRAGMENT_REFERENCE_PROPS,
  remapFragmentBindings,
  remapFragmentProps,
} from "../fragment-refs";

// Whether a selection is one run of siblings. Published because the editor and
// every composition planner must agree on it, and they cannot share a
// builder-side copy: a planner runs inside a plugin's server action, where the
// builder — which peer-depends on React — has no business being imported.
export { contiguousRun, siblingRun } from "../sibling-run";
export type {
  RunPlace,
  RunProblem,
  SiblingRun,
  SiblingRunResult,
} from "../sibling-run";

// The composition planners: pure functions from a selection to the row to
// create and the ops the page needs. Split from the doing so the caller can put
// both writes in one unit of work and roll the create back — and so the dry run
// and the real run are the same function rather than two that agree for now.
export { patternDigest } from "../pattern-digest";
export {
  planConvertToComponent,
  planDetach,
  planDuplicateComponent,
  planInsertPattern,
  // Paste of copied blocks, for the editor and for any script that pastes
  // through the same ops and refusals.
  planPasteBlocks,
  internalNestingVerdict,
  patternRefusal,
  saveAsPatternRefusal,
  planSaveAsComponent,
  planSaveAsPattern,
  planUpdatePatternFromSelection,
} from "../composition-planners";
export type {
  ComponentExposure,
  CompositionPlan,
  CreatePlanResult,
  InsertTarget,
  StoredPattern,
  PlacementTarget,
  LibraryTarget,
  OrphanedAnchorWarning,
  PlanProblem,
  PlanRefusal,
  PlanResult,
  PlanWarning,
  PlannedCreate,
  PlannedUpdate,
  PatternUpdateTarget,
  RequestedProperty,
  RequestedSlot,
} from "../composition-planners";

// The node selection every reader of a stored document shares. Public because
// the page-builder plugin's class-usage record has to stop exactly where the
// style compiler stops: a class applied to a node the compiler styled but the
// counter never reached is absent from the record a safe-delete check reads,
// and absence there is indistinguishable from "not used".
// The one answer to whether a stored value is a whole provenance record. A
// consumer holding `BlockOrigin` and no way to check one has to write the check
// again, and a second spelling of it admits records this package refuses.
// The guard, the richer reading it is derived from, and what a trusted record
// says. Published together because they are one read: a caller that must tell a
// record it cannot READ from one that is merely wrong — the validator does — or
// that needs the renames a trusted record carries, or the nodes they were
// applied to, would otherwise name the guard's fields a second time to find
// out, and a second reading of a stored record runs its own reflection twice.
export {
  isBlockOrigin,
  patternRenameRecord,
  patternRenames,
  readBlockOrigin,
} from "../document";
export type { OriginReading, PatternRenameRecord } from "../document";
// The one rule for which DOM id a node actually renders. A node can spell one
// two ways and emits at most one, so anything asking "what ids are on this
// page" — a planner steering an insert around collisions, a duplicate check —
// has to ask this rather than read the two fields independently.
export { isPatternDocument } from "../document";
export { renderedDomId, renderedDomIdIn } from "../document";

export { selectNodes } from "../select-nodes";
export type {
  NodeSelection,
  SelectedNode,
  SelectionStop,
} from "../select-nodes";

export { documentWork, measureBytes, surveyDocument } from "../measure-bytes";
