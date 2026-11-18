/**
 * A node's styles as stored: its visibility and condition, the interaction
 * states, token references, style values per state and breakpoint, its parts,
 * and the breakpoints a site defines.
 *
 * @module document-styles
 */
import { isPlainRecord } from "./plain-record";

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
/**
 * Derived from the list for the same reason as `DOCUMENT_KINDS`, in
 * `document`.
 */
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
  /**
   * A factor the token's value is scaled by, for a length or a number: a
   * button's Small padding is its padding token times 0.75. Written as
   * `calc(var(<token>) * times)`, so it follows the site's token and its
   * prefix wherever either changes. From 0.25 to 4.
   */
  times?: number;
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
  /**
   * Style properties this part takes from the block's root when the root is
   * one of the named wrapper parts: an image's picture takes its corners,
   * proportion and fit from a figure or a link around it. Every tier styling
   * the node (a look, a shared style, its own values) then writes those
   * properties on this part, never on the wrapper's box.
   *
   * @experimental
   */
  takesFromRoot?: {
    /** Style keys, as the catalog names them (`borderRadius`). */
    readonly properties: readonly string[];
    /** The wrapper parts the root may be (`frame`, `link`). */
    readonly whenRootIs: readonly string[];
  };
}

/**
 * A reference to the design token `identity`, scaled by `times` when given:
 * the one way a reference is built, so every writer stores the same shape
 * and a reader looking for one in stored text ({@link tokenRefText}) looks
 * for what was written.
 */
export function tokenRef(identity: string, times?: number): TokenRef {
  return times === undefined
    ? { $token: identity }
    : { $token: identity, times };
}

/**
 * The text a stored document holds for any reference to `identity`, as
 * `JSON.stringify` writes it: the `$token` member of {@link tokenRef}, which
 * a scale, when present, follows or precedes as another member. Matched
 * against a document serialized the same way, it finds a reference wherever
 * the document holds one, without reading the document as blocks.
 */
export function tokenRefText(identity: string): string {
  return JSON.stringify(tokenRef(identity)).slice(1, -1);
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
