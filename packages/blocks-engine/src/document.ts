/**
 * The block document model — the stored shape of everything the page builder
 * produces: page content, patterns, components (a Layout's header and footer
 * among them), and collection templates.
 *
 * This module is data-only. It has zero runtime dependencies and no imports
 * from React or Nextly: documents must be readable and writable from any
 * runtime (Node scripts, edge, browser, external agents) without pulling in
 * a framework.
 */
import type { Binding, BindingSource } from "./document-bindings";
import type { BlockOrigin } from "./document-origin";
import type { NodeStyles, NodeVisibility } from "./document-styles";

export {
  isBlockOrigin,
  patternRenameRecord,
  patternRenames,
  readBlockOrigin,
} from "./document-origin";
export type {
  BlockOrigin,
  OriginReading,
  PatternRenameRecord,
} from "./document-origin";
export {
  BINDING_FORMAT_SHAPES,
  BINDING_FORMAT_TYPES,
  BINDING_SOURCES,
  DEFAULT_BINDING_SOURCE,
  isBindingSource,
} from "./document-bindings";
export type {
  Binding,
  BindingFormat,
  BindingFormatType,
  BindingSource,
} from "./document-bindings";
export {
  MAX_BREAKPOINTS_PER_AXIS,
  MAX_BREAKPOINT_ID_LENGTH,
  STYLE_STATES,
  isTokenRef,
  tokenRef,
  tokenRefText,
} from "./document-styles";
export type {
  BlockPart,
  BreakpointDef,
  BreakpointId,
  BreakpointSet,
  Condition,
  NodeStyles,
  NodeVisibility,
  StyleState,
  StyleValue,
  StyleValues,
  TokenRef,
} from "./document-styles";
export {
  MAX_BLOCK_TYPE_LENGTH,
  MAX_CLASSES_PER_NODE,
  MAX_NAMED_CLASSES,
  isBlockType,
  isPartName,
} from "./document-names";

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
 *                 (a Layout's header and footer are components; a Layout is a
 *                 named bundle REFERENCING them, so it is not a kind)
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
  "template",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * Document-level settings. Deliberately minimal: an entry's own SEO fields
 * and its publishing state are core-entry concerns, not document concerns.
 * Page-level presentation that has no owning node (e.g. a page background)
 * lives here rather than on a fake root block, and so does the metadata a
 * document states for the page as a whole (`seo`), which a collection
 * template binds per entry.
 */
export interface DocumentSettings {
  /** Page-scoped styles with no owning node; same envelope as node styles. */
  styles?: NodeStyles;
  /** The page's own title, description and social image. */
  seo?: DocumentSeo;
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
 * One piece of a metadata text value: literal text, or a binding whose value
 * is joined in its place. Literal text is used as written: nothing in it is
 * read as a placeholder, so a value is never a template string.
 */
export type SeoTextSegment = string | SeoBinding;

/**
 * A binding in a document's own metadata: any binding but one to a list
 * item, since the metadata is read once for the page, outside any list.
 */
export type SeoBinding = Binding & {
  source?: Exclude<BindingSource, "item">;
};

/**
 * The metadata a document states for its page.
 *
 * A text value is a sequence of segments joined in order, so one value can
 * mix literal text with bound fields: an entry's title, then the site's name.
 * A collection template is the reason: one design draws every entry, and a
 * literal title would give each the same one. The social image is one
 * binding, to a media field or a URL field.
 */
export interface DocumentSeo {
  title?: SeoTextSegment[];
  description?: SeoTextSegment[];
  /** The title a shared link shows, where it differs from `title`. */
  socialTitle?: SeoTextSegment[];
  image?: SeoBinding;
}

/**
 * The text values of a document's metadata, in the order they are read: the
 * one list every reader of them walks, so a value added here is validated,
 * judged against the schema, read for and filled alike.
 */
export const SEO_TEXT_FIELDS = ["title", "description", "socialTitle"] as const;

/** One of {@link SEO_TEXT_FIELDS}. */
export type SeoTextField = (typeof SEO_TEXT_FIELDS)[number];

/** The most segments one metadata text value holds. */
export const MAX_SEO_SEGMENTS = 32;

/** The longest literal segment, in UTF-16 code units. */
export const MAX_SEO_TEXT_LENGTH = 1000;

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
  /**
   * Per-prop data bindings. A bound prop's literal stays in `props` as its own
   * value: shown when the binding cannot be used and has no valid fallback, and
   * kept when the prop is unbound. Filled on a published page by
   * `bindDocument` after each binding is checked (`binding-rules`).
   */
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
   * The Layers lock. While true, nothing changes this node or anything inside
   * it: no update (renaming included), no move or removal of it or of a block
   * holding it, no block moved out of it or put into it. Changing `locked`
   * itself is the one edit it allows.
   *
   * Enforced at the data layer, not only in the editor: `applyOp` refuses an op
   * that breaks it (`layers-lock`), and a blocks field's save refuses a write
   * that changes, moves or removes a node locked in the stored document unless
   * the same write unlocks that node (`layers-lock-stored`). A convenience that
   * anyone who may edit the document can lift, never a permission: who may
   * edit stays the collection's access rules' question.
   *
   * A system transform the site makes for a reason no author chose applies its
   * ops with `{ layersLocks: "ignore" }`. The pure tree primitives in `tree.ts`
   * do not read the flag; they sit below the rule.
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
  /**
   * The author's own CSS class names for the node's root element: text, the
   * names separated by spaces, as written. Drawn after the classes Nextly
   * generates, so a site's own stylesheet can target the block.
   *
   * Apart from {@link BlockNode.classes}, which holds the ids of shared styles
   * the site's class library defines and counts. These are free text no library
   * holds. Each name has to be a CSS identifier and may not start with `nx-`
   * (see `cssClassNameRefusal`); a save refuses a node holding one that isn't,
   * naming it.
   */
  cssClasses?: string;
  /**
   * "Never quote this": the node's root element carries `data-nosnippet`, so
   * search engines that read it, Google's among them, show none of its text
   * in a result's snippet. Stored only while on. Google reads the attribute
   * on `span`, `div` and `section` elements
   * (https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag),
   * so it is offered on blocks whose root is one of those.
   */
  nosnippet?: boolean;
  /** Sanitized custom HTML attributes applied to the node's root element. */
  attributes?: Record<string, string>;
  /**
   * Set when upgrading this node to its block's current schema version failed
   * (a missing migration step or a migration that threw). The node keeps its
   * last-good props; a renderer shows a placeholder instead of crashing.
   */
  migrationFailed?: boolean;
  /**
   * Where this subtree was copied from, recorded once and never rendered.
   *
   * Written when a copy is taken and read by nothing at render time, the way
   * {@link BlockNode.migrationFailed} is. What it buys is the one question a
   * copy cannot otherwise answer: "the thing this came from has changed — do
   * you want the change?" That question is asked by every mature builder's
   * users and answered by none of them, because an unsynced copy keeps no
   * record of its source.
   *
   * ONE field with a discriminant rather than one field per source. A pattern
   * copy and a detached component are two provenances today and there will be
   * more — an imported document, a duplicated page — and each of those as its
   * own key is a stored format that grows a column per feature. The
   * discriminant also makes the shapes differ honestly: a pattern copy carries
   * a digest because the pattern it came from can change underneath it, and a
   * detached component does not, because detaching is the act of declining
   * further change.
   */
  origin?: BlockOrigin;
}

// ---------------------------------------------------------------------------
// Component instances — a distinguished node type
// ---------------------------------------------------------------------------

/**
 * The node type marking a linked component instance. The node's `props` carry
 * the reference; instance-provided slot content lives in `node.slots` like any
 * container.
 *
 * PURE resolution — inlining a definition, applying a variant then the
 * instance's overrides, re-identifying the inlined nodes — belongs in this
 * package. Only the FETCH belongs to the stores, which alone know whether a
 * caller wants the draft or the published definition.
 *
 * Four consumers need that resolution and none of them is the renderer alone:
 * the canvas renders in the same document as the admin rather than in an
 * iframe, and the class-usage index and SEO derivation each read a resolved
 * tree without rendering at all. A resolver living beside any one of them
 * would be reimplemented by the other three.
 */
export const COMPONENT_INSTANCE_TYPE = "nextly/component-instance";

/**
 * The type an editor draws in place of a block its visibility conditions hide
 * for the entry being previewed: a marker naming the block and why. Never
 * stored, and reserved, so no registered block can be drawn as the marker
 * nor the marker as a registered block.
 *
 * @experimental Settles with the editor's condition controls.
 */
export const CONDITION_HIDDEN_TYPE = "nextly/condition-hidden";

/** The props a component-instance node stores. */
export interface ComponentInstanceProps {
  /** The referenced component document's id. */
  componentId: string;
  /**
   * The chosen variant's id: its key in the definition's `variants`, which a
   * rename keeps. A key the definition no longer holds renders the defaults.
   */
  variant?: string;
  /**
   * Per-instance values for the definition's exposed properties, keyed by
   * {@link ExposedProperty.id}.
   *
   * Three states, not two, and the third is the reason this is not simply an
   * optional value. An id ABSENT from this record inherits whatever the
   * definition (or the selected variant) provides; an id mapped to
   * {@link OverrideUnset} renders empty; any other value replaces. Without the
   * middle state an author could not clear a subtitle the definition fills in
   * — writing `""` or `null` is a value the definition may itself treat as
   * meaningful, and omitting the key means "inherit", which is what they are
   * trying not to do.
   */
  overrides?: Record<string, OverrideValue>;
}

/**
 * The sentinel that clears an exposed property instead of inheriting it.
 *
 * A wrapper object rather than a reserved primitive, because every primitive
 * an author might otherwise mean — `null`, `""`, `0`, `false` — is a legitimate
 * value for some exposed property, and a sentinel that collides with a real
 * value is one that cannot be distinguished from it later.
 */
export interface OverrideUnset {
  $unset: true;
}

/**
 * What an instance may store against one exposed property.
 *
 * `unknown`, not a union with {@link OverrideUnset}. An override replaces a
 * node prop and props are unconstrained (`BlockNode.props` is
 * `Record<string, unknown>`), so writing the union would widen straight back
 * to `unknown` while reading as though the sentinel were discriminable at
 * compile time — a type that documents a guarantee it does not provide. The
 * sentinel is one of the values this may hold and is recognised at runtime by
 * {@link isUnsetOverride}.
 */
export type OverrideValue = unknown;

/**
 * True if an override clears its property rather than replacing it.
 *
 * The EXACT shape, not merely an object carrying the marker. Override values
 * are unconstrained, so a structured one may legitimately hold a `$unset` key
 * of its own — a link value of `{ href: "/docs", $unset: true }` is a value to
 * apply, and matching on the marker alone would clear the property instead of
 * setting it. Requiring the sentinel to be its own sole key leaves every
 * richer object a value.
 */
export function isUnsetOverride(value: OverrideValue): value is OverrideUnset {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length === 1 && (value as { $unset?: unknown }).$unset === true;
}

/** True if a node is a linked component instance. */
export function isComponentInstance(node: BlockNode): boolean {
  return node.type === COMPONENT_INSTANCE_TYPE;
}

// ---------------------------------------------------------------------------
// Component definitions — the envelope a `kind: "component"` document carries
// ---------------------------------------------------------------------------

/** The value shapes an exposed property may be edited as. */
export const EXPOSED_PROPERTY_TYPES = [
  "text",
  "richText",
  "image",
  "link",
  "visibility",
  "select",
] as const;

/**
 * Derived from the list for the same reason {@link DocumentKind} is: a
 * hand-written union and a runtime list are two declarations that happen to
 * agree, and the pair can be half-changed without either side failing.
 */
export type ExposedPropertyType = (typeof EXPOSED_PROPERTY_TYPES)[number];

/**
 * The single HTML `id` a node actually renders, or `undefined` for none.
 *
 * A node can SPELL a DOM id two ways — the modelled `cssId` and the
 * `attributes` escape hatch — and it emits at most ONE. The renderer assigns
 * the bag first, lowercasing every key, and then overwrites with the modelled
 * field, so this mirrors that order exactly.
 *
 * Only a STRING `cssId` shadows, the empty string included — so `cssId: ""`
 * stops the bag and emits nothing, while `cssId: null` is normalised away and
 * the bag renders.
 *
 * An empty id is not an id: it takes nothing and only stops the bag. The
 * renderer ASKS this rather than deciding again, so the two cannot disagree
 * about which spelling wins or about what an empty one means.
 *
 * Published because reading the two fields independently is wrong in both
 * directions, and every one of those readings was live somewhere:
 *
 * - counting them as two ids made a node look like it collided with ITSELF, so
 *   a run spelling one id through both fields was refused as a duplicate;
 * - counting a SHADOWED attribute id as taken made a copy rename itself to
 *   avoid a string the destination never emits;
 * - reading "any present `cssId`" instead of "a string" hid a bag id that does
 *   render, and left two elements answering to one id.
 */
export function renderedDomId(node: {
  readonly cssId?: unknown;
  readonly attributes?: unknown;
}): string | undefined {
  const modelled = typeof node.cssId === "string" ? node.cssId : undefined;
  const rendered = modelled ?? renderedDomIdIn(node.attributes);
  return rendered === "" ? undefined : rendered;
}

/**
 * The `id` an attribute bag alone would render, if any.
 *
 * The LAST case variant wins, whatever it holds, empty included. HTML attribute
 * names are ASCII case-insensitive, so a bag of `{ id: "hero", ID: "" }` spells
 * one attribute twice and the later one decides it — leaving an empty id, which
 * {@link renderedDomId} then reports as no id. Skipping the empty one here
 * would keep `hero` and name an id nothing renders.
 *
 * Separate from {@link renderedDomId} because the narrower question is a real
 * one: a surface asking whether an empty bag id would SHADOW something has to
 * ask about the bag alone.
 *
 * Shape-checked the way the RENDERER checks, which is looser than this module's
 * usual `isPlainRecord`: it does `Object.entries(attributes)` on any non-array
 * object and emits what it finds, so a class instance or an object with a
 * custom prototype and an own `id` puts that id on the page. Narrowing to a
 * plain record here reported no id for such a node, and an insert then kept an
 * incoming id the destination was already rendering.
 *
 * The narrow rule is right where it is used — validation asks what SURVIVES
 * JSON, and a `Date` or a `Map` does not — but this question is "what does the
 * renderer emit right now", and the answer has to be the renderer's.
 *
 * `Object.entries(null)` throws and an array is not a bag, so both are absent.
 *
 * UNBOUNDED, deliberately, because the renderer it mirrors is: every key is
 * assigned. A caller that must not do work proportional to a bag it has not
 * measured should bound the bag first and hand only a measured one to
 * {@link renderedDomId} — reading a cap into this would make it answer
 * differently from the renderer for exactly the documents where the answer
 * matters.
 */
export function renderedDomIdIn(attributes: unknown): string | undefined {
  if (typeof attributes !== "object" || attributes === null) return undefined;
  if (Array.isArray(attributes)) return undefined;
  let found: string | undefined;
  for (const [name, value] of Object.entries(attributes)) {
    if (name.toLowerCase() !== "id") continue;
    if (typeof value === "string") found = value;
  }
  return found;
}

/**
 * One property of a definition that an instance may override.
 *
 * A POINTER into the definition's own tree, not a copy of the value. The value
 * lives on the node where the author designed it, so the definition renders
 * correctly on its own, and an instance that overrides nothing is identical to
 * the definition.
 */
export interface ExposedProperty {
  /**
   * Stable slug, minted once.
   *
   * Never derived from `nodeId` or `label`, and this is the whole reason it
   * exists as a separate field: instances address their overrides by this id,
   * so a derived one would silently re-point every override the moment an
   * author renamed the label or the exposure moved to a different node.
   */
  id: string;
  /** What the inspector calls it. */
  label: string;
  /** The node in THIS document's tree carrying the value. Validated to exist. */
  nodeId: string;
  /** Dot path into that node's props, in the binding-path grammar. */
  propPath: string;
  /** How the inspector edits it. */
  type: ExposedPropertyType;
  /**
   * The choices, for `select` only.
   *
   * An option's value may be a named class or a token reference, which is how
   * a definition offers constrained STYLE choices without exposing the style
   * system to the instance author.
   */
  options?: readonly { value: string; label: string }[];
}

/**
 * A region of a definition an instance may fill with its own children.
 *
 * Points at a slot on a container node in the definition's tree. Instance
 * content lives in the instance node's own `slots`, so it travels with the
 * node through copy, duplication, pattern-save and export.
 */
export interface ExposedSlot {
  /**
   * No `id` field: the KEY of {@link ComponentDocument.slots} is the id.
   *
   * A record keyed by id whose values also carry one states the same identity
   * twice, and nothing reconciles them — a definition whose key says `body`
   * and whose field says `header` is well formed under both readings, and
   * which one an instance's slot content is addressed by depends on which the
   * next reader happened to use. One spelling makes the disagreement
   * unrepresentable rather than merely detectable.
   */

  /** What the layers panel calls it. */
  label: string;
  /** The container node in THIS document's tree. Validated to exist. */
  nodeId: string;
  /** Which of that node's slots. Validated to exist on the node. */
  slot: string;
  /** Block types this slot accepts; unset accepts whatever the container does. */
  allow?: readonly string[];
}

/**
 * A named preset of override values, offered alongside the definition.
 *
 * No slot content. A variant that supplied its own children would be handing
 * the validator a second node forest, and the one place a forest is checked —
 * for malformed nodes, duplicated ids, depth and node count — is the walk over
 * `nodes`. Declaring the field without reaching it there would accept an
 * arbitrary tree at the persistence gate under the name of a validated
 * document, so it lands with the resolver that inlines it, checked by the same
 * walk. A document carrying one today is refused rather than quietly stored.
 */
export interface Variant {
  /** What the inspector calls it. */
  label: string;
  /** Values keyed by {@link ExposedProperty.id}, applied before the instance's own. */
  overrides: Record<string, OverrideValue>;
}

/**
 * A document that defines a reusable component.
 *
 * An extension of {@link BlockDocument} rather than a member of a union with
 * it, deliberately. Every existing consumer reads a stored document as a
 * `BlockDocument` and none of them can narrow, so a union would make the whole
 * package's type surface a breaking change to gain a discrimination only two
 * call sites need. The narrowing is available where it matters through
 * {@link isComponentDocument}, and the envelope is validated per kind
 * regardless of which type the reader used.
 */
export interface ComponentDocument extends BlockDocument {
  kind: "component";
  /**
   * Properties an instance may override. Absent exposes none.
   *
   * Optional rather than a required empty array, matching every other
   * "absent means none" field in this contract (`settings`, `BlockNode.slots`,
   * `variants`). A component that exposes nothing is not a malformed one — it
   * is a locked, reusable block, which is the whole point of a footer — so
   * requiring the empty array would refuse a legitimate definition and force a
   * migration over every stored component to add a field meaning what its
   * absence already means.
   */
  exposed?: ExposedProperty[];
  /** Regions an instance may fill, keyed by slot id. Absent exposes none. */
  slots?: Record<string, ExposedSlot>;
  /**
   * Named override presets, keyed by each variant's stable id. The id is
   * opaque and kept across renames; the name a picker shows is its `label`.
   */
  variants?: Record<string, Variant>;
}

/**
 * True if a document declares itself a component definition.
 *
 * Reads the KIND only. Whether its envelope is well formed is a question for
 * validation, and answering it here would make a malformed definition read as
 * "not a component" — which is how a document with a dangling pointer gets
 * quietly treated as an ordinary page instead of being reported.
 */
export function isComponentDocument(
  doc: BlockDocument
): doc is ComponentDocument {
  return doc.kind === "component";
}

/**
 * True if a document declares itself a pattern.
 *
 * Reads the KIND only, for the reason {@link isComponentDocument} does:
 * whether the tree inside it is usable is a question for validation, and
 * answering it here would make a malformed pattern read as "not a pattern"
 * rather than be reported as one that is broken.
 *
 * Published because two roads now ask it and they must agree: the planner
 * refuses a document that is not a pattern outright, and a palette has to know
 * not to offer one it would refuse. A second spelling of `kind === "pattern"`
 * agrees until one of them learns about a kind the other does not.
 */
export function isPatternDocument(doc: BlockDocument): boolean {
  return doc.kind === "pattern";
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
