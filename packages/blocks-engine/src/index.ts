/**
 * @nextlyhq/blocks-engine — the runtime-free core of the Nextly page builder.
 *
 * This package owns the stored document format and the pure operations over
 * it. It never imports React or Nextly at runtime, so documents can be
 * created, inspected, and transformed from any JavaScript environment.
 */
export { deriveSeoFromDocument } from "./derive-seo";
export type { SeoDefinitionSource, SeoImageCandidate } from "./derive-seo";

export {
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
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
  DocumentSettings,
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
} from "./limits";
export type { DocumentLimits } from "./limits";
export type { DocumentSurvey, SurveyLimits } from "./measure-bytes";

export {
  newId,
  makeNode,
  expandSlotDefaults,
  walkNodes,
  findNode,
  locateNode,
  insertNode,
  removeNode,
  moveNode,
  reidSubtree,
  reidSubtreeWithMap,
  // The one rule for what a copied DOM id becomes. Public because two copiers
  // apply it — pattern insert and component composition — and a page may hold
  // the output of both, so a second spelling would put two ids on one target.
  mintDomId,
  // And the other half of it: an id that MOVED leaves every reference to it
  // pointing at nothing, and `aria-labelledby` resolving to nothing is an
  // element losing its accessible name in silence. Published as data and as a
  // function, because a surface that copies nodes without going through these
  // helpers still has to know which attributes carry an id.
  ID_REFERENCE_ATTRIBUTES,
  remapIdReferences,
  duplicateNode,
  updateNode,
} from "./tree";
export type {
  NodeLocation,
  ReidentifiedSubtree,
  SlotDefaultSource,
  TreePosition,
} from "./tree";

// The node selection every reader of a stored document shares. Public because
// the page-builder plugin's class-usage record has to stop exactly where the
// style compiler stops: a class applied to a node the compiler styled but the
// counter never reached is absent from the record a safe-delete check reads,
// and absence there is indistinguishable from "not used".
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
export {
  componentIdsIn,
  resolveComponentInstances,
  // Why an instance was left standing. Published because the surfaces that
  // REPORT one are in other packages — the renderer draws a placeholder, the
  // editor offers a remedy — and each remedy differs by reason. A consumer
  // restating the list agrees on the day it is written and silently stops
  // handling whichever reason is added next.
  COMPONENT_UNRESOLVED_REASONS,
} from "./resolve-instances";
export type {
  ComponentUnresolvedReason,
  DefinitionsById,
  ResolveComponentOptions,
  ResolvedBlockNode,
  ResolvedComposition,
  ResolvedDocument,
  UnresolvedInstance,
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
export type { NestingSource, NestingVerdict, NestingRefusal } from "./nesting";
// The measurement's return type travels with the function. Without it a
// consumer naming `measureBytes`'s result has to rebuild the union by hand or
// reach for `ReturnType`, and a hand-rebuilt copy is the second statement of a
// contract that then drifts from the first.
export type { ByteMeasurement } from "./measure-bytes";
export {
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
/**
 * Exported because the renderer and every plain-text projection of a document
 * must agree on what counts as authored text. They did not: a stored number was
 * drawn as text on the page and skipped in the description derived from it.
 * A caller writing its own `typeof x === "string"` reintroduces exactly that
 * split, so the decision is published rather than restated.
 */
export { authoredText, isAuthoredText } from "./authored-text";
export { declaresNoMarkup, isConditionGated } from "./visibility";
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

export { BLOCK_ICONS, defineBlock } from "./block";
export type {
  AnyBlockDefinition,
  BlockDefinition,
  BlockEditorMeta,
  BlockIcon,
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
// Interop and judgement, both pure: the format other design-token tools read,
// and the contrast a person needs while a colour picker is open.
export {
  NEXTLY_EXTENSION,
  dtcgToTokens,
  isKind,
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
  NODE_CLASS_PREFIX,
  PAGE_ROOT_CLASS,
  PAGE_ROOT_SELECTOR,
} from "./style/node-class";
export {
  compileStyleValues,
  tokenCustomProperty,
  DEFAULT_TOKEN_PREFIX,
  // The prefix tokens are actually written under, which is not the one that was
  // stored: unset, malformed and reserved prefixes all resolve to the default.
  // Exported so a reader keyed on the emitted custom-property names asks this
  // rather than the setting, which changes without the output changing.
  safeTokenPrefix,
} from "./style/declarations";
export type { CompiledDeclarations, Declaration } from "./style/declarations";
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
  isUsableNamedClass,
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
  NAMED_CLASS_PREFIX,
  NAMED_CLASS_SLUG_RE,
} from "./style/named-class";
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
