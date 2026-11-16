/**
 * How rich text's format bits are drawn: the element each bit wraps text in,
 * the case transforms, and a text node's own inline style.
 *
 * @module rich-text-formats
 */
import {
  hasFormat,
  formatsDrawnByStyle,
  readInlineStyle,
  TEXT_FORMAT,
} from "@nextlyhq/blocks-engine";
import type { CSSProperties, ReactNode } from "react";

/**
 * The element each format bit wraps text in, outermost LAST.
 *
 * A table rather than a run of `if`s: every entry says the same thing, and the
 * order is data — `code` sits at the end so it wraps the rest, matching how the
 * CMS's serializer nests them. Read as a list, a reordering is visible; read as
 * eight branches, it is not.
 */
const FORMAT_ELEMENTS: readonly {
  flag: (typeof TEXT_FORMAT)[keyof typeof TEXT_FORMAT];
  wrap: (inner: ReactNode) => ReactNode;
}[] = [
  { flag: TEXT_FORMAT.SUBSCRIPT, wrap: inner => <sub>{inner}</sub> },
  { flag: TEXT_FORMAT.SUPERSCRIPT, wrap: inner => <sup>{inner}</sup> },
  { flag: TEXT_FORMAT.STRIKETHROUGH, wrap: inner => <s>{inner}</s> },
  { flag: TEXT_FORMAT.UNDERLINE, wrap: inner => <u>{inner}</u> },
  { flag: TEXT_FORMAT.ITALIC, wrap: inner => <em>{inner}</em> },
  { flag: TEXT_FORMAT.BOLD, wrap: inner => <strong>{inner}</strong> },
  { flag: TEXT_FORMAT.HIGHLIGHT, wrap: inner => <mark>{inner}</mark> },
  { flag: TEXT_FORMAT.CODE, wrap: inner => <code>{inner}</code> },
];

/**
 * How the three case formats are drawn.
 *
 * A transform rather than an element, because that is what they are: the stored
 * text is unchanged and only its presentation differs, so wrapping it in a tag
 * would assert a meaning the author did not choose. The values are constants
 * from this table and never stored text, so no author input reaches a style.
 */
const CASE_TRANSFORM: readonly {
  flag: (typeof TEXT_FORMAT)[keyof typeof TEXT_FORMAT];
  value: "lowercase" | "uppercase" | "capitalize";
}[] = [
  { flag: TEXT_FORMAT.LOWERCASE, value: "lowercase" },
  { flag: TEXT_FORMAT.UPPERCASE, value: "uppercase" },
  { flag: TEXT_FORMAT.CAPITALIZE, value: "capitalize" },
];

/** Wraps text in the elements its format bits ask for, innermost first. */
/**
 * The React name for each property {@link readInlineStyle} can return.
 *
 * Written out rather than derived by camel-casing the hyphens, because a
 * derived name is a STRING and `style` takes typed keys — the conversion would
 * have to be asserted through, and an assertion is exactly what hides a name
 * React does not know. Every entry here is a key the type system checked.
 *
 * `everyInlineStylePropertyHasAReactName` in the test file holds this to the
 * engine's list, so a property added there and forgotten here fails rather than
 * being dropped from the page in silence.
 */
const REACT_STYLE_PROPERTY = {
  color: "color",
  "background-color": "backgroundColor",
  "font-size": "fontSize",
  "font-family": "fontFamily",
  "font-weight": "fontWeight",
  "font-style": "fontStyle",
  "text-decoration": "textDecoration",
  "text-decoration-line": "textDecorationLine",
  "text-decoration-color": "textDecorationColor",
  "text-decoration-style": "textDecorationStyle",
  "text-align": "textAlign",
  "vertical-align": "verticalAlign",
  "line-height": "lineHeight",
  "letter-spacing": "letterSpacing",
  "word-spacing": "wordSpacing",
  "white-space": "whiteSpace",
  "text-transform": "textTransform",
  opacity: "opacity",
} as const satisfies Readonly<Record<string, keyof CSSProperties>>;

/**
 * An author's stored font, size, colour and highlight, as a style object.
 *
 * The engine decides WHAT survives; this only renames what it kept. A property
 * the map above has no name for is dropped rather than passed through as a
 * string key, because React would silently ignore it and the page would differ
 * from the CMS's HTML for the same node.
 */
function inlineStyle(
  value: unknown,
  format: number | undefined
): CSSProperties {
  const style: Record<string, string> = {};
  for (const [property, declared] of readInlineStyle(value, format)) {
    if (!Object.hasOwn(REACT_STYLE_PROPERTY, property)) continue;
    style[REACT_STYLE_PROPERTY[property as keyof typeof REACT_STYLE_PROPERTY]] =
      declared;
  }
  // Accumulated as a record because indexing `CSSProperties` with a UNION of
  // keys gives the INTERSECTION of their value types — which for these eighteen
  // is the CSS-wide keywords and nothing else, so a plain `"16px"` is rejected
  // on a type that has no business rejecting it. The record is assignable as it
  // stands, so nothing is asserted through here; the KEYS, which are the half
  // that could be wrong, were checked by the `satisfies` on the map above.
  return style;
}

export function formatted(
  text: string,
  format: number | undefined,
  style: unknown
): ReactNode {
  // Only one case format can apply: `text-transform` is a single CSS property,
  // so a value carrying two case bits would otherwise render whichever wrapper
  // happened to be inner. Taking the first keeps that deterministic.
  const transform = CASE_TRANSFORM.find(entry => hasFormat(format, entry.flag));
  const declared: CSSProperties = {
    // The FORMAT goes with it: a stored `font-weight: normal` beside a BOLD bit
    // is a contradiction, and the engine resolves it by property rather than
    // letting this file's nesting decide. See `FORMAT_OWNED` there.
    ...inlineStyle(style, format),
    // LAST, so the format bit wins a disagreement. The bit is a button an
    // author pressed on this selection; a `text-transform` in the style string
    // is whatever a document happened to arrive carrying, and where they
    // conflict the deliberate act is the one to honour.
    ...(transform === undefined ? {} : { textTransform: transform.value }),
  };

  // INNERMOST, inside the format elements rather than around them.
  //
  // Those elements carry colours of their own: `<mark>` is painted by the UA
  // with `Mark` and `MarkText`, and the CMS gives it a class that sets both
  // explicitly. A colour on an outer `<span>` only INHERITS, so the mark's own
  // paint wins and an author who highlighted a phrase and then chose a text
  // colour published the mark's colours instead of theirs. Declared on the
  // element closest to the text, the author's choice is the one that applies.
  //
  // No wrapper when there is nothing to put on it: an empty `<span>` around
  // every text node is bytes on every page and a hook a stylesheet can catch on.
  let out: ReactNode =
    Object.keys(declared).length === 0 ? (
      text
    ) : (
      /*
       * KEYED on the whole declaration list — every property AND its value.
       *
       * React diffs a style object property by property, and two of its
       * outcomes are wrong here. Identical keys and values in a different order
       * produce no writes at all, so the element keeps whichever shorthand won
       * before. And where a SHORTHAND and one of its longhands are both
       * present, changing only the shorthand writes only that: assigning
       * `text-decoration` resets `text-decoration-color`, so the longhand the
       * diff skipped as unchanged is silently undone and the client drifts from
       * what a fresh render and the CMS both produce.
       *
       * Keying on the values costs a remount whenever any of them changes,
       * which for static published text is a span being replaced. Ordering
       * alone was cheaper and did not cover the shorthand case.
       */
      <span
        key={Object.entries(declared)
          .map(([property, written]) => `${property}:${String(written)}`)
          .join(";")}
        style={declared}
      >
        {text}
      </span>
    );
  // A wrapper whose LINE the style already draws is not emitted. A text
  // decoration propagates to descendants rather than being replaced by theirs,
  // so a `<u>` around a span declaring `underline wavy red` draws two
  // underlines — the wrapper's plain one, which the span cannot remove, and the
  // span's on top. The declaration is the richer of the two, so the wrapper is
  // what goes. The engine decides which, and the CMS asks the same question.
  const drawn = formatsDrawnByStyle(style, format);
  for (const { flag, wrap } of FORMAT_ELEMENTS) {
    if (hasFormat(format, flag) && (drawn & flag) === 0) out = wrap(out);
  }
  return out;
}
