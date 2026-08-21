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
  type StyleLeaf,
  type StyleProperty,
  type StyleShape,
  type StyleValue,
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
 * Named as a set rather than inferred from the mapping's keys, so the answer
 * survives a document written by a NEWER engine: a catalog carrying a leaf kind
 * this build has never heard of resolves to an unsupported descriptor rather
 * than to `undefined` flowing into a renderer. Same policy as `inspector.ts`'s
 * `SUPPORTED_PROP_TYPES`, and for the same reason — the author is told the
 * property exists and is not editable here, because omitting it entirely would
 * present an incomplete property as a complete one.
 */
export const SUPPORTED_LEAF_KINDS: readonly StyleLeaf["kind"][] = [
  "keyword",
  "dimension",
  "number",
  "color",
  "cssValue",
  "url",
];

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
  /** Which variant the returned controls describe, as an index into the union. */
  readonly active: number;
  /** How many variants the catalog declares at this position. */
  readonly count: number;
}

/** A property's controls, and the variant they describe when it is a union. */
export interface StyleControlSet {
  readonly property: string;
  readonly controls: readonly StyleControl[];
  /** Absent when the property's shape is not a union. */
  readonly variants?: StyleControlVariants;
}

/**
 * Which union variant a stored value is shown in.
 *
 * A PRESENTATION choice and never a validity judgement: it decides which
 * control to draw, and `validateStyleValues` remains the only thing that
 * decides whether a value may be written. Drawing the wrong control is a
 * legibility bug that the next keystroke corrects; the write is gated
 * elsewhere either way, so this deliberately does not re-implement the
 * validator's arm-matching in order to agree with it.
 *
 * The test is structural and shallow because that is the distinction that
 * separates the variants in practice — a scalar is stored as a string, a number
 * or a token reference, and a composite is stored as a record. Absent a value,
 * the FIRST variant wins, which is the same order the engine tries them in and
 * therefore the canonical spelling of the property.
 */
function variantForValue(
  variants: readonly StyleShape[],
  value: StyleValue | undefined
): number {
  if (value === undefined) return 0;
  const stored = isCompositeValue(value);
  const found = variants.findIndex(variant => !isStyleLeaf(variant) === stored);
  return found === -1 ? 0 : found;
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
  return !("$token" in value);
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
  value: StyleValue | undefined
): StyleControl[] {
  if (isStyleLeaf(shape)) return [controlForLeaf(property, path, shape)];
  switch (shape.kind) {
    case "logicalSides":
      return entriesOf(shape.sides).flatMap(([side, leaf]) =>
        walk(property, [...path, side], leaf, childValue(value, side))
      );
    case "logicalCorners":
      return entriesOf(shape.corners).flatMap(([corner, leaf]) =>
        walk(property, [...path, corner], leaf, childValue(value, corner))
      );
    case "object":
      return entriesOf(shape.fields).flatMap(([field, child]) =>
        walk(property, [...path, field], child, childValue(value, field))
      );
    case "union":
      return walk(
        property,
        path,
        shape.of[variantForValue(shape.of, value)],
        value
      );
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
  value?: StyleValue
): StyleControlSet {
  const { shape } = property;
  const controls = walk(property.property, [], shape, value);
  if (shape.kind !== "union") {
    return { property: property.property, controls };
  }
  return {
    property: property.property,
    controls,
    variants: {
      active: variantForValue(shape.of, value),
      count: shape.of.length,
    },
  };
}
