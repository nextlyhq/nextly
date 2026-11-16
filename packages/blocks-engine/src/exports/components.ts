/**
 * The engine's public exports: linked components: resolving instances, nesting and placement verdicts, exposures, variants, locks and repairs.
 *
 * Part of the package's root entry, `../index.ts`, which re-exports every
 * part in a fixed order. Nothing here imports that entry.
 */
// Resolving linked components. Here rather than beside the renderer because
// four surfaces need a resolved tree and only one of them renders: the
// same-document canvas, the class-usage index and SEO derivation all read one
// without drawing anything. `componentIdsIn` is the other half of the seam —
// what to FETCH, asked before anything can be resolved.
/**
 * Whether a component's references lead back to itself, and by which chain.
 *
 * Published because two surfaces ask it at different moments and must agree:
 * an insert panel deciding what to OFFER while a component is open for
 * editing, and a write deciding whether the document it is about to store
 * closes a loop. The verdict carries `unknown` as its own answer rather than
 * collapsing it, because the two spend that uncertainty differently — one
 * withholds a tile, the other would refuse a save.
 */
export {
  componentReach,
  type ComponentPlacements,
  type ComponentReach,
} from "../component-graph";

export {
  componentIdsIn,
  // Every component a document can reach under ANY variant it offers, which is
  // a different question from what its nodes carry. Published because the write
  // guard has to judge a document a variant can re-point, and the usage index
  // has to count what is actually stored.
  componentReferencesIn,
  // And the half that needs BOTH documents: what ONE placing node's overrides
  // install on the definition it places. Published because the write guard and
  // the insert panel both have to follow an edge neither document names alone.
  componentReferencesFrom,
  // Which NODES place something, rather than which components are placed. A
  // caller following a placement-level override needs the node that carries it.
  componentPlacementsIn,
  // Both of the above from ONE walk, for the callers that need both.
  componentReachIn,
  componentUsageIn,
  // What those three ANSWER WITH. Published alongside them because a caller that
  // cannot name a return type cannot hold it in a field, pass it on, or declare
  // a function over it — `ReturnType<typeof>` is a workaround for an omission,
  // not an interface.
  type ComponentPlacement,
  type ComponentReachSurvey,
  type DocumentPlacements,
  type PlacementReferences,
  // The selections that union covers, separately. A caller that must agree with
  // the rendered page composes each one; the union answers about none of them.
  variantNamesIn,
  // What each of those selections installs, from one index of the forest. A
  // caller composing selections separately needs them apart, and needs them
  // without walking the forest again per variant.
  variantReferencesIn,
  type VariantReferences,
  // The roots a document composes to, read without composing it. Published
  // because the palette judges every definition's placement by its roots and
  // composing three thousand of them to read their roots is the cost this
  // avoids.
  composedRootTypes,
  placementTypesOf,
  // What ONE instance currently shows for each property its definition exposes.
  // Published because the editor draws that panel and the resolver applies the
  // same precedence to render it: definition, then variant, then the instance's
  // own value. Two implementations of that order agree until a variant rule
  // changes in one of them.
  instanceExposure,
  // A component's own tree as one of its variants draws it, ids kept, for
  // the editor's canvas to preview the variant open in the component's view.
  variantPreview,
  // What a supplied definition has to be before the resolver inlines it.
  // Published because the editor's inspector draws from the same lookup the
  // canvas resolves against, and must refuse exactly what the canvas refuses.
  readableDefinition,
  resolveComponentInstances,
  // Why an instance was left standing. Published because the surfaces that
  // REPORT one are in other packages — the renderer draws a placeholder, the
  // editor offers a remedy — and each remedy differs by reason. A consumer
  // restating the list agrees on the day it is written and silently stops
  // handling whichever reason is added next.
  COMPONENT_UNRESOLVED_REASONS,
} from "../resolve-instances";
export type {
  ComponentLookup,
  ComponentUnresolvedReason,
  ComponentUsage,
  DefinitionsById,
  ExposedPropertyState,
  ExposedValueSource,
  InstanceExposure,
  OverriddenBy,
  ResolveComponentOptions,
  PropExposure,
  ResolvedBlockNode,
  ResolvedComposition,
  ResolvedDocument,
  UnresolvedInstance,
  WorkAllowance,
} from "../resolve-instances";
// The nesting rule and the types it answers in. Exported together: a caller
// that can ask the question must be able to name the verdict it gets back, and
// a refusal reason it cannot name is one it has to re-derive from the boolean.
//
// BOTH halves ship, because a placement needs both to agree and neither is
// derivable from the other: `canNest` is the child naming the parents it may
// sit under, `canNestInSlot` is the container naming what a given slot admits.
// Exporting only one leaves a caller — an inserter offering block types, a
// canvas judging a drop — able to ask half the question and obliged to compute
// the other half itself, which is the second implementation this module exists
// to prevent. The validator reaches them by relative path and would not have
// noticed: a module the entry does not name is absent from `dist` however
// thoroughly it is tested.
export { canNest, canBeRoot, canNestInSlot } from "../nesting";
// The one reading of an allow-list of block names (an exact name, or "ns/*"
// for a namespace), stable public API: a blocks field's accepted blocks, a
// slot's, and any reader listing what one accepts all match by it, so the
// three cannot come to admit different blocks.
export { slotAdmits } from "../nesting";
export { placementVerdict } from "../nesting";
export type { NestingSource, NestingVerdict, NestingRefusal } from "../nesting";
// The one placement rule over the nesting rule above: declared slots, the
// HTML content model a block's settings give it, and component placements'
// exposed slots. Every placement path asks it, editor and server alike, and
// one wording says its refusals in both.
export {
  CONTENT_KINDS,
  UNDECLARED_CONTENT_MODEL,
  contentModelKey,
  resolveContentModel,
} from "../content-model";
export type {
  ContentKind,
  ContentModel,
  ResolvedContentModel,
} from "../content-model";
export {
  canPlace,
  canPlaceIn,
  contentModelKeyOf,
  declaredSlotNames,
  placementSiteIn,
  placementTracker,
} from "../placement";
export type {
  ContentRefuser,
  PlacedNode,
  PlacementPosition,
  PlacementRefusal,
  PlacementRefused,
  PlacementSite,
  PlacementSources,
  PlacementTracker,
  PlacementVerdict,
  TrackedPlacement,
} from "../placement";
export { placementBreaksIn, placementRefusal } from "../placement-breaks";
// What a write may store as a placement's own values: ids its component
// exposes, with values of the type each field takes. Judged by the write path
// against the definitions it composes with, and by the inspector before a
// commit.
export {
  exposedValueFits,
  neededFor,
  placementValueIssues,
} from "../placement-values";
export type {
  PlacementValueIssue,
  PlacementValueProblem,
} from "../placement-values";
export type { LocatedPlacementBreak } from "../placement-breaks";
export {
  asPermittedList,
  blockLabelFrom,
  permittedLabel,
  placementRefusalMessage,
  placementRefusalWording,
} from "../placement-wording";
export type { PlacementWording, WordingContext } from "../placement-wording";
// What a composed document breaks that no stored document breaks alone: the
// nesting rule across a placement, and depth counted from the document's own
// root. Exported for the write path, which has to refuse what the renderer
// would otherwise cut short or draw where the rule forbids it.
export { compositionFaults } from "../composition-faults";
export type {
  ComposedLockBreak,
  CompositionFault,
  CompositionFaultCode,
  CompositionFaultOptions,
} from "../composition-faults";
// A component's exposed fields that drive something a `contentOnly` lock
// holds. Exported for the component's own save, which refuses a new one so a
// designer meets the lock where the exposure is made, not on every page.
export { contentOnlyExposures, nodeLocks } from "../content-only-exposures";
export type { LockedExposure, NodeLock } from "../content-only-exposures";
// Editing an existing component's exposed fields, for its own view: expose,
// rename, point elsewhere, remove. And the one rule for taking a removed
// field's values out of every document that places the component. Both
// `@experimental` until the component editor that consumes them ships.
export {
  exposureTypeForProp,
  planExposeProperty,
  planRemoveExposedSlot,
  planRemoveExposure,
  planRenameExposure,
  planRetargetExposure,
  VISIBILITY_PROP_PATH,
} from "../exposure-planners";
export type {
  ExposeRequest,
  ExposureEdit,
  ExposureEditProblem,
  ExposureEditRefusal,
  ExposureEditResult,
  ExposureSources,
  ExposureTarget,
  PrunedVariant,
} from "../exposure-planners";
// Defining, renaming and deleting a component's variants, and the values each
// presets, as the designer does in the component's own view. A variant's key
// is its stable id; its name is unique per component. `@experimental` until the
// component editor that uses them ships.
export {
  planAddVariant,
  planDeleteVariant,
  planRenameVariant,
  planResetVariantValue,
  planSetVariantValue,
  variantOptions,
} from "../variant-planners";
export type {
  NewVariantSources,
  VariantEdit,
  VariantEditProblem,
  VariantEditRefusal,
  VariantEditResult,
  VariantOption,
} from "../variant-planners";
export { variantLabelKey } from "../variant-labels";
// A placement's variant key, judged against its component on every write: a
// key the write newly sets must name one of the component's variants.
export { placementVariantIssues } from "../placement-variants";
export type { PlacementVariantIssue } from "../placement-variants";
export { stripRetiredExposures } from "../retired-exposures";
export type {
  RetiredByComponent,
  RetiredExposures,
  StrippedDocument,
} from "../retired-exposures";
// The lock judgement as the editor asks it before an action: every break a
// document holds, located, and the one an edit would add, by the rules a save
// applies. And the one repair planner, run as a list of rules so a later rule
// extends the repair rather than building a second one. `@experimental` until
// the editor that consumes them ships.
export { lockBreaksIn, lockRefusal } from "../lock-breaks";
export type { LocatedLockBreak, LockSources } from "../lock-breaks";
// Turning every copy of a component in one document into plain blocks, and
// asking whether a document still references it, for deleting a component that
// is in use. `@experimental` until the delete that consumes them ships.
export { inlineComponentInstances, stillReferences } from "../component-inline";
export type {
  InlinedDocument,
  InlineProblem,
  InlineRefusal,
  InlineResult,
  ReferenceAnswer,
} from "../component-inline";
export { lockRepairRule, planRepair } from "../repair-plan";
// The placement rule's repair, appended after the lock rule when planning, so
// a page holding blocks where the placement rule refuses them is offered a
// move to the nearest place it allows.
export { placementRepairRule } from "../placement-repair";
export type {
  RepairContext,
  RepairPlan,
  RepairRule,
  RepairStep,
  SlotPlace,
} from "../repair-plan";
// What a lock lets change, for an editor that shows a block's settings
// read-only inside `contentOnly`: the lock a slot passes down, and the props
// a block declares as content.
export { contentPropsOf, slotLockOf } from "../slot-lock";
export type { ActiveSlotLock } from "../slot-lock";
// The measurement's return type travels with the function. Without it a
// consumer naming `measureBytes`'s result has to rebuild the union by hand or
// reach for `ReturnType`, and a hand-rebuilt copy is the second statement of a
// contract that then drifts from the first.
export type { ByteMeasurement } from "../measure-bytes";
