/**
 * @nextlyhq/blocks-engine — the runtime-free core of the Nextly page builder.
 *
 * This package owns the stored document format and the pure operations over
 * it. It never imports React or Nextly at runtime, so documents can be
 * created, inspected, and transformed from any JavaScript environment.
 */
export { deriveSeoFromDocument } from "./derive-seo";
export type { SeoDefinitionSource } from "./derive-seo";

export {
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  COMPONENT_INSTANCE_TYPE,
  STYLE_STATES,
  MAX_BREAKPOINTS_PER_AXIS,
  isTokenRef,
  isComponentInstance,
} from "./document";
export type {
  BlockDocument,
  BlockNode,
  Binding,
  BindingSource,
  BindingFormat,
  BreakpointDef,
  BreakpointId,
  BreakpointSet,
  ComponentInstanceProps,
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
  MAX_DEPTH,
  MAX_NODES,
  DEFAULT_MAX_DOCUMENT_BYTES,
  LIMIT_WARNING_RATIO,
  DEFAULT_SLOT,
  DEFAULT_LIMITS,
  countNodes,
  treeDepth,
  documentBytes,
} from "./limits";
export type { DocumentLimits } from "./limits";

export {
  newId,
  makeNode,
  walkNodes,
  findNode,
  locateNode,
  insertNode,
  removeNode,
  moveNode,
  reidSubtree,
  duplicateNode,
  updateNode,
} from "./tree";
export type { NodeLocation, TreePosition } from "./tree";

export { validate, ISSUE_CODES } from "./validation";
export { isConditionGated } from "./visibility";
export type {
  BlockTypeLookup,
  ClassLookup,
  IssueCode,
  IssueSeverity,
  TokenLookup,
  ValidationContext,
  ValidationIssue,
  ValidationMode,
} from "./validation";

export { defineBlock } from "./block";
export type {
  AnyBlockDefinition,
  BlockDefinition,
  BlockEditorMeta,
  BlockExample,
  BlockSeoContribution,
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
  hasBlock,
  allBlocks,
  getBlockSource,
  getSupport,
  allSupports,
  clearBlocks,
  MAX_BLOCK_VERSION,
  registryLookup,
  registryMigrationSource,
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
} from "./style/css-value";
export type { CssValueRejection } from "./style/css-value";
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
} from "./style/validate-style-value";
export type { StyleIssueBudget } from "./style/validate-style-value";
export { compilePageCss, BASE_BREAKPOINT } from "./style/compile-page";
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
  emitFontFaces,
  emitTokenBlocks,
  isTokenName,
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
export { NEXTLY_EXTENSION, dtcgToTokens, tokensToDtcg } from "./style/dtcg";
export type { DtcgNode } from "./style/dtcg";
export {
  checkContrast,
  compositeOver,
  contrastRatio,
  parseColor,
  relativeLuminance,
} from "./style/contrast";
export type { ContrastLevel, ContrastResult, Rgb } from "./style/contrast";
export type {
  CompiledPageCss,
  StyleCompileContext,
} from "./style/compile-page";
export {
  blockTypeClassName,
  // The digest itself, for a caller naming something other than a node from an
  // id — a per-document scope class, say. Exported so that caller reaches for
  // this rather than writing a second hash, which is how the two that existed
  // before came to disagree about the width a class needs.
  hashId,
  nodeClassName,
  nodeClassNames,
  BLOCK_TYPE_CLASS_PREFIX,
  NODE_CLASS_PREFIX,
  PAGE_ROOT_CLASS,
  PAGE_ROOT_SELECTOR,
} from "./style/node-class";
export {
  compileStyleValues,
  tokenCustomProperty,
  DEFAULT_TOKEN_PREFIX,
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

export { migrateDocument, migrateProps, findMigrationGaps } from "./migration";
export type {
  BlockMigrationInfo,
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
  NAMED_CLASS_PREFIX,
  NAMED_CLASS_SLUG_RE,
} from "./style/named-class";
export type { BreakpointAxis } from "./style/breakpoint-axes";

// Where each emitted declaration came from, for an editor that has to tell an author which of
// several tiers they are looking at. Produced only when `StyleCompileContext.trace` asks for it.
export type { StyleOrigin, StyleTraceEntry } from "./style/style-trace";
export type { StyleQuery, StyleSubject } from "./style/style-origin";

// The stylesheet every page of a site shares, compiled once and addressed by its content.
export type { SiteSheetArtifact, SiteSheetInput } from "./style/site-sheet";
export { compileSiteSheet } from "./style/site-sheet";
export { styleOrigin } from "./style/style-origin";
export { BREAKPOINT_AXES } from "./style/breakpoint-axes";
