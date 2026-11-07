/**
 * @nextlyhq/blocks-engine — the runtime-free core of the Nextly page builder.
 *
 * This package owns the stored document format and the pure operations over
 * it. It never imports React or Nextly at runtime, so documents can be
 * created, inspected, and transformed from any JavaScript environment.
 */
export { deriveSeoFromDocument } from "./derive-seo";
// A document's own metadata, its bound segments filled by the page's binding
// pass: what a collection template gives each entry's page.
export { resolveDocumentSeo } from "./document-seo";
export type { ResolvedDocumentSeo } from "./document-seo";
// Which Layout a page is drawn inside: the one rule the render, the editor
// and the tests share.
export { resolvePageLayout } from "./resolve-layout";
export type {
  LayoutResolution,
  LayoutSite,
  PageLayoutChoice,
} from "./resolve-layout";
// The regions a Layout fills around a page, and the document each is drawn
// from: one reading of a stored Layout, shared by the route, the editor and
// the plugin.
export {
  layoutRelationId,
  regionDocument,
  regionsOf,
  REGION_AREAS,
} from "./layout-regions";
export type { LayoutRegion, RegionArea } from "./layout-regions";
export type { SeoDefinitionSource, SeoImageCandidate } from "./derive-seo";

export {
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  MAX_SEO_SEGMENTS,
  MAX_SEO_TEXT_LENGTH,
  BINDING_SOURCES,
  BINDING_FORMAT_TYPES,
  DEFAULT_BINDING_SOURCE,
  COMPONENT_INSTANCE_TYPE,
  // The component-definition contract, published so the stores and the admin
  // DERIVE the vocabulary rather than restating it. A schema branch or a
  // picker that listed these values itself would agree on the day it was
  // written and accept a type this engine refuses the day one is added.
  EXPOSED_PROPERTY_TYPES,
  STYLE_STATES,
  MAX_BREAKPOINTS_PER_AXIS,
  // Public for exactly the reason the per-axis cap is. A definition whose id is
  // longer than this is DROPPED by `breakpointContexts`, so a store that
  // accepted one would satisfy the published `BreakpointDef` type and then lose
  // every style keyed to that id, reported only as an unknown breakpoint. A
  // writer cannot honour a rule it cannot read, and a copy of the number in
  // another package is a second statement that goes stale silently.
  MAX_BREAKPOINT_ID_LENGTH,
  // Public alongside the per-axis cap: a store validating a class library on
  // write must refuse what the compiler will not read, and a copy of this
  // number in another package is a second statement that goes stale silently.
  MAX_NAMED_CLASSES,
  // The per-node cap, public for the same reason and with a sharper use: it is
  // how many of a node's classes the compiler APPLIES, so a reader asking which
  // classes a document actually references has to stop where the compiler does.
  // Reading further reports a reference the page does not render.
  MAX_CLASSES_PER_NODE,
  isTokenRef,
  isBindingSource,
  isBlockType,
  MAX_BLOCK_TYPE_LENGTH,
  // Published on the argument its own docblock makes: it is the ONE answer to
  // whether a value names a part, for the same reason `isBlockType` above is.
  // A caller outside this package that bounds a part name where the compiler
  // does not emits a class the compiler refuses to read.
  isPartName,
  isComponentDocument,
  isComponentInstance,
  isUnsetOverride,
} from "./document";
export type {
  BlockDocument,
  BlockNode,
  BlockPart,
  Binding,
  BindingSource,
  BindingFormat,
  BindingFormatType,
  BreakpointDef,
  BreakpointId,
  BreakpointSet,
  ComponentDocument,
  ComponentInstanceProps,
  ExposedProperty,
  ExposedPropertyType,
  ExposedSlot,
  OverrideUnset,
  OverrideValue,
  Variant,
  Condition,
  DocumentFormatVersion,
  DocumentKind,
  BlockOrigin,
  DocumentSeo,
  DocumentSettings,
  SeoBinding,
  SeoTextSegment,
  LocaleOverlay,
  LocaleOverlayValue,
  NodeStyles,
  NodeVisibility,
  StyleState,
  StyleValue,
  StyleValues,
  TokenRef,
} from "./document";

export {
  // The cap on one collection of a component's envelope — its exposed
  // properties, its slots, its variants, one variant's overrides. Published
  // because a store or an admin form validating an envelope before it reaches
  // the engine has to refuse at the same number: a form that accepted more
  // than this would offer an author a definition the write path then rejects.
  MAX_ENVELOPE_ENTRIES,
  MAX_DEPTH,
  MAX_NODES,
  // The nesting cap the resolver enforces. Public alongside `MAX_DEPTH`
  // because it bounds a different thing — how many levels of COMPOSITION a
  // page may reach, not how deep one stored tree nests — and an editor that
  // refuses to place an instance has to refuse at the same number the render
  // does, or it offers a placement that then draws a placeholder.
  MAX_COMPOSED_DEPTH,
  DEFAULT_MAX_DOCUMENT_BYTES,
  LIMIT_WARNING_RATIO,
  DEFAULT_SLOT,
  DEFAULT_LIMITS,
  countNodes,
  treeDepth,
  documentBytes,
  // Published because the three readers above now REFUSE a structure they
  // cannot afford to walk, and a caller that wants to report that rather than
  // let it escape has to be able to name it and to say what it exceeded.
  //
  // ONE ceiling, which is the point: the op layer's preflight already refused a
  // value with more parts than this, so a second number here would let a dry run
  // accept what the apply then refuses.
  MAX_VALUE_PARTS,
  MAX_SERIALIZED_VALUES,
  ForestTooLargeError,
} from "./limits";
export type { DocumentLimits } from "./limits";
export type { DocumentSurvey, SurveyLimits } from "./measure-bytes";

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
} from "./tree";
export type {
  NodeLocation,
  ReidentifiedForest,
  SlotDefaultSource,
  TreePosition,
  // Beside `walkNodes`, because a caller BOUNDING a walk has to hold its
  // options in a variable to build one — and the option that says the budget
  // ran out is useless to anyone who cannot name the type carrying it.
  WalkOptions,
} from "./tree";

// The one rule for which prop of a copied node holds a link, and what happens
// to it. Published because the module claims to be the single source for every
// copying surface, and a rule a consumer cannot import is a rule they will
// write again — which is exactly how the fragment remap came to exist twice.
export {
  FRAGMENT_REFERENCE_PROPS,
  remapFragmentBindings,
  remapFragmentProps,
} from "./fragment-refs";

// Whether a selection is one run of siblings. Published because the editor and
// every composition planner must agree on it, and they cannot share a
// builder-side copy: a planner runs inside a plugin's server action, where the
// builder — which peer-depends on React — has no business being imported.
export { contiguousRun, siblingRun } from "./sibling-run";
export type {
  RunPlace,
  RunProblem,
  SiblingRun,
  SiblingRunResult,
} from "./sibling-run";

// The composition planners: pure functions from a selection to the row to
// create and the ops the page needs. Split from the doing so the caller can put
// both writes in one unit of work and roll the create back — and so the dry run
// and the real run are the same function rather than two that agree for now.
export { patternDigest } from "./pattern-digest";
export {
  planConvertToComponent,
  planDetach,
  planDuplicateComponent,
  planInsertPattern,
  internalNestingVerdict,
  patternRefusal,
  saveAsPatternRefusal,
  planSaveAsComponent,
  planSaveAsPattern,
  planUpdatePatternFromSelection,
} from "./composition-planners";
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
} from "./composition-planners";

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
} from "./document";
export type { OriginReading, PatternRenameRecord } from "./document";
// The one rule for which DOM id a node actually renders. A node can spell one
// two ways and emits at most one, so anything asking "what ids are on this
// page" — a planner steering an insert around collisions, a duplicate check —
// has to ask this rather than read the two fields independently.
export { isPatternDocument } from "./document";
export { renderedDomId, renderedDomIdIn } from "./document";

export { selectNodes } from "./select-nodes";
export type {
  NodeSelection,
  SelectedNode,
  SelectionStop,
} from "./select-nodes";

export { measureBytes, surveyDocument } from "./measure-bytes";
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
} from "./component-graph";

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
} from "./resolve-instances";
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
} from "./resolve-instances";
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
export { canNest, canBeRoot, canNestInSlot } from "./nesting";
export { placementVerdict } from "./nesting";
export type { NestingSource, NestingVerdict, NestingRefusal } from "./nesting";
// The one placement rule over the nesting rule above: declared slots, the
// HTML content model a block's settings give it, and component placements'
// exposed slots. Every placement path asks it, editor and server alike, and
// one wording says its refusals in both.
export {
  CONTENT_KINDS,
  UNDECLARED_CONTENT_MODEL,
  contentModelKey,
  resolveContentModel,
} from "./content-model";
export type {
  ContentKind,
  ContentModel,
  ResolvedContentModel,
} from "./content-model";
export {
  canPlace,
  canPlaceIn,
  contentModelKeyOf,
  declaredSlotNames,
  placementSiteIn,
  placementTracker,
} from "./placement";
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
} from "./placement";
export { placementBreaksIn, placementRefusal } from "./placement-breaks";
// What a write may store as a placement's own values: ids its component
// exposes, with values of the type each field takes. Judged by the write path
// against the definitions it composes with, and by the inspector before a
// commit.
export {
  exposedValueFits,
  neededFor,
  placementValueIssues,
} from "./placement-values";
export type {
  PlacementValueIssue,
  PlacementValueProblem,
} from "./placement-values";
export type { LocatedPlacementBreak } from "./placement-breaks";
export {
  asPermittedList,
  blockLabelFrom,
  permittedLabel,
  placementRefusalMessage,
  placementRefusalWording,
} from "./placement-wording";
export type { PlacementWording, WordingContext } from "./placement-wording";
// What a composed document breaks that no stored document breaks alone: the
// nesting rule across a placement, and depth counted from the document's own
// root. Exported for the write path, which has to refuse what the renderer
// would otherwise cut short or draw where the rule forbids it.
export { compositionFaults } from "./composition-faults";
export type {
  ComposedLockBreak,
  CompositionFault,
  CompositionFaultCode,
  CompositionFaultOptions,
} from "./composition-faults";
// A component's exposed fields that drive something a `contentOnly` lock
// holds. Exported for the component's own save, which refuses a new one so a
// designer meets the lock where the exposure is made, not on every page.
export { contentOnlyExposures, nodeLocks } from "./content-only-exposures";
export type { LockedExposure, NodeLock } from "./content-only-exposures";
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
} from "./exposure-planners";
export type {
  ExposeRequest,
  ExposureEdit,
  ExposureEditProblem,
  ExposureEditRefusal,
  ExposureEditResult,
  ExposureSources,
  ExposureTarget,
  PrunedVariant,
} from "./exposure-planners";
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
} from "./variant-planners";
export type {
  NewVariantSources,
  VariantEdit,
  VariantEditProblem,
  VariantEditRefusal,
  VariantEditResult,
  VariantOption,
} from "./variant-planners";
export { variantLabelKey } from "./variant-labels";
// A placement's variant key, judged against its component on every write: a
// key the write newly sets must name one of the component's variants.
export { placementVariantIssues } from "./placement-variants";
export type { PlacementVariantIssue } from "./placement-variants";
export { stripRetiredExposures } from "./retired-exposures";
export type {
  RetiredByComponent,
  RetiredExposures,
  StrippedDocument,
} from "./retired-exposures";
// The lock judgement as the editor asks it before an action: every break a
// document holds, located, and the one an edit would add, by the rules a save
// applies. And the one repair planner, run as a list of rules so a later rule
// extends the repair rather than building a second one. `@experimental` until
// the editor that consumes them ships.
export { lockBreaksIn, lockRefusal } from "./lock-breaks";
export type { LocatedLockBreak, LockSources } from "./lock-breaks";
// Turning every copy of a component in one document into plain blocks, and
// asking whether a document still references it, for deleting a component that
// is in use. `@experimental` until the delete that consumes them ships.
export { inlineComponentInstances, stillReferences } from "./component-inline";
export type {
  InlinedDocument,
  InlineProblem,
  InlineRefusal,
  InlineResult,
  ReferenceAnswer,
} from "./component-inline";
export { lockRepairRule, planRepair } from "./repair-plan";
// The placement rule's repair, appended after the lock rule when planning, so
// a page holding blocks where the placement rule refuses them is offered a
// move to the nearest place it allows.
export { placementRepairRule } from "./placement-repair";
export type {
  RepairContext,
  RepairPlan,
  RepairRule,
  RepairStep,
  SlotPlace,
} from "./repair-plan";
// What a lock lets change, for an editor that shows a block's settings
// read-only inside `contentOnly`: the lock a slot passes down, and the props
// a block declares as content.
export { contentPropsOf, slotLockOf } from "./slot-lock";
export type { ActiveSlotLock } from "./slot-lock";
// The measurement's return type travels with the function. Without it a
// consumer naming `measureBytes`'s result has to rebuild the union by hand or
// reach for `ReturnType`, and a hand-rebuilt copy is the second statement of a
// contract that then drifts from the first.
export type { ByteMeasurement } from "./measure-bytes";
export {
  componentEnvelopeIssues,
  isErrorIssue,
  validate,
  validateDocument,
  ISSUE_CODES,
  DOCUMENT_VERDICT_CODES,
  INCOMPLETE_SURVEY_CODES,
} from "./validation";
/**
 * The registry-independent facts about a node, exported so a caller holding no
 * block registry can still refuse a malformed one. The editor's op layer is the
 * caller that needs them: it must reject a bad node before the tree primitives
 * place it, and `validate()` requires a context a tree operation has no business
 * demanding.
 */
export { isNodeType, isNodeVersion } from "./validation";
/**
 * Exported because anything holding a document read from storage has to ask the
 * same question, and the answer is subtler than it looks: the check is on the
 * PROTOTYPE, so a `Date`, a `Map` or a class instance is refused rather than
 * walked and reported clean. A caller writing its own `typeof x === "object"`
 * gets a different answer for exactly the values that survive JSON badly.
 */
export { isPlainRecord } from "./plain-record";
// One style envelope laid over another, property by property: what Detach
// leaves on a block, and a block type's base with the site's edits over it.
// `@experimental` with the own-look helpers above.
export { overlaidStyles } from "./style/overlaid-styles";
/**
 * Exported because the renderer and every plain-text projection of a document
 * must agree on what counts as authored text. They did not: a stored number was
 * drawn as text on the page and skipped in the description derived from it.
 * A caller writing its own `typeof x === "string"` reintroduces exactly that
 * split, so the decision is published rather than restated.
 */
export { authoredText, isAuthoredText } from "./authored-text";
export {
  declaresNoMarkup,
  isConditionGated,
  storedVisibilityOf,
} from "./visibility";
// Per-device visibility as an author works with it: each device's resolved
// state, a hide that stays on one device, and the stored values carried across
// a change of the site's breakpoints. Public because the editor writes the eye
// and the breakpoint flows rewrite documents, and both must resolve devices as
// the compiler does.
export {
  carryDeviceVisibility,
  carryDocumentDeviceVisibility,
  deviceVisibility,
  hiddenOnDevice,
  revealDeviceHidden,
  setDeviceVisibility,
} from "./device-visibility";
export type { CarriedVisibility, DeviceVisibility } from "./device-visibility";
export type { NoMarkupDefinitionSource } from "./visibility";
export type {
  BlockTypeLookup,
  ClassLookup,
  IssueCode,
  ValidationResult,
  IssueSeverity,
  TokenLookup,
  ValidationContext,
  ValidationIssue,
  ValidationMode,
} from "./validation";

export {
  BLOCK_ICONS,
  defineBlock,
  ITEM_SCHEMA_MAX_DEPTH,
  // What a select's option is called. Public because the builder names a
  // choice with it as the engine's exposure planner does.
  optionLabel,
} from "./block";
export type {
  AnyBlockDefinition,
  BlockDefinition,
  BlockEditorMeta,
  BlockIcon,
  BlockInspectorProps,
  BlockIsland,
  BlockExample,
  BlockSeoContribution,
  BlockSeoImage,
  BlockRenderArgs,
  BlockRenderResult,
  BlockSupports,
  BlockSupportValue,
  BlockVariation,
  ComponentPath,
  InferBlockProps,
  PropSchema,
  SlotLock,
  SlotSpec,
} from "./block";

export {
  registerBlocks,
  registerSupport,
  getBlock,
  isBlockName,
  isUsableSlotName,
  hasBlock,
  allBlocks,
  getBlockSource,
  getSupport,
  allSupports,
  clearBlocks,
  MAX_BLOCK_VERSION,
  registryBlockSource,
  registryLookup,
  registryMigrationSource,
  registryNestingSource,
} from "./registry";
export type { RegisterOptions, SupportDefinition } from "./registry";

export {
  STYLE_CATALOG,
  getStyleProperty,
  stylePropertiesInGroup,
  styleFlagsInGroup,
} from "./style/catalog";
export {
  STYLE_GROUPS,
  STYLE_GROUP_DEFS,
  TOKEN_KINDS,
  isStyleLeaf,
  shapeLeaves,
} from "./style/catalog-types";
export type {
  ColorLeaf,
  CssValueLeaf,
  DimensionLeaf,
  KeywordExpansion,
  KeywordLeaf,
  LogicalCornersShape,
  LogicalSidesShape,
  NumberLeaf,
  ObjectShape,
  StyleGroup,
  StyleGroupDef,
  StyleLeaf,
  StyleProperty,
  StyleShape,
  TokenKind,
  UnionShape,
  UrlLeaf,
} from "./style/catalog-types";
export {
  checkColorValue,
  checkCssValue,
  checkDimensionValue,
  checkUrlValue,
  // Whether a word is one of the keywords legal on every property, which
  // stands only alone: a shorthand's editor needs it to refuse `underline
  // inherit`, a value the browser discards whole.
  isCssWideKeyword,
  // How CSS reads an identifier that carries escapes. Public for the same
  // reason as the namespacing rule: anything deciding what a name IS has to
  // decode it the same way, or `font\2d family` reads as a different property
  // here than it does in a browser.
  decodeIdentifier,
  referencesCustomProperty,
  // The other direction, public for the same reason. A caller that decoded a
  // name to compare it has to escape it again before writing it back, or a name
  // holding a space or a quote is emitted as tokens the parser reads apart.
  escapeIdentifier,
  // ASCII-only case folding, which is what CSS applies to keywords. JavaScript's
  // `toLowerCase` folds more than that: U+212A KELVIN SIGN becomes "k", so
  // `@\u212Aeyframes` reads as `@keyframes` to a check using it and as an unknown
  // at-rule to a browser. Public because every surface deciding what a keyword
  // IS has to fold it the same way.
  asciiLower,
  // What CSS discards around a value, which is NOT what `String.trim` discards:
  // JavaScript strips NBSP and the Unicode spaces and CSS does not, so an editor
  // trimming with the language's own function normalises spellings the engine
  // then refuses — or worse, converts one into a value it accepts.
  trimCssWhitespace,
  // The longest style value the compiler reads: anything past it is refused
  // before parsing, so a writer honours it and a reader keyed on what the sheet
  // contains stops reading where the compiler does.
  MAX_VALUE_LENGTH,
} from "./style/css-value";
export type { CssValueRejection, MayFetchUrl } from "./style/css-value";
export type { StyleValueOptions } from "./style/validate-style-value";
export {
  validateStyleValues,
  leafAcceptsValue,
  newStyleIssueBudget,
  MAX_STYLE_ISSUES,
  MAX_STYLE_ISSUE_PATH_BYTES,
  MAX_SITE_ISSUES,
  MAX_SITE_ISSUE_PATH_BYTES,
  MAX_SITE_LOOKUPS,
  tokenKindAllowedAt,
  tokenKindsForProperty,
  // Which arm of a union a stored value belongs to. Public because more than one
  // surface asks it: validation picks the arm it judges a value against, and an
  // editor picks the control to draw for it. A second answer drifts silently,
  // because both surfaces look right on their own — the disagreement is visible
  // only to an author holding a control for one arm while reading an error
  // written about another.
  //
  // `style/declarations.ts` still selects an arm its OWN way while emitting, by
  // taking the first that writes bytes. Measured, the two already disagree:
  // `fontWeight: 700` resolves here to the number arm and emits through the
  // keyword one, because `scalarText` reads no leaf kind. Nothing is visibly
  // wrong today only because both arms write `font-weight`.
  styleUnionVariant,
} from "./style/validate-style-value";
export type {
  StyleIssueBudget,
  StyleUnionVariantOptions,
} from "./style/validate-style-value";
export {
  compilePageCss,
  BASE_BREAKPOINT,
  // The width past which a stored record is not read. Exported for the same
  // reason as the breakpoints below: a reader keyed on what compilation emits
  // must stop reading where compilation stops, and a second constant would
  // drift from the one that decides the output.
  MAX_SCANNED_KEYS,
  // The normalised breakpoints, for a reader keyed on what the compiler emits
  // rather than on what was stored. Exported rather than restated because a
  // second copy of the dropping, sorting and capping rules would drift from the
  // one that decides the output, and would drift silently in both directions.
  breakpointContexts,
} from "./style/compile-page";
export type { BreakpointContext } from "./style/compile-page";
// The one rule for how a document-global CSS name wears its scope. Public
// because more than one place has to produce it and they must agree exactly:
// the compiler namespaces the names it emits, the custom-CSS sanitizer
// namespaces the names an author writes, and `findUnnamespacedGlobals` checks
// the result. Two spellings of "namespaced" would make that check pass on
// output the browser still resolves globally.
export {
  findUnnamespacedGlobals,
  namespacedGlobalName,
} from "./style/isolation";
// Site tokens and self-hosted fonts: the table a token name resolves in, and
// the faces a site serves. Public because the admin's tokens studio and the
// site-sheet compiler both build on these types.
export {
  DARK_MODE_ATTRIBUTE,
  TOKEN_MODES,
  defaultSiteTokens,
  resolveSiteTokens,
  cssString,
  emitFontFaces,
  emitTokenBlocks,
  isAuthorableTokenName,
  isTokenName,
  tokenNamingProblem,
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKEN_NAME_SEGMENTS,
  MAX_TOKEN_PREFIX_LENGTH,
  // A variable's plain name: the optional label, its check, and the label
  // derived from the code name when none is stored.
  MAX_TOKEN_LABEL_LENGTH,
  tokenDisplayLabel,
  tokenLabelIssue,
  // Both halves of token identity, public for the same reason the types are:
  // an editor that offers rename has to pin the identity the way this package
  // pins it, and one that cannot reach these has no way to do that except to
  // reimplement the rule or to write `name` directly — which moves the custom
  // property every compiled page references, silently.
  renameSiteToken,
  tokenIdentity,
  resolveTokenPrefix,
  validateFontFace,
} from "./style/site-tokens";
export type {
  DarkModeStrategy,
  FontFaceDef,
  FontSource,
  SiteToken,
  SiteTokenSet,
  TokenMode,
} from "./style/site-tokens";
// Light and dark across files: the DTCG theme (resolver) file, and one file
// per mode as Figma imports and exports variables.
export {
  RESOLVER_VERSION,
  modeFilesToTokens,
  resolverToTokens,
  tokensToFigma,
  tokensToResolver,
} from "./style/dtcg-modes";
export type { ModeFile } from "./style/dtcg-modes";
// Whether two tokens say the same thing: one answer for a stored override and
// for an editor's Reset.
export { sameJsonValue, sameSiteToken } from "./style/same-token";
// A colour written as a value rather than through a variable, which the
// inspector marks as not adapted to dark mode.
export { isRawColour } from "./style/raw-colour";
// Interop and judgement, both pure: the format other design-token tools read,
// and the contrast a person needs while a colour picker is open.
export {
  GENERIC_FONT_FAMILIES,
  NEXTLY_EXTENSION,
  dtcgToTokens,
  isKind,
  resolveAliases,
  tokensToDtcg,
  familyPartKind,
  readFamilyList,
  splitFamilyList,
} from "./style/dtcg";
export type {
  DtcgNode,
  FamilyListKind,
  FamilyListReading,
  FamilyPart,
  FamilyPartKind,
  ReadFamilyPart,
} from "./style/dtcg";
export {
  checkContrast,
  compositeOver,
  contrastRatio,
  parseColor,
  relativeLuminance,
} from "./style/contrast";
export type { ContrastLevel, ContrastResult, Rgb } from "./style/contrast";
// The one CSS-colour policy. Both surfaces that put a stored colour on a page
// read it from here: the React renderer, which may not import the CMS, and the
// CMS's own serializer, which lives where the renderer cannot reach.
export {
  cssColor,
  hasCssInjection,
  normalizeCssValue,
} from "./style/css-color";
// One reading of a rich-text inline style. The CMS serializer, the React
// renderer and the versions differ all ask this module rather than each other.
export {
  formatsDrawnByStyle,
  INLINE_STYLE_PROPERTIES,
  isInlineStyleProperty,
  readInlineStyle,
  sanitizeInlineStyle,
} from "./style/inline-style";
export type {
  CompiledPageCss,
  StyleCompileContext,
} from "./style/compile-page";
export {
  blockPartClassName,
  blockTypeClassName,
  // The digest itself, for a caller naming something other than a node from an
  // id — a per-document scope class, say. Exported so that caller reaches for
  // this rather than writing a second hash, which is how the two that existed
  // before came to disagree about the width a class needs.
  hashId,
  nodeClassName,
  nodeClassNames,
  BLOCK_TYPE_CLASS_PREFIX,
  // The opt-in a container wears to take the site's content width. Public
  // because two packages meet on it: the renderer puts it on an element and
  // this engine's site stylesheet writes the rule that matches. A selector in
  // one and a literal in the other would be one contract with two spellings,
  // and the half that drifted would simply stop matching rather than fail.
  CONTENT_WIDTH_CLASS,
  // The marker a container spacing its children wears: the compiler keys the
  // gap's rules on it, a block repeating its slot puts it on each wrapper, and
  // an editor takes it off to ask whether a margin is the gap.
  CHILD_GAP_CLASS,
  // What an Accordion section marks as its icon and its title, for the
  // Accordion's icon choices to reach.
  DISCLOSURE_ICON_CLASS,
  DISCLOSURE_TITLE_CLASS,
  NODE_CLASS_PREFIX,
  PAGE_ROOT_CLASS,
  PAGE_ROOT_SELECTOR,
} from "./style/node-class";
export {
  compileStyleValues,
  scaledTokenText,
  tokenCustomProperty,
  DEFAULT_TOKEN_PREFIX,
  // The prefix tokens are actually written under, which is not the one that was
  // stored: unset, malformed and reserved prefixes all resolve to the default.
  // Exported so a reader keyed on the emitted custom-property names asks this
  // rather than the setting, which changes without the output changing.
  safeTokenPrefix,
  paintsBackgroundImage,
} from "./style/declarations";
export type { CompiledDeclarations, Declaration } from "./style/declarations";
/**
 * A background overlay's two custom properties, for an editor drawing their
 * controls.
 *
 * @experimental
 */
export { OVERLAY_COLOR, OVERLAY_STRENGTH } from "./style/overlay";
export {
  DISCLOSURE_ICON_PROPERTY,
  DISCLOSURE_ICONS,
  DISCLOSURE_POSITION_PROPERTY,
  DISCLOSURE_POSITIONS,
} from "./style/disclosure";
export { serializeRules } from "./style/serialize";
export type { CssRule } from "./style/serialize";
export {
  styleSupportDefinitions,
  stylePropertiesForSupports,
  supportsAllowStyleProperty,
  styleGroupKeys,
} from "./style/supports-map";

export {
  migrateDocument,
  migrateProps,
  findMigrationGaps,
  nodeAtPointer,
} from "./migration";
export type {
  BlockMigrationInfo,
  MigratedNode,
  MigrateFn,
  MigrateResult,
  MigrationFailure,
  MigrationMap,
  MigrationSource,
  PropsMigrationResult,
} from "./migration";

// Named classes: reusable style presets a node applies by id.
export type { NamedClass } from "./style/named-class";
export {
  // A block type's own look, and the edits to its base a site's library holds.
  // `@experimental` (with `blockOwnLooks` and `overlaidStyles`) until the
  // editor that changes an own look ships.
  blockDefaultsOf,
  classNameOf,
  isDefaultLook,
  isLook,
  isUsableNamedClass,
  ownLooksRead,
  LOOK_CLASS_PREFIX,
  namedClassName,
  orderedNamedClasses,
  // How long a class id or slug may be before the compiler discards the class.
  // Exported so a reader that walks the same library bounds its reads where the
  // compiler bounds its own, rather than copying megabytes of a name the
  // compiler rejected by length before it looked at anything else.
  MAX_NAMED_CLASS_NAME_LENGTH,
  // Which classes a library actually RESOLVES to, ordering and claim rules
  // included. The compiler writes exactly this list and the renderer is handed
  // exactly this list, so a caller that needs to tell an author whether the
  // class they wrote will render asks this rather than modelling it: the
  // ordering is `orderIndex` then `id`, and a slug or id already claimed drops
  // the later entry, which is four separate rules to get right by hand.
  usableNamedClasses,
  usableNamedClassPositions,
  // The part of a library the compiler reads, before those rules run.
  namedClassesRead,
  NAMED_CLASS_PREFIX,
  NAMED_CLASS_SLUG_RE,
} from "./style/named-class";
/**
 * @experimental A block type's looks (its named variants: a button's Outline), as the shared
 * styles a site receives, bound to the block type and written before every other shared style.
 */
export { blockLooks, blockOwnLooks, lookClassId } from "./style/block-looks";
export type { BreakpointAxis } from "./style/breakpoint-axes";

// Where each emitted declaration came from, for an editor that has to tell an author which of
// several tiers they are looking at. Produced only when `StyleCompileContext.trace` asks for it.
// Every bound on a string the compiler can emit, as DATA rather than as prose.
// A consumer that digests these inputs must keep enough of each string to tell
// two apart whenever they compile differently, and this is the set that decides
// how much "enough" is.
export { EMITTABLE_STRING_BOUNDS } from "./style/emittable-string-bounds";
// `previewStateClass` is published because it is a CONTRACT between the
// compiler and a previewing surface: the compiler writes it into a selector
// and the surface puts it on an element. A name spelled in two places can be
// spelled differently, which is why `NODE_ID_ATTRIBUTE` is published too.
export {
  MAX_SCOPE_LENGTH,
  previewStateClass,
  statePropagatesToAncestors,
} from "./style/compile-page";
export type { EmittableStringBound } from "./style/emittable-string-bounds";
export type { StyleOrigin, StyleTraceEntry } from "./style/style-trace";
export type { StyleQuery, StyleSubject } from "./style/style-origin";

// The stylesheet every page of a site shares, compiled once and addressed by its content.
export type { SiteSheetArtifact, SiteSheetInput } from "./style/site-sheet";
export { compileSiteSheet, compileSiteTokenSheet } from "./style/site-sheet";
// A site's spacing model: whether blocks space themselves with their own
// margins (classic) or take the gap of the container holding them.
export type { SpacingMode } from "./style/spacing-mode";
export {
  DEFAULT_SPACING_MODE,
  isSpacingMode,
  SPACING_MODES,
  spacingModeOf,
} from "./style/spacing-mode";
// `outranksEntry` is published beside `styleOrigin` because that function
// cannot answer every form of the question it answers: it is asked once per
// STATE, so comparing two states' winners falls to the caller. Published, that
// caller ranks THROUGH the compiler's own weighting instead of keeping a
// second idea of what beats what — which is how the builder came to rank a
// block default's `a:hover` above a node's own `a` after the default tiers
// stopped weighing what the authored ones do.
export { outranksEntry, styleOrigin } from "./style/style-origin";
export { BREAKPOINT_AXES } from "./style/breakpoint-axes";
/*
 * What a stored breakpoint set MEANS, which the type does not say.
 *
 * Exported because more than one package now asks: the editor reads them to
 * build its dialog and its switcher, and a preview surface outside the builder
 * derives device presets from the same set. Reimplemented on either side, the
 * two would agree about what a breakpoint IS and disagree about which rows an
 * author defined and in what order they apply.
 */
export { authoredBreakpoints, inCascadeOrder } from "./style/breakpoint-set";

// Two policies about stored URLs, exported for the same reason: every surface
// that draws or describes a document must reach the same verdict about one
// stored string.
//
// The remote-host policy — `isAllowedRemoteUrl`, `isFetchableUrl`,
// `isRemoteUrl` — is about which hosts a compiled page may FETCH from, so the
// React renderer applies the same matcher the style compiler does.
//
// `isLinkableUrl` is a separate, format-level question: whether this format can
// express the destination at all. It governs whether a link is DRAWN, so a
// consumer restating it as its own scheme check makes a renderer that shows
// nothing and a projection that still reports the label describe different
// pages.
export {
  isAllowedRemoteUrl,
  isFetchableUrl,
  isLinkableUrl,
  isRemoteUrl,
  normalizeUrl,
  type RemotePattern,
  type RemotePatternInput,
} from "./url-policy";

// The operation names the format reserves for composition flows. Exported so
// an operation layer can ask rather than restate: a reservation only holds if
// the code deciding whether to accept a name reads the same list the format
// spec publishes.
export {
  RESERVED_OPERATION_NAMES,
  isReservedOperationName,
  type ReservedOperationName,
} from "./operations";

// The op vocabulary itself: the edits an editor applies, addressed by id, with
// the inverse derived before the mutation so undo is a fact rather than a
// reconstruction. Exported from the ENGINE rather than owned by the editor
// because applying an edit is not an editing-surface concern — a plugin route,
// a script or an agent has the same right to it, and each would otherwise grow
// its own vocabulary that agrees with this one only until one of them changed.
export {
  applyOp,
  applyOps,
  // Published for the planners: an insert whose subtree arrives locked is
  // refused by the op layer, so a planner has to be able to foresee it rather
  // than hand back a plan the apply throws on.
  // And the document-level rule the apply runs before it looks at the op, so a
  // plan is never built against a destination that cannot be edited at all.
  documentRefusal,
  forestRefusal,
  lockedWithin,
  // And the shape rule for what an insert will carry, for the same reason.
  nodeShapeRefusal,
  OpError,
  // The apply's own position rule, asked without applying: a planner that
  // wrote its own copy would agree until one of the two moved.
  positionRefusal,
  subtreeRemovalRefusal,
  positionOf,
  sameStoredValue,
  sameStyleValue,
  type AppliedOp,
  type AppliedOps,
  type ApplyOptions,
  type BuilderOp,
  type EnvelopeField,
  type EnvelopePatch,
  type NodePatch,
  type OpPosition,
  type SlotAddress,
} from "./ops";

// The Layers lock's rule, stated once: for one op, which the apply asks of
// every edit and an editing surface asks before offering one; and for a whole
// write, judged against the document it would replace, which a save asks
// because a write through the API carries no ops to judge.
export {
  layersLockBreak,
  lockedAncestorOf,
  type LayersLockBreak,
} from "./layers-lock";
export {
  layersLockChanges,
  type LayersLockChange,
  type LayersLockChangeKind,
} from "./layers-lock-stored";
export {
  variantLockChanges,
  type VariantDrawing,
  type VariantLockChange,
} from "./layers-lock-variants";
export {
  componentLayersLocks,
  heldBaselines,
  keptForSameComponents,
  placedLockChanges,
  placementsAsComponentsHoldThem,
  type ComponentLayersLock,
  type ComposedHeldBaseline,
  type HeldBaseline,
  type PlacedLockChange,
} from "./component-layers-locks";
// How every copy into a document keeps the Layers locks it carries.
export { insertKeepingLocks, type Placed } from "./locked-insert";

/**
 * The stored shape of rich text.
 *
 * Shared here because the CMS and the renderer both read it and may not import
 * each other — see the module for why a shared DEFINITION is the containable
 * form of that, and two readers is not.
 */
export {
  codeTokenClass,
  hasFormat,
  isRichTextNode,
  isRichTextValue,
  RICH_TEXT_PROP_TYPE,
  richTextToPlainText,
  TEXT_FORMAT,
  type RichTextNode,
  type RichTextValue,
} from "./rich-text";

/**
 * Emitting a page's breakpoints for a surface that is not the published page.
 */
export {
  MAX_PREVIEW_CONTAINER_LENGTH,
  PREVIEW_VIEWPORT_CONTAINER,
  UNPREVIEWABLE_CONTAINER,
  previewContainerFor,
  previewContainerName,
  type BreakpointContextOptions,
} from "./style/compile-page";
// Last, so the bundle reaches the style compiler's parser before the URL
// policy's matcher, as the format entry's boundary test expects of the root.
//
// Bindings: the rules each one is checked against, the formatting of a bound
// value, and the pass that fills bound props before blocks render. One set of
// answers, shared by the renderer, the validator and the editor.
export { BINDING_ISSUE_CODES } from "./binding-issues";
export {
  BINDABLE_KINDS,
  bindablePropTypeOf,
  bindingKindOf,
  canBindFieldToProp,
  FIELD_TYPE_BINDING_KIND,
  STORAGE_PRIMITIVE_AS_FIELD_TYPE,
} from "./binding-vocabulary";
export type {
  BindablePropType,
  BindingEndpoint,
  BindingFieldType,
  BindingValueKind,
  FieldStoragePrimitive,
  StorageFieldType,
} from "./binding-vocabulary";
export type { BindingIssue, BindingIssueCode } from "./binding-issues";
export {
  bindablePropKind,
  checkBinding,
  fieldFitsProp,
  isBindPath,
  isEmptyBoundValue,
  isValidPropValue,
} from "./binding-rules";
export type {
  BindablePropKind,
  BindingCheck,
  BindingCheckInput,
  BindingFieldShape,
  BindingRefs,
  BindingSchemaRef,
  BindingSchemaSource,
  CheckedBinding,
} from "./binding-rules";
// A document's bindings judged against the schema of what they read, as a
// save judges them: one rule with the renderer, a held break a warning.
export { bindingSchemaIssues } from "./binding-schema-issues";
export type { BindingSchemaJudgement } from "./binding-schema-issues";
export {
  checkFormat,
  createBindingFormatter,
  machineDate,
  safeTimeZone,
  supportedLocale,
} from "./binding-format";
export type {
  BindingFormatter,
  CheckedFormat,
  FormatCheck,
  FormatEnv,
  FormatResult,
  FormattedValue,
} from "./binding-format";
export {
  bindDocument,
  bindingDemand,
  createBindingRun,
  DEFAULT_BINDING_LOCALE,
  hasItemBindings,
  resolveNodeBindings,
} from "./resolve-bindings";
export type {
  BindingDemand,
  BindingRun,
  BindingRunInput,
  BindingScope,
  BindingSources,
  BlockPropsLookup,
  BoundDocument,
  BoundValue,
  BoundValues,
  NodeBindingResult,
  SourceDemand,
} from "./resolve-bindings";
// The bound props a visitor will not see: the page's own binding check, asked
// with the field shapes a visitor may read, for an editor to say so.
export { visitorUnreadableBindings } from "./visitor-unreadable-bindings";
export type {
  VisitorUnreadableBinding,
  VisitorUnreadableInput,
} from "./visitor-unreadable-bindings";

// A collection list's stored query: the one reading of it, shared by the
// validator, the renderer and the editor, and its save-time judgement.
export {
  COLLECTION_LIST_TYPE,
  isListDay,
  isListFilterOp,
  LIST_ENTRY_SLOT,
  listDayAfter,
  LIST_FIELD_CODES,
  LIST_FILTER_OPS,
  LIST_ISSUE_CODES,
  LIST_LIMIT_MAX,
  LIST_LIMIT_MIN,
  LIST_FIELD_KINDS,
  LIST_KIND_OPS,
  LIST_MAX_FILTERS,
  LIST_MAX_SORT_KEYS,
  LIST_MAX_SORT_LENGTH,
  LIST_MAX_VALUES,
  isListFieldKind,
  listFieldKind,
  listKindSortable,
  listPageCount,
  listQueryIssues,
  listRelationTarget,
  listSortText,
  outerListOf,
  paginatedList,
  readListQuery,
} from "./list-query";

// A block's visibility conditions: the operator vocabulary and its render
// classes, the evaluator the renderer asks, and their save-time judgement.
export {
  canonicalConditions,
  conditionDemand,
  conditionScopeIn,
  CONDITION_FIELD_CODES,
  CONDITION_ISSUE_CODES,
  CONDITION_KIND_OPS,
  CONDITION_MAX,
  CONDITION_OP_ALIASES,
  CONDITION_OPS,
  CONDITION_REGISTRY,
  conditionFieldKind,
  conditionIssues,
  conditionOp,
  evaluateConditions,
  withConditions,
} from "./visibility-conditions";
export type {
  ConditionDayStart,
  ConditionDemand,
  ConditionEvaluation,
  ConditionFieldKind,
  ConditionInput,
  ConditionIssue,
  ConditionIssueCode,
  ConditionJudgement,
  ConditionOp,
  ConditionRegistry,
  ConditionRenderClass,
  ConditionScope,
  ConditionSource,
  ConditionSubject,
} from "./visibility-conditions";
export type {
  ListFieldCode,
  ListFieldKind,
  ListFields,
  ListFieldSource,
  ListFilter,
  ListFilterOp,
  ListFilterScalar,
  ListPageCode,
  ListQuery,
  ListQueryJudgement,
  ListQueryProblem,
  ListQueryProp,
  ListRelation,
  ListShapeCode,
  ListSortKey,
  PaginatedList,
} from "./list-query";
