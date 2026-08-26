/**
 * One CSS-colour policy, for every surface that puts a stored colour on a page.
 *
 * A rich-text button carries `bgColor` and `textColor` as stored text, and both
 * reach a `style` attribute: the CMS writes one by serialising to an HTML
 * string, the React renderer writes one through a style object. Neither escapes
 * a `;`, so an unchecked value does not merely style a button — it closes the
 * declaration and opens its own. A value of
 * `red;position:fixed;inset:0;background-image:url(https://example.test/x)` is
 * a full-page overlay and an outbound request, from a field an author is
 * invited to type into.
 *
 * The two surfaces have to agree, and the only way they can is to read the same
 * module. `blocks-react` may not import the CMS, and the CMS's own copy of this
 * lived in a package the renderer cannot reach — so it lives here, which both
 * already depend on.
 *
 * @module style/css-color
 */

import { checkColorValue } from "./css-value";

/**
 * Value shapes that must never reach a stylesheet, whatever else they look like.
 *
 * Checked BEFORE the colour syntax, because several of them are alphabetic and
 * would otherwise pass as named colours: `expression` is a word.
 *
 * NONE of these carries the `g` flag, and that is load-bearing rather than
 * tidiness. `RegExp.prototype.test` on a global regex resumes from `lastIndex`
 * and updates it, so one shared pattern object carries state between unrelated
 * calls. With a `g` on the backslash pattern, a value of `\x` is reported clean
 * whenever the previous call left `lastIndex` past position 1 — so the guard
 * against `\65 xpression` holding depends on call history, which is the one
 * thing a guard may not do.
 */
const CSS_INJECTION_PATTERNS: readonly RegExp[] = [
  /expression\s*\(/i, // IE CSS expression()
  /url\s*\(/i, // url() — loads an external resource, or executes a protocol
  /-moz-binding/i, // Firefox XBL binding
  /behavior\s*:/i, // IE behavior property
  /\\/, // Backslash — a CSS escape, so `\65 xpression` is `expression`
  /\/\*/, // Comment — breaks out of context, or hides a keyword inside one
  /@import/i, // Loads an external stylesheet
  /@font-face/i, // Exfiltrates via a font request
  /var\s*\(/i, // A custom property can carry an attack set up elsewhere
];

/**
 * A null byte, BUILT rather than written as a regular expression.
 *
 * A pattern for it needs `no-control-regex` suppressed, and a suppression is not
 * available: the convention forbids silencing a lint rule, and the rule is right
 * — a control character written into source is one an editor or a formatter can
 * strip, leaving a check that reads as present and matches nothing.
 * Constructing the character keeps the behaviour and needs no pattern.
 */
const NUL = String.fromCharCode(0);

/**
 * Control characters and runs of whitespace flattened out of a CSS value.
 *
 * Exported for the same reason as {@link hasCssInjection}: the CMS normalizes a
 * whole inline style string before splitting it into declarations, and a second
 * implementation of "what counts as the same value" is how one surface starts
 * accepting what the other rejects.
 */
export function normalizeCssValue(value: string): string {
  return value
    .replaceAll(NUL, "")
    .replace(/[\t\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a CSS value carries a shape that must never reach a stylesheet.
 *
 * Exported because the same list answers this for a whole inline style string
 * and not only for a colour, and a second copy is how the two answers drift.
 */
export function hasCssInjection(value: string): boolean {
  if (typeof value !== "string") return true;
  // Asked of the ORIGINAL value: normalizing strips the byte, so a check on
  // the flattened text could never see one and would read as present while
  // matching nothing.
  if (value.includes(NUL)) return true;
  const flattened = normalizeCssValue(value);
  return CSS_INJECTION_PATTERNS.some(pattern => pattern.test(flattened));
}

/**
 * A stored colour safe to write into a `style` attribute, or `undefined`.
 *
 * `undefined` rather than a substituted colour, because what a refused value
 * should become is the caller's decision and it differs: a filled button needs
 * a visible default, an outline button needs to inherit the text around it.
 */
export function cssColor(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  if (hasCssInjection(value)) return undefined;
  const trimmed = value.trim();
  /*
   * WHETHER it is a colour is `checkColorValue`'s question, not this module's.
   * That one parses the value with css-tree, decodes escapes, holds the CSS
   * named colours as the closed set they are, and knows `oklch()` and
   * `color-mix()` — where the hand-written patterns that used to be here
   * accepted any alphabetic word as a colour, `banana` included, and refused
   * every syntax added to CSS since they were written.
   *
   * The SAFETY question stays here, and is asked first. `checkColorValue`
   * accepts `var(--x)` because a custom property may legitimately hold a
   * colour; this module refuses it, because a value assembled elsewhere is
   * exactly what a stored style should not be able to pull into a page.
   */
  return checkColorValue(trimmed) === null ? trimmed : undefined;
}
