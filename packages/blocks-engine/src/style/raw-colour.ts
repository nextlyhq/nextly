/**
 * Raw colours: colour values written into a document as themselves rather than
 * through a site variable.
 *
 * A variable carries a light and a dark value and the site sheet switches
 * between them. A colour written as a value has one value only, so it stays
 * the same when a visitor's device prefers dark, which is why the editor marks
 * it "not adapted to dark mode" and offers a variable instead.
 *
 * @module style/raw-colour
 */
import type { StyleValue } from "../document";

import {
  asciiLower,
  isCssWideKeyword,
  referencesCustomProperty,
} from "./css-value";

/**
 * Keywords a colour property takes that name no colour of their own: they
 * borrow one from the text colour, from the parent or from nothing.
 */
const BORROWED_COLOUR_KEYWORDS: ReadonlySet<string> = new Set([
  "currentcolor",
  "transparent",
  "none",
]);

/**
 * Whether a colour value is written as a colour rather than through a
 * variable.
 *
 * Asked of what a colour control holds, so any text that is not a borrowed or
 * CSS-wide keyword and reads no custom property is a colour of its own. A
 * `var()` anywhere in it, a `color-mix()` over one included, follows whatever
 * that property resolves to, so it is not flagged.
 */
export function isRawColour(value: StyleValue | undefined): boolean {
  // A `$token` reference is an object, and a number is no colour.
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (text === "") return false;
  const word = asciiLower(text);
  if (isCssWideKeyword(word) || BORROWED_COLOUR_KEYWORDS.has(word)) {
    return false;
  }
  // `light-dark()` names a value for each mode itself, so the page's scheme
  // chooses between them as a variable's dark value would.
  if (MODE_AWARE.test(word)) return false;
  return !referencesCustomProperty(text);
}

/** A colour function that holds a light and a dark value of its own. */
const MODE_AWARE = /^light-dark\s*\(/;
