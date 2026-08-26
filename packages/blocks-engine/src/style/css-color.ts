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

const HEX_COLOR =
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const NUM = String.raw`\d{1,3}%?`;
const HUE = String.raw`[\d.]+(?:deg|rad|grad|turn)?`;
const PCT = String.raw`\d{1,3}%`;

/**
 * The syntaxes a stored colour may be written in.
 *
 * Both the comma and the space form of every function, because a browser's own
 * colour picker writes one and an imported document may carry the other.
 */
const COLOR_PATTERNS: readonly RegExp[] = [
  HEX_COLOR,
  new RegExp(`^rgb\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*\\)$`),
  new RegExp(
    `^rgb\\(\\s*${NUM}\\s+${NUM}\\s+${NUM}\\s*(?:\\/\\s*[\\d.]+%?\\s*)?\\)$`
  ),
  new RegExp(
    `^rgba\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*[\\d.]+%?\\s*\\)$`
  ),
  new RegExp(
    `^rgba\\(\\s*${NUM}\\s+${NUM}\\s+${NUM}\\s*\\/\\s*[\\d.]+%?\\s*\\)$`
  ),
  new RegExp(`^hsl\\(\\s*${HUE}\\s*,\\s*${PCT}\\s*,\\s*${PCT}\\s*\\)$`),
  new RegExp(
    `^hsl\\(\\s*${HUE}\\s+${PCT}\\s+${PCT}\\s*(?:\\/\\s*[\\d.]+%?\\s*)?\\)$`
  ),
  new RegExp(
    `^hsla\\(\\s*${HUE}\\s*,\\s*${PCT}\\s*,\\s*${PCT}\\s*,\\s*[\\d.]+%?\\s*\\)$`
  ),
  new RegExp(
    `^hsla\\(\\s*${HUE}\\s+${PCT}\\s+${PCT}\\s*\\/\\s*[\\d.]+%?\\s*\\)$`
  ),
  // A named colour. Anything alphabetic reaches here, `banana` included — an
  // unknown name is a declaration the browser drops, which is the same outcome
  // as refusing it here. The injection check above is what makes this safe.
  /^[a-zA-Z]+$/,
];

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
    .replace(NULL_BYTE, "")
    .replace(/[\t\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A null byte, which truncates the value in a downstream consumer.
 *
 * Asked of the ORIGINAL rather than of the normalized text, because normalizing
 * strips it — a pattern for it in the list above could never match, and the
 * check would read as present while testing nothing.
 */
// eslint-disable-next-line no-control-regex
const NULL_BYTE = /\x00/g;

/**
 * Whether a CSS value carries a shape that must never reach a stylesheet.
 *
 * Exported because the same list answers this for a whole inline style string
 * and not only for a colour, and a second copy is how the two answers drift.
 */
export function hasCssInjection(value: string): boolean {
  if (typeof value !== "string") return true;
  // Asked with `includes` of the ORIGINAL, for the two reasons the doc on
  // NULL_BYTE gives: `normalize` strips the byte, so a pattern for it could
  // never match, and that pattern is global — `test` on a global regex
  // resumes from the `lastIndex` its previous use left behind.
  if (value.includes("\u0000")) return true;
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
  return COLOR_PATTERNS.some(pattern => pattern.test(trimmed))
    ? trimmed
    : undefined;
}
