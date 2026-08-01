/**
 * Safety checks for CSS values that reach the emitted stylesheet.
 *
 * Two things are checked, and deliberately only two:
 *
 * 1. **The value parses as a CSS value.** A value that parses cannot carry a
 *    stray `;` or `}` and so cannot escape its declaration.
 * 2. **Characters and URL schemes that survive parsing but are still unsafe.**
 *    A quoted CSS string parses happily while containing `</style>`, and
 *    css-tree accepts a quoted `javascript:` URL, so neither is caught by
 *    parsing alone.
 *
 * What is NOT checked is whether a value is grammatically legal for its
 * property. The reference grammar available to do that lags the CSS browsers
 * actually ship — measured against css-tree 2.3.1, it rejects `oklch()`,
 * `color-mix()`, `clamp()` and does not even know `container-type` — so using
 * it as a gate would refuse correct, current CSS. Per-property strictness comes
 * instead from the catalog's own keyword sets, which are ours to keep current.
 */
import * as csstree from "css-tree";

/** Why a value was refused. Each maps to a stable validation issue code. */
export type CssValueRejection =
  | "unparsable"
  | "unsafe-characters"
  | "unsafe-url-scheme"
  | "unsafe-url-characters";

/**
 * Characters that must never reach a declaration, even inside a value that
 * parses. `{`, `}` and `;` would end the declaration or rule; `<` and `>` allow
 * a `</style>` sequence to close the element the stylesheet is emitted into,
 * and a quoted CSS string keeps both intact through parsing.
 */
const UNSAFE_VALUE_CHARS = /[{};<>]/;

/**
 * URL schemes allowed inside `url()`. An allowlist rather than a blocklist:
 * a blocklist has to predict every dangerous scheme, and misses the next one.
 * Relative paths, absolute paths and protocol-relative URLs carry no scheme and
 * are allowed by having none to reject.
 */
const ALLOWED_URL_SCHEMES: readonly string[] = ["http", "https"];

/** Any leading `scheme:` in a URL, tolerating the whitespace a value may carry. */
const URL_SCHEME = /^\s*([a-z][a-z0-9+.-]*):/i;

/**
 * Characters that would break out of `url(...)` or split the declaration across
 * lines. Quotes and parentheses can close the function early; a backslash can
 * re-introduce them through an escape.
 */
const UNSAFE_URL_CHARS = /["'()\\\n\r]/;

/**
 * Check a CSS value for parseability and unsafe characters. Returns `null` when
 * the value is safe to emit.
 */
export function checkCssValue(value: string): CssValueRejection | null {
  if (value.trim() === "") return "unparsable";
  if (UNSAFE_VALUE_CHARS.test(value)) return "unsafe-characters";
  try {
    csstree.parse(value, {
      context: "value",
      onParseError: error => {
        throw error;
      },
    });
  } catch {
    return "unparsable";
  }
  return null;
}

/**
 * Check a URL destined for `url()`. Returns `null` when it is safe to emit.
 */
export function checkUrlValue(value: string): CssValueRejection | null {
  if (value.trim() === "") return "unsafe-url-scheme";
  // The scheme is checked first because a refused scheme is the more useful
  // thing to tell an author, and a hostile URL usually trips both guards.
  const scheme = URL_SCHEME.exec(value);
  if (scheme !== null) {
    const name = scheme[1]?.toLowerCase();
    if (name === undefined || !ALLOWED_URL_SCHEMES.includes(name)) {
      return "unsafe-url-scheme";
    }
  }
  // Checked against the raw value, not a trimmed copy: trimming first would
  // quietly discard a trailing newline rather than refuse it, and the value
  // emitted is the one stored, not the trimmed one. No scheme at all is a
  // relative, absolute, or protocol-relative path, which resolves against the
  // page's own origin and needs no allowlisting.
  if (UNSAFE_URL_CHARS.test(value)) return "unsafe-url-characters";
  return null;
}
