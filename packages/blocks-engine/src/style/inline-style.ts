/**
 * One reading of a rich-text inline style, for everything that needs one.
 *
 * Lexical keeps an author's font, size, colour and highlight in a text node's
 * `style` string. Three surfaces have to agree about what that string means:
 * the CMS serializes it into published HTML, the React renderer draws it on a
 * page, and the versions differ decides whether a change to it is a change a
 * reader would SEE. Three readings of one question drift, and the drift is
 * silent — the admin reports an edit the page cannot render, or the page shows
 * a declaration the CMS refused.
 *
 * So the reading happens once, here, and the other two views are derived from
 * it rather than computed beside it: {@link sanitizeInlineStyle} joins what
 * {@link readInlineStyle} kept.
 *
 * ## Why the allowlist is exported as DATA
 *
 * A differ cannot use a sanitizer. It is not asking "what may I emit" but "is
 * this property one a reader would notice", and a function that returns a
 * cleaned string cannot answer that without the caller re-deriving the list
 * from its output. {@link INLINE_STYLE_PROPERTIES} is therefore the list
 * itself, and {@link isInlineStyleProperty} the same answer for one name.
 *
 * @module style/inline-style
 */

import { hasFormat, TEXT_FORMAT } from "../rich-text";

import { cssColor, hasCssInjection, normalizeCssValue } from "./css-color";

/**
 * The properties a stored inline style may carry onto a page.
 *
 * Wider than the editor can produce, deliberately. The toolbar writes four —
 * `font-family`, `font-size`, `color`, `background-color` — but a document can
 * also arrive by import or by paste, and those carry whatever the source had.
 * The rest of this list is that second population: typography and alignment a
 * word processor emits, and nothing that positions, floats, sizes or layers an
 * element, because those are the declarations that let stored text escape the
 * box the page gave it.
 *
 * Exported as an array rather than a `Set` so a reader can enumerate it. See
 * the module docblock for who needs that and why.
 */
export const INLINE_STYLE_PROPERTIES = [
  "color",
  "background-color",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "text-decoration",
  "text-decoration-line",
  "text-decoration-color",
  "text-decoration-style",
  // `text-align` is deliberately ABSENT, and this note is here so it is not
  // added back as an oversight. Both surfaces put a text node's style on a
  // `<span>` — this package's renderer and `serializeTextNode` in the CMS — and
  // `text-align` applies to a block container, so it survived sanitization and
  // aligned nothing. Keeping it made the list promise something no reader could
  // deliver, and made a change to it show up in the versions differ as an edit
  // no visitor could see. Aligning a paragraph is the paragraph's own property.
  "vertical-align",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "white-space",
  "text-transform",
  "opacity",
] as const;

const ALLOWED: ReadonlySet<string> = new Set(INLINE_STYLE_PROPERTIES);

/**
 * What each format bit already decides, and therefore what a style may not.
 *
 * A stored node can carry BOTH — `BOLD` with `font-weight: normal` is what a
 * paste from a word processor looks like, and the two are a contradiction the
 * document does not resolve. Whichever is written closer to the text wins, so
 * the answer would otherwise be decided by markup nesting: the CMS puts the
 * style outside the `<strong>` and keeps the bold, this package puts it inside
 * so an author's colour can beat `<mark>`, and the same stored value would
 * render bold on one surface and not on the other.
 *
 * Resolved here instead, once, by the PROPERTY rather than by the nesting. The
 * format bit is an act — a button pressed on this selection — where the style
 * string is whatever the document arrived carrying, so the bit wins and the
 * declaration it contradicts is dropped.
 *
 * `font-size` is deliberately NOT owned by the subscript bits. `<sub>` shrinks
 * its text as a side effect of being a subscript, and an author who then sets a
 * size has chosen that size; the POSITION is what makes it a subscript, and
 * that is `vertical-align`.
 */
const FORMAT_OWNED: readonly {
  flag: (typeof TEXT_FORMAT)[keyof typeof TEXT_FORMAT];
  properties: readonly string[];
}[] = [
  { flag: TEXT_FORMAT.BOLD, properties: ["font-weight"] },
  { flag: TEXT_FORMAT.ITALIC, properties: ["font-style"] },
  {
    flag: TEXT_FORMAT.UNDERLINE,
    properties: ["text-decoration", "text-decoration-line"],
  },
  {
    flag: TEXT_FORMAT.STRIKETHROUGH,
    properties: ["text-decoration", "text-decoration-line"],
  },
  { flag: TEXT_FORMAT.SUBSCRIPT, properties: ["vertical-align"] },
  { flag: TEXT_FORMAT.SUPERSCRIPT, properties: ["vertical-align"] },
];

/**
 * The properties on this list whose value is a colour.
 *
 * Separated because a colour is the one kind of value here that can be CHECKED.
 * `cssColor` decides it exactly, which lets a declaration be judged on what it
 * says rather than on where it sits — see {@link readInlineStyle} for why that
 * matters to a fallback chain.
 */
const COLOR_VALUED: ReadonlySet<string> = new Set([
  "color",
  "background-color",
  "text-decoration-color",
]);

/**
 * A declaration with any `!important` taken off it.
 *
 * STRIPPED rather than refused, and it has to be one or the other. React sets a
 * style property through `CSSStyleDeclaration`, which rejects a value carrying
 * an embedded priority and leaves the property UNSET — while server rendering
 * writes the string out and it applies. So the same document renders one way
 * from the server and another once the client mounts, which is exactly the
 * divergence this module exists to remove.
 *
 * Stripping keeps the author's declaration and costs only the priority, which
 * an inline style barely needs: it already outranks every stylesheet rule that
 * is not itself `!important`. Refusing would drop the colour entirely.
 */
function withoutPriority(declared: string): string {
  return declared.replace(/\s*!\s*important\s*$/i, "").trim();
}

/** The properties an active format bit has already decided. */
function ownedByFormat(format: number | undefined): ReadonlySet<string> {
  const owned = new Set<string>();
  if (format === undefined) return owned;
  for (const entry of FORMAT_OWNED) {
    if (!hasFormat(format, entry.flag)) continue;
    for (const property of entry.properties) owned.add(property);
  }
  return owned;
}

/**
 * Whether a property name is one this format carries.
 *
 * Case- and space-insensitive, because the name arrives from stored text: a
 * document written elsewhere may spell it `Font-Size` or leave a space before
 * the colon, and both are the same declaration to a browser.
 */
export function isInlineStyleProperty(name: unknown): boolean {
  return typeof name === "string" && ALLOWED.has(name.trim().toLowerCase());
}

/**
 * The declarations of a stored inline style that are safe to put on a page.
 *
 * A MAP rather than a string, because that is the shape both other views want:
 * the renderer turns it into a style object and the CMS joins it back into
 * text. Insertion order is the order they were written, so the later of two
 * declarations for one property wins exactly as it would in a stylesheet.
 *
 * Everything that is not understood is DROPPED rather than refused: a stored
 * style is not a request, it is what an old document happens to contain, and
 * one unreadable declaration must not take an author's colour with it.
 */
/**
 * One declaration, as the pair it contributes — or nothing, if it contributes.
 *
 * Separated from the walk because the walk is bookkeeping and this is the whole
 * decision: everything about whether a stored declaration may reach a page is
 * here, in the order the reasons apply.
 */
function usableDeclaration(
  text: string,
  owned: ReadonlySet<string>
): readonly [string, string] | undefined {
  // `indexOf` rather than `split`, because a value may contain a colon of its
  // own — `background-color: rgb(0 0 0 / 50%)` does not, but a `font-family`
  // naming a source with one would, and splitting would truncate it.
  const colon = text.indexOf(":");
  if (colon === -1) return undefined;

  const property = text.slice(0, colon).trim().toLowerCase();
  const declared = withoutPriority(text.slice(colon + 1).trim());
  if (declared === "" || !ALLOWED.has(property)) return undefined;
  // See {@link FORMAT_OWNED}: the bit is an act, the style is baggage.
  if (owned.has(property)) return undefined;
  /*
   * A colour is CHECKED, not merely carried, and that is what makes a fallback
   * chain survive. `color: red; color: not-a-color` renders red in a browser,
   * because the second declaration is discarded when it is parsed — so keeping
   * the later one on position alone loses the colour the author would see, and
   * the CMS used to emit both and get this right.
   *
   * Judging the VALUE recovers it for every property whose value this package
   * can decide, and only a colour qualifies today: the rest of the list takes
   * lengths, keywords and shorthands whose validity is a CSS property database,
   * not something to guess at here. For those the later declaration still wins,
   * which is what a browser does whenever the later one is valid.
   */
  if (COLOR_VALUED.has(property) && cssColor(declared) === undefined) {
    return undefined;
  }
  // The same guard the colours cross, and for the same reason: this string
  // reaches a `style` attribute, where a `;` ends the declaration and starts
  // another, and a `url()` fetches.
  if (hasCssInjection(declared)) return undefined;
  return [property, declared];
}

export function readInlineStyle(
  value: unknown,
  format?: number
): ReadonlyMap<string, string> {
  const kept = new Map<string, string>();
  if (typeof value !== "string" || value === "") return kept;

  const normalized = normalizeCssValue(value);
  if (normalized === "") return kept;

  const owned = ownedByFormat(format);
  for (const declaration of normalized.split(";")) {
    const usable = usableDeclaration(declaration.trim(), owned);
    if (usable === undefined) continue;
    // DELETED before it is set again, because `Map.set` on an existing key
    // replaces the value and leaves the key where it first appeared. The later
    // declaration would then be emitted in the earlier one's POSITION, and
    // position is meaning here: a shorthand written after a longhand resets it,
    // so a winner emitted ahead of that shorthand loses to it. Keeping the
    // winner's own place is what makes the emitted text cascade the way the
    // stored text did.
    kept.delete(usable[0]);
    kept.set(usable[0], usable[1]);
  }
  return kept;
}

/**
 * A stored inline style as the declaration text a serializer emits.
 *
 * DERIVED from {@link readInlineStyle} rather than parsed again. Two passes over
 * one string agree on the day they are written; this one cannot disagree with
 * the map the renderer draws from, because it is that map.
 */
export function sanitizeInlineStyle(value: unknown, format?: number): string {
  return [...readInlineStyle(value, format)]
    .map(([property, declared]) => `${property}:${declared}`)
    .join(";");
}
