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
  "text-align",
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
export function readInlineStyle(value: unknown): ReadonlyMap<string, string> {
  const kept = new Map<string, string>();
  if (typeof value !== "string" || value === "") return kept;

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
    // The same guard the colours cross, and for the same reason: this string
    // reaches a `style` attribute, where a `;` ends the declaration and starts
    // another, and a `url()` fetches.
    if (hasCssInjection(declared)) continue;

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
export function sanitizeInlineStyle(value: unknown): string {
  return [...readInlineStyle(value)]
    .map(([property, declared]) => `${property}:${declared}`)
    .join(";");
}

/**
 * The font families the editor's own toolbar offers.
 *
 * NOT enforced by the reader, and that is the decision rather than an
 * oversight: a document that arrived by import may legitimately carry a family
 * this list has never heard of, and refusing it would strip a face the CMS
 * publishes today. What the list is for is the opposite direction — holding the
 * reader to the editor, so a value an author CAN choose is never one the page
 * silently drops. `richTextInlineStyleVocabulariesAgree` in the admin is what
 * checks that, because the editor's lists live where this package cannot reach.
 */
export const RICH_TEXT_FONT_FAMILIES = [
  "Arial",
  "Courier New",
  "Georgia",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
] as const;

/** The font sizes that toolbar offers. See {@link RICH_TEXT_FONT_FAMILIES}. */
export const RICH_TEXT_FONT_SIZES = [
  "10px",
  "11px",
  "12px",
  "13px",
  "14px",
  "15px",
  "16px",
  "17px",
  "18px",
  "20px",
  "24px",
  "30px",
  "36px",
  "48px",
  "60px",
  "72px",
] as const;
