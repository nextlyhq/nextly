/**
 * @nextlyhq/blocks-engine — the runtime-free core of the Nextly page builder.
 *
 * This package owns the stored document format and the pure operations over
 * it. It never imports React or Nextly at runtime, so documents can be
 * created, inspected, and transformed from any JavaScript environment.
 */
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
} from "./style/css-value";
export type { CssValueRejection } from "./style/css-value";
export {
  validateStyleValues,
  newStyleIssueBudget,
  MAX_STYLE_ISSUES,
  MAX_STYLE_ISSUE_PATH_BYTES,
  MAX_SITE_ISSUES,
  MAX_SITE_ISSUE_PATH_BYTES,
  tokenKindAllowedAt,
  tokenKindsForProperty,
} from "./style/validate-style-value";
export type { StyleIssueBudget } from "./style/validate-style-value";
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
