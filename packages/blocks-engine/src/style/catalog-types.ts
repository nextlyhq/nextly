/**
 * The type vocabulary the style-property catalog is written in.
 *
 * The catalog is DATA, not code: every property describes its value shape, the
 * CSS it emits, and the design-token kinds it accepts. Validation walks these
 * descriptors, the compiler emits from them, the inspector derives its controls
 * from them, and the reference documentation is generated from them — so all
 * four stay in agreement by construction rather than by discipline.
 */

/**
 * Design-token kinds, the subset of the W3C DTCG `$type` vocabulary the token
 * model supports. Keeping the vocabulary a projection of DTCG rather than a
 * translation is what makes token import/export lossless.
 */
export type TokenKind =
  | "color"
  | "dimension"
  | "fontFamily"
  | "fontWeight"
  | "number"
  | "shadow"
  | "duration"
  | "custom";

export const TOKEN_KINDS: readonly TokenKind[] = [
  "color",
  "dimension",
  "fontFamily",
  "fontWeight",
  "number",
  "shadow",
  "duration",
  "custom",
];

/**
 * A catalog group. Each group name is also a block `supports` key: a block that
 * opts into `spacing` is opting into exactly the properties this group holds,
 * which is what lets an editor derive a block's Style tab from its `supports`
 * without a second hand-maintained mapping.
 */
export type StyleGroup =
  | "spacing"
  | "layout"
  | "dimensions"
  | "typography"
  | "color"
  | "background"
  | "border"
  | "shadow"
  | "effects"
  | "position"
  | "container"
  | "list";

/** A group and the label an editor shows for it. */
export interface StyleGroupDef {
  key: StyleGroup;
  label: string;
}

/**
 * The groups, in the order an editor should present them. This is the single
 * definition of the style-capability vocabulary: the block registry derives the
 * `supports` keys blocks may declare from it, so the two cannot drift.
 */
export const STYLE_GROUP_DEFS: readonly StyleGroupDef[] = [
  { key: "spacing", label: "Spacing" },
  { key: "layout", label: "Layout" },
  { key: "dimensions", label: "Dimensions" },
  { key: "typography", label: "Typography" },
  { key: "color", label: "Color" },
  { key: "background", label: "Background" },
  { key: "border", label: "Border" },
  { key: "shadow", label: "Shadow" },
  { key: "effects", label: "Effects" },
  { key: "position", label: "Position" },
  { key: "container", label: "Container queries" },
  { key: "list", label: "List" },
];

export const STYLE_GROUPS: readonly StyleGroup[] = STYLE_GROUP_DEFS.map(
  group => group.key
);

/** What every leaf descriptor carries, whatever its value kind. */
interface StyleLeafBase {
  /** The CSS property this leaf emits, e.g. `margin-block-start`. */
  cssProperty: string;
  /**
   * Token kinds a `{ $token }` reference may resolve to at this leaf. Empty
   * means literals only — a token reference here is a validation error.
   */
  tokenKinds: readonly TokenKind[];
  /**
   * A descendant selector this declaration attaches to instead of the node's
   * own root, e.g. `a` for link colors. Blocks render a single element, so
   * styling something inside one is a deliberate, enumerated exception; keeping
   * it in the catalog rather than in compiler branches makes every such
   * exception visible and testable.
   */
  descendant?: string;
}

/** A closed set of legal keywords — the catalog's own vocabulary, not CSS's. */
export interface KeywordLeaf extends StyleLeafBase {
  kind: "keyword";
  values: readonly string[];
  /**
   * How many keywords the property accepts, in order. One unless the property
   * is a shorthand over two axes: `overflow: hidden auto` sets the inline and
   * block axes separately, and there is no other way to express the second.
   */
  maxParts?: number;
  /**
   * Values from `values` that are a complete declaration on their own and may
   * not join a shorthand, the way the CSS-wide keywords may not.
   * `background-repeat: repeat-x` already names both axes, so pairing it with
   * anything emits a declaration the browser discards.
   */
  soloValues?: readonly string[];
}

/** A length, percentage, or other CSS dimension, stored as a string (or `0`). */
export interface DimensionLeaf extends StyleLeafBase {
  kind: "dimension";
  /**
   * Keywords this property accepts in place of a measurement. Declared per
   * property because they are not interchangeable: `margin: auto` centres a
   * box, `padding: auto` is discarded, and `max-width: none` has no meaning on
   * `min-width`. The CSS-wide keywords are accepted everywhere and are not
   * listed here.
   */
  keywords?: readonly string[];
  /**
   * How many measurements the property accepts. One unless it is a shorthand:
   * `border-radius` takes up to four corners and an optional second set after
   * a slash, `gap` takes a row and a column.
   */
  maxParts?: number;
  /** Whether a negative measurement means anything here, as on a margin. */
  allowNegative?: boolean;
  /** Whether a percentage resolves against anything for this property. */
  allowPercentage?: boolean;
  /**
   * Functions this property accepts beyond the ones legal wherever a length
   * is. Declared per property for the same reason the keywords are: a sizing
   * function such as `fit-content()` is a width, not a length, so a browser
   * honours it on `width` and discards it on `gap` or a corner radius.
   */
  functions?: readonly string[];
  /**
   * Whether a bare number is a measurement here. True only on `line-height`,
   * where a unitless value is the preferred spelling; everywhere else a number
   * emits a declaration the browser discards, so an expression resolving to one
   * is refused.
   */
  allowNumber?: boolean;
}

/** A unitless number, optionally bounded. */
export interface NumberLeaf extends StyleLeafBase {
  kind: "number";
  min?: number;
  max?: number;
  integer?: boolean;
}

/** A color, stored as a CSS color string. */
export interface ColorLeaf extends StyleLeafBase {
  kind: "color";
}

/**
 * A free-form CSS value validated for SYNTAX only (it must parse as a value and
 * therefore cannot break out of its declaration). Grammar correctness per
 * property is deliberately not checked: the reference data available to do so
 * lags the CSS the platform actually ships, and rejecting valid modern CSS is a
 * worse failure than accepting a value the browser will ignore.
 */
export interface CssValueLeaf extends StyleLeafBase {
  kind: "cssValue";
}

/** A URL, emitted inside `url()`, with its scheme checked explicitly. */
export interface UrlLeaf extends StyleLeafBase {
  kind: "url";
  /**
   * Keywords this property accepts in place of a URL, declared per property
   * exactly as a dimension's are. `background-image: none` is what clears an
   * image inherited from an earlier state, and without it that value is
   * indistinguishable from a relative path and would emit `url("none")`.
   * The CSS-wide keywords are accepted everywhere and are not listed here.
   */
  keywords?: readonly string[];
}

export type StyleLeaf =
  | KeywordLeaf
  | DimensionLeaf
  | NumberLeaf
  | ColorLeaf
  | CssValueLeaf
  | UrlLeaf;

/** The four logical box sides, in writing-mode terms rather than physical ones. */
export interface LogicalSidesShape {
  kind: "logicalSides";
  sides: {
    blockStart: StyleLeaf;
    blockEnd: StyleLeaf;
    inlineStart: StyleLeaf;
    inlineEnd: StyleLeaf;
  };
}

/** The four logical corners, named block-then-inline like the CSS properties. */
export interface LogicalCornersShape {
  kind: "logicalCorners";
  corners: {
    startStart: StyleLeaf;
    startEnd: StyleLeaf;
    endStart: StyleLeaf;
    endEnd: StyleLeaf;
  };
}

/** A record of named sub-values, each with its own shape. */
export interface ObjectShape {
  kind: "object";
  fields: Readonly<Record<string, StyleShape>>;
}

/**
 * A value accepted in more than one shape, e.g. a corner radius stored either
 * as one scalar or as four logical corners. Variants are tried in order and the
 * first that accepts the value wins.
 */
export interface UnionShape {
  kind: "union";
  of: readonly StyleShape[];
}

export type StyleShape =
  | StyleLeaf
  | LogicalSidesShape
  | LogicalCornersShape
  | ObjectShape
  | UnionShape;

/** One catalog row: a legal key inside a `StyleValues` record. */
export interface StyleProperty {
  /** The storage key as it appears in a document's style values. */
  property: string;
  /** The group this property belongs to, and the `supports` key enabling it. */
  group: StyleGroup;
  /**
   * The `supports` sub-flag that enables this property on its own. A block
   * declaring `supports: { border: { radius: true } }` gets the properties
   * flagged `radius` and nothing else in the group; `supports: { border: true }`
   * gets the whole group. Properties with no flag are reachable only through
   * the `true` form, which is how a group states that it offers no finer
   * granularity than all-or-nothing.
   */
  flag?: string;
  /** The shape of the stored value. */
  shape: StyleShape;
  /** One line describing the property, for the generated reference docs. */
  summary: string;
}

/** True when a shape is a leaf rather than a container. */
export function isStyleLeaf(shape: StyleShape): shape is StyleLeaf {
  return (
    shape.kind !== "logicalSides" &&
    shape.kind !== "logicalCorners" &&
    shape.kind !== "object" &&
    shape.kind !== "union"
  );
}

/**
 * Every leaf reachable from a shape, in a stable depth-first order. Used by the
 * documentation generator and by the tests that hold the catalog to its own
 * invariants (every leaf names a CSS property, every token kind is known).
 */
export function shapeLeaves(shape: StyleShape): StyleLeaf[] {
  if (isStyleLeaf(shape)) return [shape];
  switch (shape.kind) {
    case "logicalSides":
      return Object.values(shape.sides).flatMap(shapeLeaves);
    case "logicalCorners":
      return Object.values(shape.corners).flatMap(shapeLeaves);
    case "object":
      return Object.values(shape.fields).flatMap(shapeLeaves);
    case "union":
      return shape.of.flatMap(shapeLeaves);
  }
}
