/**
 * Safety and shape checks for CSS values that reach the emitted stylesheet.
 *
 * Three things are checked, and deliberately only three:
 *
 * 1. **The value parses as a CSS value.** A value that parses cannot carry a
 *    stray `;` or `}` and so cannot escape its declaration.
 * 2. **Characters and URL schemes that survive parsing.** A quoted CSS string
 *    parses happily while containing `</style>`, and css-tree accepts a quoted
 *    `javascript:` URL, so neither is caught by parsing alone.
 * 3. **That a value declared as a length actually is one**, which generic
 *    parsing does not tell us: `"10"` and `"red"` are both well-formed CSS
 *    values and neither is a length.
 *
 * What is NOT checked is whether a value is grammatically legal for its
 * property. The reference grammar available to do that lags the CSS browsers
 * actually ship — measured against css-tree 2.3.1, it rejects `oklch()`,
 * `color-mix()`, `clamp()` and does not even know `container-type` — so using
 * it as a gate would refuse correct, current CSS. Per-property strictness comes
 * instead from the catalog's own keyword sets, which are ours to keep current.
 *
 * The parser and walker are imported by subpath rather than from css-tree's
 * root: the root entry loads that same MDN reference data, which reaches for
 * `node:module`, and the engine promises to run in browsers and edge runtimes.
 */
import type { CssNode } from "css-tree";
import parse from "css-tree/parser";
import walk from "css-tree/walker";

/** Why a value was refused. Each maps to a stable validation issue code. */
export type CssValueRejection =
  | "unparsable"
  | "unsafe-characters"
  | "unsafe-url-scheme"
  | "unsafe-url-characters"
  | "not-a-length";

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
 * Characters that would break out of `url(...)`, split the declaration across
 * lines, or close the `<style>` element the stylesheet is emitted into. Quotes
 * and parentheses can close the function early, a backslash can re-introduce
 * them through an escape, and the HTML parser honours `</style>` inside a URL
 * regardless of how the CSS quotes it.
 */
const UNSAFE_URL_CHARS = /["'()\\\n\r<>]/;

/**
 * Keywords a length-valued property may legitimately carry instead of a
 * measurement. Bounded on purpose: an identifier outside this set is far more
 * likely to be a mistake such as `"red"` than a length the catalog forgot.
 */
const DIMENSION_KEYWORDS: ReadonlySet<string> = new Set([
  "auto",
  "none",
  "normal",
  "min-content",
  "max-content",
  "fit-content",
  "stretch",
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

/** Node types that carry a measurement. */
const SIZE_NODE_TYPES: ReadonlySet<string> = new Set([
  "Dimension",
  "Percentage",
  // calc(), clamp(), min(), max(), var(), env() and anything else resolving to
  // a length at used-value time; which function it is cannot be decided here
  // without the grammar data this module deliberately does not consult.
  "Function",
]);

/** Parse a CSS value, or `null` when it is not one. */
function parseValue(value: string): CssNode | null {
  try {
    return parse(value, {
      context: "value",
      onParseError: error => {
        throw error;
      },
    });
  } catch {
    return null;
  }
}

/** The first refused URL anywhere in a parsed value, or `null`. */
function nestedUrlRejection(ast: CssNode): CssValueRejection | null {
  let rejection: CssValueRejection | null = null;
  walk(ast, {
    enter(node: CssNode) {
      if (node.type !== "Url") return;
      rejection ??= checkUrlValue(node.value);
    },
  });
  return rejection;
}

/**
 * Check a CSS value for parseability and unsafe characters. Returns `null` when
 * the value is safe to emit.
 */
export function checkCssValue(value: string): CssValueRejection | null {
  if (value.trim() === "") return "unparsable";
  if (UNSAFE_VALUE_CHARS.test(value)) return "unsafe-characters";
  const ast = parseValue(value);
  if (ast === null) return "unparsable";
  // A URL nested in a free-form value reaches the stylesheet exactly as a
  // dedicated URL property's does, and several properties emit the same CSS
  // property by either route, so both get the same allowlist. The check runs on
  // the PARSED node rather than the raw text because the parser decodes CSS
  // escapes: `url("\6a avascript:...")` arrives here as `javascript:...`, which
  // a scan of the original string would not recognise.
  return nestedUrlRejection(ast);
}

/**
 * Check a value for a property that takes a length. Everything `checkCssValue`
 * checks, plus the requirement that what was written is actually a measurement:
 * `"10"` and `"red"` parse as CSS values but emit declarations the browser
 * discards, so they are refused here where the author can still see why.
 *
 * Multi-part values are accepted, since shorthands such as a corner radius
 * legitimately carry more than one length.
 */
export function checkDimensionValue(value: string): CssValueRejection | null {
  const rejection = checkCssValue(value);
  if (rejection !== null) return rejection;
  const ast = parseValue(value);
  if (ast === null || ast.type !== "Value") return "not-a-length";
  let sawMeasurement = false;
  for (const child of ast.children) {
    if (child.type === "Operator") continue;
    if (SIZE_NODE_TYPES.has(child.type)) {
      sawMeasurement = true;
      continue;
    }
    // Zero is the one number that is a complete length on its own.
    if (child.type === "Number") {
      if (Number(child.value) !== 0) return "not-a-length";
      sawMeasurement = true;
      continue;
    }
    if (child.type === "Identifier") {
      if (!DIMENSION_KEYWORDS.has(child.name.toLowerCase())) {
        return "not-a-length";
      }
      sawMeasurement = true;
      continue;
    }
    return "not-a-length";
  }
  return sawMeasurement ? null : "not-a-length";
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
