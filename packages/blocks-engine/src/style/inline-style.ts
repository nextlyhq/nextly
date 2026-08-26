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

import { hasCssInjection, normalizeCssValue } from "./css-color";

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
export function readInlineStyle(
  value: unknown,
  format?: number
): ReadonlyMap<string, string> {
  const kept = new Map<string, string>();
  if (typeof value !== "string" || value === "") return kept;
  const owned = ownedByFormat(format);

  const normalized = normalizeCssValue(value);
  if (normalized === "") return kept;

  for (const declaration of normalized.split(";")) {
    const text = declaration.trim();
    if (text === "") continue;

    // `indexOf` rather than `split`, because a value may contain a colon of its
    // own — `background-color: rgb(0 0 0 / 50%)` does not, but a `font-family`
    // naming a source with one would, and splitting would truncate it.
    const colon = text.indexOf(":");
    if (colon === -1) continue;

    const property = text.slice(0, colon).trim().toLowerCase();
    const declared = text.slice(colon + 1).trim();
    if (declared === "" || !ALLOWED.has(property)) continue;
    // See {@link FORMAT_OWNED}: the bit is an act, the style is baggage.
    if (owned.has(property)) continue;
    // The same guard the colours cross, and for the same reason: this string
    // reaches a `style` attribute, where a `;` ends the declaration and starts
    // another, and a `url()` fetches.
    if (hasCssInjection(declared)) continue;

    // DELETED before it is set again, because `Map.set` on an existing key
    // replaces the value and leaves the key where it first appeared. The later
    // declaration would then be emitted in the earlier one's POSITION, and
    // position is meaning here: `text-decoration-color:red;
    // text-decoration:underline blue; text-decoration-color:green` would come
    // back with green ahead of the shorthand, so the shorthand resets the
    // colour the author wrote last. Keeping the winner's own position is what
    // makes the emitted text cascade the way the stored text did.
    kept.delete(property);
    kept.set(property, declared);
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
