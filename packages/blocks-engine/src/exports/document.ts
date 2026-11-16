/**
 * The engine's public exports: the document format: its kinds, constants, guards and types, its limits, and the SEO and Layout readings of a stored document.
 *
 * Part of the package's root entry, `../index.ts`, which re-exports every
 * part in a fixed order. Nothing here imports that entry.
 */
export { deriveSeoFromDocument } from "../derive-seo";
// A document's own metadata, its bound segments filled by the page's binding
// pass: what a collection template gives each entry's page.
export { resolveDocumentSeo } from "../document-seo";
export type { ResolvedDocumentSeo } from "../document-seo";
// Which Layout a page is drawn inside: the one rule the render, the editor
// and the tests share.
export { resolvePageLayout } from "../resolve-layout";
export type {
  LayoutResolution,
  LayoutSite,
  PageLayoutChoice,
} from "../resolve-layout";
// The regions a Layout fills around a page, and the document each is drawn
// from: one reading of a stored Layout, shared by the route, the editor and
// the plugin.
export {
  layoutRelationId,
  regionDocument,
  regionsOf,
  REGION_AREAS,
} from "../layout-regions";
export type { LayoutRegion, RegionArea } from "../layout-regions";
export type { SeoDefinitionSource, SeoImageCandidate } from "../derive-seo";

export {
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  MAX_SEO_SEGMENTS,
  MAX_SEO_TEXT_LENGTH,
  SEO_TEXT_FIELDS,
  BINDING_SOURCES,
  BINDING_FORMAT_TYPES,
  DEFAULT_BINDING_SOURCE,
  COMPONENT_INSTANCE_TYPE,
  CONDITION_HIDDEN_TYPE,
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
  tokenRef,
  tokenRefText,
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
} from "../document";
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
  SeoTextField,
  LocaleOverlay,
  LocaleOverlayValue,
  NodeStyles,
  NodeVisibility,
  StyleState,
  StyleValue,
  StyleValues,
  TokenRef,
} from "../document";

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
} from "../limits";
export type { DocumentLimits } from "../limits";
export type { DocumentSurvey, SurveyLimits } from "../measure-bytes";
