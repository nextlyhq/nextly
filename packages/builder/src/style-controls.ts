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
 * controls with no edit here, which is the property worth protecting — and the
 * mapping from leaf kind to control kind is a mapped type, so a leaf kind added
 * to the engine is a compile error in exactly one place rather than a silent
 * fallthrough at runtime.
 *
 * **Which arm of a union a value is shown in is ASKED, not decided.**
 * `styleUnionVariant` is the engine's own arm selection — the same answer
 * validation uses to pick the arm it judges a value against — so the control an
 * author sees and the error they read describe one arm by construction.
 * Predicting it here instead means restating every rule the engine applies, and
 * each of these is a rule that is easy to miss and invisible when missed: the
 * three all-scalar unions, the site's token kind table, a token kind no arm
 * declares, keyword case and ASCII whitespace and CSS escapes, the CSS-wide
 * keywords that every leaf accepts, a union nested as another union's arm,
 * composite arms that share a field name, and a record naming no known field at
 * all. Nothing here holds any of them.
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
  styleUnionVariant,
  type MayFetchUrl,
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

/**
 * What a caller can tell the resolver about the site.
 *
 * Structurally the engine's own `StyleUnionVariantOptions`, and handed to it
 * unchanged: a field this named and the engine did not would be silently
 * dropped, and one the engine reads and this omits would make the arm shown
 * disagree with the arm a write is judged under.
 */
export interface StyleControlOptions {
  /**
   * The site's token table, for choosing between union arms that both accept
   * tokens.
   *
   * Optional: without it the catalog's arm order decides, which is the engine's
   * own fallback for a name it cannot resolve.
   */
  readonly tokens?: TokenLookup;
  /**
   * Which hosts this site will fetch from.
   *
   * Carried because the arm choice is the engine's, and the engine asks this
   * question of a `url` or free-form leaf. No union the catalog ships has such
   * an arm today, so nothing measurable changes by supplying it — which is the
   * moment to wire it, rather than after a catalog change makes its absence a
   * defect. Absent means UNASKED rather than allowed, exactly as everywhere
   * else the policy travels.
   */
  readonly mayFetchUrl?: MayFetchUrl;
}

/** A property's controls, and every choice of form its shape offers. */
export interface StyleControlSet {
  readonly property: string;
  readonly controls: readonly StyleControl[];
  /** Empty when the property's shape holds no union at any depth. */
  readonly variants: readonly StyleControlVariants[];
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
  options: StyleControlOptions | undefined,
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
      options,
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
      // ASKED of the engine rather than decided here. Which arm a stored value
      // belongs to is the same question validation answers when it picks the
      // arm to judge that value against, so reading its answer makes the
      // control and the error message beside it describe one arm by
      // construction. The module docblock lists what predicting it would cost.
      const active = styleUnionVariant(shape, value, options);
      // A union declaring no arms offers no choice and has nothing to draw. The
      // catalog ships none; the matcher this replaced answered 0 regardless and
      // handed `undefined` down as though it were a shape.
      if (active === undefined) return [];
      variants.push({ path, active, count: shape.of.length });
      return walk(property, path, shape.of[active], value, options, variants);
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
  // OWN keys only, as `validateStyleValues` and the declaration walk both read
  // them. A nested field reached through a prototype is one the compiler will
  // not emit, so deriving a control from it shows an active variant the stored
  // document does not have — and an inherited accessor would RUN during a read
  // taken only to draw a panel.
  return Object.hasOwn(value, name) ? value[name] : undefined;
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
    options,
    variants
  );
  return { property: property.property, controls, variants };
}
