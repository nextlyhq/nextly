/**
 * The block document model — the stored shape of everything the page builder
 * produces: page content, patterns, components, Layout regions, and collection
 * templates.
 *
 * This module is data-only. It has zero runtime dependencies and no imports
 * from React or Nextly: documents must be readable and writable from any
 * runtime (Node scripts, edge, browser, external agents) without pulling in
 * a framework.
 */

/**
 * Engine document-format version. Bumped only when the envelope shape itself
 * changes incompatibly; per-block schema changes use per-node `version` plus
 * block migrations instead.
 */
export type DocumentFormatVersion = 1;

/** The current document-format version new documents are written with. */
export const DOCUMENT_FORMAT_VERSION: DocumentFormatVersion = 1;

/**
 * What a stored builder document IS:
 * - `page`      — an entry's blocks-field content
 * - `pattern`   — a copy-on-insert saved subtree (including full-page patterns)
 * - `component` — a linked, reusable definition with exposed props/slots/variants
 * - `region`    — a Layout region document (header, footer, ...); a Layout is a
 *                 named bundle REFERENCING region documents, so it is not a kind
 * - `template`  — a collection template ("template" is reserved for exactly this)
 *
 * The enum is closed: an unknown kind is a validation error in strict mode and
 * preserved untouched in forgiving mode, the same policy as unknown block types.
 */
export type DocumentKind =
  | "page"
  | "pattern"
  | "component"
  | "region"
  | "template";

/** Every legal `kind`, for validation and exhaustive iteration. */
export const DOCUMENT_KINDS: readonly DocumentKind[] = [
  "page",
  "pattern",
  "component",
  "region",
  "template",
];

/**
 * Document-level settings. Deliberately minimal: SEO and publishing state are
 * core-entry concerns, not document concerns. Page-level presentation that has
 * no owning node (e.g. a page background) lives here rather than on a fake
 * root block.
 */
export interface DocumentSettings {
  /** Page-scoped styles with no owning node; same envelope as node styles. */
  styles?: NodeStyles;
  /** Sanitized document-scoped custom CSS (CSS only — custom JS never exists). */
  customCss?: string;
}

/**
 * The stored value of a `blocks` field and the body of every builder document.
 *
 * The top level is a plain array of nodes: a page IS a list of sections.
 * There is no synthetic root block — document-level concerns live on this
 * envelope, so no algorithm ever needs to special-case an undeletable,
 * unmovable pseudo-node.
 */
export interface BlockDocument {
  formatVersion: DocumentFormatVersion;
  kind: DocumentKind;
  nodes: BlockNode[];
  settings?: DocumentSettings;
  /**
   * Usage index for media referenced anywhere in the document, so reference
   * tracking never requires a full tree walk.
   */
  assets?: { mediaIds?: string[] };
}

/**
 * One block instance in a document.
 *
 * `id` is a stable UUID and is the ONLY way anything addresses a node:
 * editor operations, locale overlays, scoped-CSS class derivation, and
 * selection all key on it. Positional addressing is never part of any stored
 * or public contract.
 */
export interface BlockNode {
  /** Stable unique id; survives moves, duplication re-ids the copy. */
  id: string;
  /** Namespaced block type, e.g. "core/heading". */
  type: string;
  /**
   * The block definition's schema version this node was written against.
   * Required on every node: forgiving rendering and the manifest version
   * stamp both depend on it unconditionally.
   */
  version: number;
  /** Literal content/config values. Bound values live in `bindings`, never here. */
  props: Record<string, unknown>;
  /** Per-prop data bindings; a bound prop's literal stays in `props` as the fallback shown on unbind. */
  bindings?: Record<string, Binding>;
  /** Named child regions, stored in the node. Only container blocks declare slots. */
  slots?: Record<string, BlockNode[]>;
  /** Typed style overrides: states × breakpoints (see `NodeStyles`). */
  styles?: NodeStyles;
  /** References to site-global named classes (by class id, not by CSS name). */
  classes?: string[];
  /** Conditional and per-breakpoint visibility. */
  visibility?: NodeVisibility;
  /**
   * Author lock. While true, the editor command layer must not let the author
   * move or delete this node. It is an author-facing policy flag, not a
   * data-layer guarantee: system transforms (migrations, overlays, restore)
   * still operate on locked nodes, and the pure tree primitives do not read it.
   */
  locked?: boolean;
  /** Author-facing instance label, shown in the Layers panel. */
  name?: string;
  /** Per-node raw custom CSS (CSS only); sanitized and scoped at compile time. */
  customCss?: string;
  /** CSS id applied to the node's root element. */
  cssId?: string;
  /** Sanitized custom HTML attributes applied to the node's root element. */
  attributes?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Bindings — typed field paths, never expressions
// ---------------------------------------------------------------------------

/**
 * A typed field-path binding. `$bind` is a dot path into the source object
 * with at most one relation hop (e.g. "title", "author.name"). Bindings are
 * data, never code: there is no expression language and nothing is evaluated.
 */
export interface Binding {
  /** Dot path into the binding source, one relation traversal max. */
  $bind: string;
  /**
   * Where the path resolves from:
   * - `entry` — the entry that owns the document (the default)
   * - `item`  — the current item inside a collection-loop block
   * - `single` — a named single (global) document
   * - `site`  — site-level settings
   */
  source?: BindingSource;
  /** Rendered when the bound value is empty or the path cannot resolve. */
  fallback?: unknown;
  /** Locale-aware display formatting applied after resolution. */
  format?: BindingFormat;
}

export type BindingSource = "entry" | "item" | "single" | "site";

/**
 * Structured, locale-aware formatting for bound values. Each variant maps to
 * the matching `Intl` formatter; `options` passes through to it. Formatting is
 * declarative data so documents stay language-neutral and agent-writable.
 */
export type BindingFormat =
  | { type: "date"; options?: Record<string, unknown> }
  | { type: "number"; options?: Record<string, unknown> }
  | { type: "currency"; currency: string; options?: Record<string, unknown> }
  | { type: "relativeTime"; options?: Record<string, unknown> }
  | { type: "list"; options?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Visibility — entry-field conditions + per-breakpoint device visibility
// ---------------------------------------------------------------------------

/**
 * Node visibility. `conditions` is stored as OR-of-AND from day one (outer
 * array = OR, inner arrays = AND groups) even while editing UIs expose only a
 * single AND group, so richer UIs never need a storage migration.
 * Conditionally hidden nodes are OMITTED from server output, not CSS-hidden.
 *
 * `devices` is separate and CSS-based on purpose: per-breakpoint hiding is a
 * presentation concern, and the two must not be conflated.
 */
export interface NodeVisibility {
  conditions?: Condition[][];
  /** Per-breakpoint visibility; `false` hides at that breakpoint id. */
  devices?: Record<BreakpointId, boolean>;
}

/** One entry-field predicate, e.g. { field: "status", op: "eq", value: "vip" }. */
export interface Condition {
  field: string;
  op: string;
  value?: unknown;
}

// ---------------------------------------------------------------------------
// Styles — the envelope only; the property catalog belongs to the compiler
// ---------------------------------------------------------------------------

/**
 * Interactive states styles can target. A closed set: extending it after the
 * format freeze is a document-format migration, not an edit.
 */
export type StyleState = "base" | "hover" | "focus" | "active";

export const STYLE_STATES: readonly StyleState[] = [
  "base",
  "hover",
  "focus",
  "active",
];

/**
 * A breakpoint id referencing the site-level breakpoint definitions (viewport
 * and container axes). Documents store values keyed by id; the definitions
 * themselves live once in site settings and arrive via validation context.
 */
export type BreakpointId = string;

/**
 * A design-token reference usable anywhere a style scalar is. The `$token`
 * marker keeps token refs self-describing in raw JSON, parallel to `$bind`.
 */
export interface TokenRef {
  $token: string;
}

/**
 * One style value: a literal, a token reference, or a structured object whose
 * leaves are again style values (box sides, structured backgrounds, ...).
 */
export type StyleValue =
  | string
  | number
  | TokenRef
  | { [key: string]: StyleValue };

/**
 * The style properties set at one state × breakpoint. The envelope is frozen
 * here; the legal property CATALOG (names, value shapes, physical→logical
 * mapping) is the style compiler's contract and is validated there.
 */
export type StyleValues = Record<string, StyleValue>;

/**
 * A node's complete style data: states × breakpoints × values. Both axes are
 * sparse — omitted states/breakpoints simply inherit.
 */
export type NodeStyles = Partial<
  Record<StyleState, Partial<Record<BreakpointId, StyleValues>>>
>;

/** True if a style value is a design-token reference. */
export function isTokenRef(value: unknown): value is TokenRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TokenRef).$token === "string"
  );
}

// ---------------------------------------------------------------------------
// Breakpoint definitions — stored once at site level, consumed via context
// ---------------------------------------------------------------------------

/** One breakpoint definition. Desktop-first: `base` has no max width. */
export interface BreakpointDef {
  id: BreakpointId;
  label: string;
  /** Upper bound in CSS pixels; the base breakpoint omits it. */
  maxWidth?: number;
}

/**
 * The site's breakpoint definitions on both axes. The engine never reads
 * storage: callers load this from the builder settings and pass it into
 * validation/compilation context.
 */
export interface BreakpointSet {
  viewport: BreakpointDef[];
  container: BreakpointDef[];
}

/** Maximum breakpoints per axis (the base breakpoint included). */
export const MAX_BREAKPOINTS_PER_AXIS = 7;

// ---------------------------------------------------------------------------
// Component instances — a distinguished node type
// ---------------------------------------------------------------------------

/**
 * The node type marking a linked component instance. The node's `props` carry
 * the reference; instance-provided slot content lives in `node.slots` like any
 * container. Resolution (definition lookup, variant application, per-instance
 * overrides) happens where components are stored and rendered, not here.
 */
export const COMPONENT_INSTANCE_TYPE = "nextly/component-instance";

/** The props a component-instance node stores. */
export interface ComponentInstanceProps {
  /** The referenced component document's id. */
  componentId: string;
  /** The selected variant name, when the component defines variants. */
  variant?: string;
}

/** True if a node is a linked component instance. */
export function isComponentInstance(node: BlockNode): boolean {
  return node.type === COMPONENT_INSTANCE_TYPE;
}

// ---------------------------------------------------------------------------
// Locale overlays — per-locale prop values over one base tree
// ---------------------------------------------------------------------------

/**
 * A locale's overlay over a base document: per-node, per-prop replacement
 * values keyed by stable node id. `src` records a hash of the base value the
 * translation was made from, so staleness ("the base text changed since this
 * was translated") is detectable automatically.
 *
 * `content_mode` reserves the door to a full per-locale fork of the tree;
 * only "overlay" is produced today.
 */
export interface LocaleOverlay {
  content_mode: "overlay" | "fork";
  props: Record<string, Record<string, LocaleOverlayValue>>;
}

/** One overlaid prop value plus the base-value hash it was translated from. */
export interface LocaleOverlayValue {
  value: unknown;
  /** Hash of the base-locale value at translation time; absent = never checked. */
  src?: string;
}
