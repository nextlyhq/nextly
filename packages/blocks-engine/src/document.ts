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
import { isPlainRecord } from "./plain-record";

/**
 * Engine document-format version. Bumped only when the envelope shape itself
 * changes incompatibly; per-block schema changes use per-node `version` plus
 * block migrations instead.
 */
export type DocumentFormatVersion = 1;

/** The current document-format version new documents are written with. */
export const DOCUMENT_FORMAT_VERSION: DocumentFormatVersion = 1;

/**
 * What a stored builder document IS, and every legal `kind` for validation and
 * exhaustive iteration:
 * - `page`      — an entry's blocks-field content
 * - `pattern`   — a copy-on-insert saved subtree (including full-page patterns)
 * - `component` — a linked, reusable definition with exposed props/slots/variants
 * - `region`    — a Layout region document (header, footer, ...); a Layout is a
 *                 named bundle REFERENCING region documents, so it is not a kind
 * - `template`  — a collection template ("template" is reserved for exactly this)
 *
 * The enum is closed: an unknown kind is a validation error in strict mode and
 * preserved untouched in forgiving mode, the same policy as unknown block types.
 *
 * The LIST is the declaration and the type is derived from it, the way the
 * binding vocabularies are. Written the other way round the two are independent
 * declarations that happen to agree: removing an entry from the list leaves the
 * type still permitting it, so `BlockDocument` accepts a kind the published
 * schema and the generated parser both reject, and every test on both sides
 * still passes. Deriving makes the format unable to be half-changed.
 */
export const DOCUMENT_KINDS = [
  "page",
  "pattern",
  "component",
  "region",
  "template",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * Document-level settings. Deliberately minimal: SEO and publishing state are
 * core-entry concerns, not document concerns. Page-level presentation that has
 * no owning node (e.g. a page background) lives here rather than on a fake
 * root block.
 */
export interface DocumentSettings {
  /** Page-scoped styles with no owning node; same envelope as node styles. */
  styles?: NodeStyles;
  /**
   * Document-scoped custom CSS, as the author wrote it.
   *
   * NOT sanitized, and nothing renders it. This said "sanitized" while no
   * sanitizer existed, which is the most expensive kind of wrong comment: it
   * reads as a guarantee to whoever adds the render call, and the render call
   * is the change that would make it dangerous. A stylesheet needs its
   * selectors scoped and its properties allow-listed before it reaches a page,
   * which is a different job from the value-level checks the rich-text path
   * performs.
   */
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
  /**
   * Per-node custom CSS, as the author wrote it.
   *
   * NOT sanitized or scoped: the style compiler never reads this key. The claim
   * that it was compiled is the same wrong guarantee the document-level field
   * carried, one level down.
   */
  customCss?: string;
  /** CSS id applied to the node's root element. */
  cssId?: string;
  /** Sanitized custom HTML attributes applied to the node's root element. */
  attributes?: Record<string, string>;
  /**
   * Set when upgrading this node to its block's current schema version failed
   * (a missing migration step or a migration that threw). The node keeps its
   * last-good props; a renderer shows a placeholder instead of crashing.
   */
  migrationFailed?: boolean;
}

// ---------------------------------------------------------------------------
// Bindings — typed field paths, never expressions
// ---------------------------------------------------------------------------

/** Fields every binding carries, regardless of source. */
interface BindingBase {
  /** Dot path into the binding source, one relation traversal max. */
  $bind: string;
  /** Rendered when the bound value is empty or the path cannot resolve. */
  fallback?: unknown;
  /** Locale-aware display formatting applied after resolution. */
  format?: BindingFormat;
}

/**
 * A typed field-path binding. `$bind` is a dot path into the source object
 * with at most one relation hop (e.g. "title", "author.name"). Bindings are
 * data, never code: there is no expression language and nothing is evaluated.
 *
 * Modeled as a discriminated union on `source` so the `single` variant REQUIRES
 * `sourceKey` (which global document to read) while the others forbid it: a
 * site can define many singles, so an ambiguous single binding must be
 * unrepresentable, not merely discouraged.
 *
 * Sources:
 * - `entry`  — the entry that owns the document (the default when omitted)
 * - `item`   — the current item inside a collection-loop block
 * - `single` — a named single (global) document, addressed by `sourceKey`
 * - `site`   — site-level settings
 */
export type Binding =
  | (BindingBase & {
      source?: Exclude<BindingSource, "single">;
      sourceKey?: never;
    })
  | (BindingBase & {
      source: "single";
      /** Slug of the single (global) document this binding reads from. */
      sourceKey: string;
    });

/**
 * Every legal binding source, as a runtime value.
 *
 * The list is the source of truth and `BindingSource` is derived from it, not
 * the other way around. A consumer that must enumerate the sources — a schema,
 * a picker, a generator — otherwise restates them as literals, and a restated
 * list stays valid TypeScript after this one changes: adding a source here
 * would leave the copy rejecting documents the engine accepts, with every test
 * on both sides still passing. Deriving makes that divergence unrepresentable
 * rather than merely discouraged.
 */
export const BINDING_SOURCES = ["entry", "item", "single", "site"] as const;

export type BindingSource = (typeof BINDING_SOURCES)[number];

/**
 * Whether a string names a binding source.
 *
 * Takes `string` rather than the union: every caller is holding a value off a
 * stored document, so a signature demanding the answer as its argument would be
 * unusable at the only call sites that matter. The widening cast is confined
 * here so no caller has to write one, which is what keeps the list from being
 * copied for want of a predicate.
 */
export function isBindingSource(value: string): value is BindingSource {
  return (BINDING_SOURCES as readonly string[]).includes(value);
}

/**
 * The source that applies when a binding names none.
 *
 * Stated as a value for the same reason as the list: the schema and the
 * resolver both need to know which source an omitted `source` means, and a
 * default agreed in two places is a default in neither.
 */
export const DEFAULT_BINDING_SOURCE: BindingSource = "entry";

/**
 * Structured, locale-aware formatting for bound values. Each variant maps to
 * the matching `Intl` formatter; `options` passes through to it. Formatting is
 * declarative data so documents stay language-neutral and agent-writable.
 */
/**
 * The formats a bound value may be rendered with, and the extra field each one
 * requires — the single declaration everything else is derived from.
 *
 * A runtime list and a union of shapes are two answers to "what formats
 * exist", and a type-level equality check between them is a comparison rather
 * than a derivation: it catches a divergence after both have been written,
 * while still requiring two synchronized edits to add a format. The generator
 * reads the list and engine consumers read the union, so between those two
 * edits they describe different stored formats.
 *
 * Declaring the shapes once removes the second answer. The list is the map's
 * keys, the union is built from its entries, and adding a format is one edit
 * that cannot be half-made.
 *
 * A value of `null` means the variant carries no field of its own; `currency`
 * is the only one that does, and the type of that field is what the union
 * needs, not a description of it.
 */
export const BINDING_FORMAT_SHAPES = {
  date: null,
  number: null,
  currency: { currency: "" as string },
  relativeTime: null,
  list: null,
} as const;

export type BindingFormatType = keyof typeof BINDING_FORMAT_SHAPES;

/** Every legal `format.type`, as a runtime value. */
export const BINDING_FORMAT_TYPES = Object.keys(
  BINDING_FORMAT_SHAPES
) as readonly BindingFormatType[] as readonly [
  BindingFormatType,
  ...BindingFormatType[],
];

/**
 * Structured, locale-aware formatting for bound values. Each variant maps to
 * the matching `Intl` formatter; `options` passes through to it. Formatting is
 * declarative data so documents stay language-neutral and agent-writable.
 *
 * Built from {@link BINDING_FORMAT_SHAPES}: each key becomes a variant carrying
 * its own required fields, so the union cannot name a format the list omits or
 * omit one the list names.
 */
export type BindingFormat = {
  [K in BindingFormatType]: {
    type: K;
    options?: Record<string, unknown>;
  } & MutableFields<(typeof BINDING_FORMAT_SHAPES)[K]>;
}[BindingFormatType];

/**
 * A shape entry's fields as a writable object type.
 *
 * `BINDING_FORMAT_SHAPES` is `as const` so the KEYS can drive
 * {@link BindingFormatType}, and that same annotation makes every value
 * `readonly`. Carried through untouched it would have narrowed the public
 * union: `format.currency = "EUR"` on a variant narrowed to `currency` stopped
 * compiling, which is a source-breaking change to a published type and has
 * nothing to do with how the format is stored. The mapped type strips the
 * modifier the const assertion added, leaving the fields as writable as they
 * were before they were derived.
 */
type MutableFields<S> = S extends null
  ? unknown
  : { -readonly [K in keyof S]: S[K] };

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
/** Derived from the list for the same reason as {@link DOCUMENT_KINDS}. */
export const STYLE_STATES = ["base", "hover", "focus", "active"] as const;

export type StyleState = (typeof STYLE_STATES)[number];

/**
 * A breakpoint id referencing the site-level breakpoint definitions (viewport
 * and container axes). Documents store values keyed by id; the definitions
 * themselves live once in site settings and arrive via validation context.
 *
 * Breakpoint ids are unique across BOTH axes (an invariant validation enforces
 * on the breakpoint settings). That is what lets a node's styles be keyed by id
 * alone: the id resolves to exactly one `BreakpointDef`, and thus one axis, via
 * the context — so the style envelope stays flat (state × breakpoint) instead
 * of carrying a redundant axis level on every value, and a viewport and a
 * container breakpoint can never collide on the same id.
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
 * A node's complete style data: states × breakpoints × values, both levels
 * sparse — omitted states/breakpoints simply inherit. The breakpoint key spans
 * both axes (viewport and container); because breakpoint ids are unique across
 * axes (see {@link BreakpointId}), the id alone identifies the axis, so no
 * separate axis level is needed here.
 */
export type NodeStyles = Partial<
  Record<StyleState, Partial<Record<BreakpointId, StyleValues>>>
>;

/** One named element a block renders inside its own root. */
export interface BlockPart {
  /** Shared default styles for this part on every instance of the block type. */
  baseStyles?: NodeStyles;
}

/** True if a style value is a design-token reference. */
export function isTokenRef(value: unknown): value is TokenRef {
  // A reference must be a plain record, not merely an object carrying the key.
  // An array or a Date decorated with `$token` reads as a reference here and
  // then serializes to `[]` or a string, so the token is lost on the way to
  // storage and the document fails validation the next time it is read.
  return isPlainRecord(value) && typeof value.$token === "string";
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
 * validation/compilation context. Ids MUST be unique across the two axes
 * combined (not just within each axis), so a node's style breakpoint key
 * resolves to exactly one definition; validation enforces this.
 */
export interface BreakpointSet {
  viewport: BreakpointDef[];
  container: BreakpointDef[];
}

/** Maximum breakpoints per axis (the base breakpoint included). */
export const MAX_BREAKPOINTS_PER_AXIS = 7;

/**
 * The longest breakpoint id this engine will accept from a stored axis.
 *
 * `MAX_BREAKPOINTS_PER_AXIS` bounds how MANY definitions are read and says
 * nothing about their size, which is the same gap `MAX_NAMED_CLASS_NAME_LENGTH`
 * closes for a class name — and the same consequence: an id is a lookup key
 * carried by every reader of the normalised axis, so one enormous stored value
 * is copied on every render that asks which breakpoints this site defines.
 *
 * A definition carrying one is DROPPED rather than truncated, for the reason a
 * definition with an unusable bound is: the id is then simply not one this site
 * defines, and the values stored under it are reported stale like any other
 * unknown breakpoint. Truncating would keep it usable under a name no document
 * references, which loses those values with nothing reported at all.
 *
 * The same value as a class name's cap, and for the same reason — well above
 * anything a person types, so it is only ever reached by data already wrong.
 */
export const MAX_BREAKPOINT_ID_LENGTH = 128;

/**
 * The grammar a block type follows: two lowercase slug segments around one `/`.
 *
 * Held here, in the document model, because a block type is a document-model
 * fact rather than a property of any one consumer. Registration, validation and
 * compilation all decide whether a value is a type, and each asking its own
 * question is how they come to disagree about the same string.
 */
const BLOCK_TYPE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The longest block type this engine accepts.
 *
 * The grammar constrains the alphabet and not the length, so a type of megabytes
 * of otherwise-valid characters satisfies it, is scanned in full wherever it is
 * checked, and is copied into a selector for every rule its defaults produce.
 * The same reason `MAX_BREAKPOINT_ID_LENGTH` and `MAX_NAMED_CLASS_NAME_LENGTH`
 * exist, and the same value: far above a namespaced slug anyone types, so it is
 * only ever met by data that is already wrong.
 */
export const MAX_BLOCK_TYPE_LENGTH = 128;

/**
 * Whether a value is a usable block type.
 *
 * Length before the pattern, so the cheap test is what rejects an oversized
 * value: the other way round, the regex scans the whole string first and the cap
 * bounds nothing it exists to bound.
 *
 * This is the ONE answer. A consumer that bounds the type where another does not
 * accepts a value its neighbour rejects — a block registers and validates while
 * the compiler silently omits its defaults, so it renders without the look it
 * declared and nothing reports why.
 */
export function isBlockType(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_BLOCK_TYPE_LENGTH &&
    BLOCK_TYPE_RE.test(value)
  );
}

/**
 * The grammar a part NAME is held to.
 *
 * A part name is compiled into a class, so it reaches a selector — and a block
 * definition is code a plugin supplies. The same shape a block type's own
 * segments use, for the same reason: no dot, no bracket, no space can appear,
 * so nothing here can close a rule and open another.
 *
 * Consecutive dashes are excluded deliberately. The class joins the block type
 * and the part with a DOUBLED dash, so a name containing one would make the
 * boundary ambiguous and let two different blocks compile to a single class.
 */
const BLOCK_PART_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Longest part name accepted. A name longer than this is not a name, and the
 * bound keeps a pathological value out of an issue message.
 */
const MAX_BLOCK_PART_LENGTH = 32;

/**
 * True if a value names a part a block may state styles for.
 *
 * The ONE answer, for the same reason {@link isBlockType} is: a caller that
 * bounds this where another does not emits a class its neighbour refuses.
 */
export function isPartName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_BLOCK_PART_LENGTH &&
    BLOCK_PART_NAME_RE.test(value) &&
    // A name `Object.prototype` already owns cannot be stored in a record and
    // read back: the lookup answers with the inherited member instead of
    // `undefined`, and assigning it sets the prototype rather than creating an
    // own property. `constructor` passes the grammar above, which is exactly
    // why this is asked of the prototype rather than matched against a written
    // list — the list everyone writes is `__proto__` and `constructor` while
    // `valueof` behaves identically.
    !Object.prototype.hasOwnProperty.call(Object.prototype, value)
  );
}

/**
 * Maximum named classes read from the site library on one compile.
 *
 * The library is site settings, not part of a document, so the document's own byte cap does not
 * bound it — and it is read on every page render. Set far above any hand-authored library so the
 * cap is only ever reached by data that is already wrong.
 *
 * Applied to the STORED order, before `orderIndex` is read. Deciding by `orderIndex` instead
 * means reading every entry to know which to keep, which is exactly the read this bounds.
 */
export const MAX_NAMED_CLASSES = 2000;

/**
 * Maximum class references read from one node.
 *
 * The per-node counterpart to the library cap. A document reaches the compiler whether or not
 * anything validated it, and a node's `classes` array is walked on every render of the page that
 * holds it, so without a bound one corrupt array is copied and scanned in full each time.
 *
 * Set far above any real design. A named class is a preset, not a utility: a block carrying
 * dozens of them is describing a class that should have been one.
 */
export const MAX_CLASSES_PER_NODE = 64;

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
 * `contentMode` reserves the door to a full per-locale fork of the tree;
 * only "overlay" is produced today.
 */
export interface LocaleOverlay {
  contentMode: "overlay" | "fork";
  props: Record<string, Record<string, LocaleOverlayValue>>;
}

/** One overlaid prop value plus the base-value hash it was translated from. */
export interface LocaleOverlayValue {
  value: unknown;
  /** Hash of the base-locale value at translation time; absent = never checked. */
  src?: string;
}
