/**
 * Which controls a style property offers, derived from the catalog alone.
 *
 * Pure, for the reason `inspector.ts` is: which controls a property offers, in
 * what order, carrying which value shape, is derivation — and a component test
 * in jsdom cannot separate a correct answer from a plausible wrong one, because
 * both render a column of inputs.
 *
 * **The catalog decides, and nothing here holds a second list.** A property's
 * `shape` names its value form; this walks that shape and answers with one
 * descriptor per editable leaf. Adding a property to `catalog.ts` gives it
 * controls with no edit here, which is the whole of D-05.1 — and the mapping
 * from leaf kind to control kind is a mapped type, so a leaf kind added to the
 * engine is a compile error in exactly one place rather than a silent
 * fallthrough at runtime.
 *
 * **What this module does NOT do.** It does not decide which properties a block
 * offers (that is `supports`, read through the catalog's own group helpers), it
 * does not hold the active state or breakpoint, and it does not validate. A
 * control's value is written through `style-values.ts`, which delegates every
 * check to `validateStyleValues`.
 *
 * @module style-controls
 */

import {
  isStyleLeaf,
  isTokenRef,
  type StyleLeaf,
  type StyleProperty,
  type StyleShape,
  type StyleValue,
  type TokenLookup,
} from "@nextlyhq/blocks-engine";

/**
 * The editor kind a leaf resolves to.
 *
 * Named separately from `StyleLeaf["kind"]` rather than reused, because the two
 * answer different questions and will not stay parallel: `dimension` and
 * `number` are distinct storage shapes that both draw a numeric field with a
 * scrub affordance, and a future leaf kind may reuse an existing control
 * outright. Collapsing them onto one name would make that a breaking rename.
 */
export type StyleControlKind =
  | "select"
  | "length"
  | "number"
  | "color"
  | "css"
  | "url";

/**
 * The control each leaf kind draws with.
 *
 * A MAPPED TYPE over the engine's own union, so a leaf kind added there fails
 * to compile here until it is given a control. The alternative — a `switch` with
 * a `default` — accepts the new kind silently and draws nothing, which presents
 * an incomplete property as a complete one.
 */
const CONTROL_KIND_BY_LEAF: {
  readonly [K in StyleLeaf["kind"]]: StyleControlKind;
} = {
  keyword: "select",
  dimension: "length",
  number: "number",
  color: "color",
  cssValue: "css",
  url: "url",
};

/**
 * The leaf kinds this build can draw.
 *
 * DERIVED from the mapping rather than listed beside it. A second list agrees
 * with the mapping on the day it is written: adding a leaf kind and its
 * required map entry while forgetting the list still compiles, and
 * `controlForLeaf` then reports a kind it can perfectly well draw as
 * unsupported.
 *
 * Membership is still checked at runtime rather than trusted from the type,
 * because a catalog written by a NEWER engine can carry a kind absent from
 * both — and indexing a mapped type with it returns `undefined` while the type
 * says otherwise. Such a kind resolves to an unsupported descriptor rather
 * than to `undefined` flowing into a renderer, the same policy as
 * `inspector.ts`'s `SUPPORTED_PROP_TYPES`: the author is told the property
 * exists and is not editable here, because omitting it entirely would present
 * an incomplete property as a complete one.
 */
export const SUPPORTED_LEAF_KINDS = Object.keys(
  CONTROL_KIND_BY_LEAF
) as readonly StyleLeaf["kind"][];

/**
 * One editable position inside a property's value, with everything a control
 * needs to draw itself and nothing about how it is drawn.
 */
export interface StyleControl {
  /** The catalog key this belongs to, as stored in a `StyleValues` record. */
  readonly property: string;
  /**
   * Where inside the property's value this control writes, outermost first.
   *
   * Empty for a property stored as a scalar. `["blockEnd"]` for the bottom
   * margin, `["startStart"]` for the top-left corner radius. A control writes
   * by handing this path back to `style-values.ts`, which is what keeps the
   * addressing in one place rather than in every control.
   */
  readonly path: readonly string[];
  /** The leaf the catalog declares at this path, carrying units, bounds and token kinds. */
  readonly leaf: StyleLeaf;
  /**
   * The control to draw, or `undefined` when this build has no control for the
   * leaf's kind.
   *
   * Carried rather than recomputed by the panel, for the reason `EditableProp`
   * carries `supported`: the panel would have to repeat the membership test, and
   * the two would disagree the first time the set gained a member.
   */
  readonly kind: StyleControlKind | undefined;
  /** Whether {@link kind} is present. */
  readonly supported: boolean;
}

/**
 * A union's variants, when the shape at a path accepts more than one form.
 *
 * `borderRadius` stores either one measurement or four corners, and an editor
 * offers a way to move between them. Recorded here so that affordance reads the
 * catalog's own list instead of re-deriving which forms exist.
 */
export interface StyleControlVariants {
  /**
   * Where in the property's value the choice sits, empty at the root.
   *
   * Carried because a union is not only a top-level shape: `position.zIndex` is
   * a number OR the `auto` keyword, nested a level down. Reporting choices only
   * at the root would leave a renderer no way to offer `auto` at all.
   */
  readonly path: readonly string[];
  /** Which variant the returned controls describe, as an index into the union. */
  readonly active: number;
  /** How many variants the catalog declares at this position. */
  readonly count: number;
}

/** What a caller can tell the resolver about the site. */
export interface StyleControlOptions {
  /**
   * The site's token table, for choosing between union arms that both accept
   * tokens.
   *
   * Optional: without it the catalog's arm order decides, which is the engine's
   * own fallback for a name it cannot resolve.
   */
  readonly tokens?: TokenLookup;
}

/** A property's controls, and every choice of form its shape offers. */
export interface StyleControlSet {
  readonly property: string;
  readonly controls: readonly StyleControl[];
  /** Empty when the property's shape holds no union at any depth. */
  readonly variants: readonly StyleControlVariants[];
}

/**
 * Which union variant a stored value is shown in.
 *
 * A PRESENTATION choice and never a validity judgement: it decides which
 * control to draw, and `validateStyleValues` remains the only thing that
 * decides whether a value may be written.
 *
 * Absent a value the FIRST variant wins, which is the order the engine tries
 * them in and therefore the canonical spelling of the property. With a value,
 * the arm that HOLDS it wins — see {@link variantHolds}, which reads the
 * catalog's own declarations rather than restating any grammar.
 */
function variantForValue(
  variants: readonly StyleShape[],
  value: StyleValue | undefined,
  tokens: TokenLookup | undefined
): number {
  if (value === undefined) return 0;
  const found = variants.findIndex(variant =>
    variantHolds(variant, value, tokens)
  );
  return found === -1 ? 0 : found;
}

/**
 * Whether a variant is the shape a stored value is written in.
 *
 * Composite against scalar is not enough on its own, and three of the four
 * unions the catalog ships are the case it misses: `fontWeight` is a keyword OR
 * a number, `lineHeight` a number OR a dimension, `fontStyle` a keyword OR a
 * free-form value. Every arm of those is a leaf, so a composite test picks the
 * first one every time — a numeric weight would draw the keyword select, and a
 * `1.5rem` line height the unitless number field.
 */
function variantHolds(
  variant: StyleShape,
  value: StyleValue,
  tokens: TokenLookup | undefined
): boolean {
  if (!isStyleLeaf(variant)) return isCompositeValue(value);
  return !isCompositeValue(value) && leafHolds(variant, value, tokens);
}

/**
 * Whether a leaf admits this token reference.
 *
 * Which arm a token belongs to is a fact about the TOKEN, and the stored
 * reference carries only its name. `lineHeight` accepts tokens on both its arms
 * — numbers on one, dimensions on the other — so without the site's table the
 * name alone cannot separate them, and the catalog's arm order decides exactly
 * as the engine's own union check falls back to it.
 */
function tokenLeafHolds(
  leaf: StyleLeaf,
  name: string,
  tokens: TokenLookup | undefined
): boolean {
  if (leaf.tokenKinds.length === 0) return false;
  const kind = tokens?.kindOf(name);
  return kind === undefined || leaf.tokenKinds.includes(kind);
}

/**
 * Whether a leaf stores this number.
 *
 * `0` is the one measurement that needs no unit, which is why a dimension
 * accepts it without `allowNumber`.
 */
function numberLeafHolds(leaf: StyleLeaf, value: number): boolean {
  if (leaf.kind === "number") return true;
  if (leaf.kind !== "dimension") return false;
  return leaf.allowNumber === true || value === 0;
}

/**
 * Whether a leaf stores this string.
 *
 * A keyword leaf claims one only when the string is one of ITS keywords. Every
 * other scalar leaf stores its value as a string, so the catalog's arm order
 * decides between those exactly as the engine's own order does.
 */
function stringLeafHolds(leaf: StyleLeaf, value: string): boolean {
  if (leaf.kind === "keyword") return leaf.values.includes(value);
  return leaf.kind !== "number";
}

/**
 * Whether a leaf is the one a scalar is stored under.
 *
 * Reads the catalog's own declarations — a keyword leaf's `values`, a
 * dimension's `allowNumber`, an arm's `tokenKinds` — rather than restating any
 * grammar. It stays a PRESENTATION choice: `validateStyleValues` remains the
 * only thing deciding whether a value may be written, and it owes this no
 * agreement. Drawing the wrong control is a legibility bug the next keystroke
 * corrects; the write is gated either way.
 */
function leafHolds(
  leaf: StyleLeaf,
  value: StyleValue,
  tokens: TokenLookup | undefined
): boolean {
  if (isTokenRef(value)) return tokenLeafHolds(leaf, value.$token, tokens);
  if (typeof value === "number") return numberLeafHolds(leaf, value);
  if (typeof value === "string") return stringLeafHolds(leaf, value);
  return false;
}

/** A stored value holding named sub-values, as a composite shape addresses. */
type CompositeValue = { readonly [key: string]: StyleValue };

/**
 * Whether a stored value is a record of sub-values rather than a scalar.
 *
 * A token reference is a RECORD and is nonetheless a scalar: `{ $token }` is one
 * value that happens to be spelled as an object, so a shape test that went by
 * `typeof` alone would show a token-valued radius in the four-corner control
 * with the token in none of them.
 *
 * A type predicate rather than a boolean, so the narrowing it establishes is
 * the one the caller reads the value through. Returning a plain boolean would
 * leave every read behind it needing an assertion to say what this already
 * decided.
 */
function isCompositeValue(value: StyleValue): value is CompositeValue {
  if (typeof value !== "object" || value === null) return false;
  // Asked of the engine rather than by looking for the marker key, so a change
  // to what counts as a reference cannot leave this reading the old spelling.
  return !isTokenRef(value);
}

/** One descriptor for a leaf, resolving the control it draws with. */
function controlForLeaf(
  property: string,
  path: readonly string[],
  leaf: StyleLeaf
): StyleControl {
  // Read through the runtime set rather than off the mapping directly. A
  // catalog from a newer engine can carry a kind absent from both, and indexing
  // a mapped type with it returns `undefined` while the type says otherwise.
  const known = SUPPORTED_LEAF_KINDS.includes(leaf.kind);
  const kind = known ? CONTROL_KIND_BY_LEAF[leaf.kind] : undefined;
  return { property, path, leaf, kind, supported: kind !== undefined };
}

/**
 * Every editable position inside a shape, depth-first, carrying its path.
 *
 * Parallel to the engine's `shapeLeaves` but path-aware and union-aware:
 * `shapeLeaves` flattens every arm of a union because a documentation generator
 * wants all of them, and a control layer that did the same would draw two
 * controls for one stored value.
 */
function walk(
  property: string,
  path: readonly string[],
  shape: StyleShape,
  value: StyleValue | undefined,
  tokens: TokenLookup | undefined,
  // Collected as the walk descends rather than returned alongside, so a union
  // at ANY depth is recorded by the same line that resolves it.
  variants: StyleControlVariants[]
): StyleControl[] {
  const down = (step: string, child: StyleShape): StyleControl[] =>
    walk(
      property,
      [...path, step],
      child,
      childValue(value, step),
      tokens,
      variants
    );
  if (isStyleLeaf(shape)) return [controlForLeaf(property, path, shape)];
  switch (shape.kind) {
    case "logicalSides":
      return entriesOf(shape.sides).flatMap(([side, leaf]) => down(side, leaf));
    case "logicalCorners":
      return entriesOf(shape.corners).flatMap(([corner, leaf]) =>
        down(corner, leaf)
      );
    case "object":
      return entriesOf(shape.fields).flatMap(([field, child]) =>
        down(field, child)
      );
    case "union": {
      const active = variantForValue(shape.of, value, tokens);
      variants.push({ path, active, count: shape.of.length });
      return walk(property, path, shape.of[active], value, tokens, variants);
    }
  }
}

/**
 * A shape's named children, typed.
 *
 * `Object.entries` widens the key to `string`, and the widened key then flows
 * into a control's `path` where it is the address a write is applied at. The
 * narrowing is local because the shapes' key sets are declared, not open.
 */
function entriesOf<T>(record: Readonly<Record<string, T>>): [string, T][] {
  return Object.entries(record);
}

/** The stored sub-value at a name, when the parent holds a record. */
function childValue(
  value: StyleValue | undefined,
  name: string
): StyleValue | undefined {
  if (value === undefined || !isCompositeValue(value)) return undefined;
  return value[name];
}

/**
 * The controls one catalog property offers.
 *
 * `value` is optional and affects exactly one thing: which arm of a union the
 * controls describe. Every other answer is a property of the catalog alone,
 * which is what lets a caller derive a panel before any value is loaded.
 */
export function styleControlsFor(
  property: StyleProperty,
  value?: StyleValue,
  options?: StyleControlOptions
): StyleControlSet {
  const variants: StyleControlVariants[] = [];
  const controls = walk(
    property.property,
    [],
    property.shape,
    value,
    options?.tokens,
    variants
  );
  return { property: property.property, controls, variants };
}
