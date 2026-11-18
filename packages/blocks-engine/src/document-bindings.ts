/**
 * Bindings: a prop or a SEO field filled from data, where the data comes from,
 * and how a bound value is formatted.
 *
 * @module document-bindings
 */

// ---------------------------------------------------------------------------
// Bindings — typed field paths, never expressions
// ---------------------------------------------------------------------------

/** Fields every binding carries, regardless of source. */
interface BindingBase {
  /**
   * Dot path into the binding source, following one to-one relation at most.
   * The limit needs the source's schema, so `binding-rules` enforces it.
   */
  $bind: string;
  /**
   * Rendered when the bound value is empty or the binding cannot be used. It
   * must be a valid value of the prop; one that is not is ignored, and the
   * prop's own value is shown instead.
   */
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
 * - `item`   — the current item inside a collection-loop block, or, naming
 *              `list`, the entry of an enclosing list further out
 * - `single` — a named single (global) document, addressed by `sourceKey`
 * - `site`   — site-level settings
 */
export type Binding =
  | (BindingBase & {
      source?: Exclude<BindingSource, "single">;
      sourceKey?: never;
      /**
       * For an `item` binding only: the id of the enclosing collection list
       * whose entry it reads, for a block inside a list inside another.
       * Absent, the nearest list's entry. A list the block is not inside is
       * refused, as a list item outside every list is.
       *
       * @experimental Settles with the editor's binding controls.
       */
      list?: string;
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
