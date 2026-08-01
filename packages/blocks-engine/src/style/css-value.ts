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
  | "too-deeply-nested"
  | "not-a-length"
  | "not-a-color";

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
const UNSAFE_URL_CHARS = /["'()\\<>]/;

/**
 * True when a URL contains a control character. A URL parser strips these
 * before reading the scheme, so `java\tscript:` becomes `javascript:` in the
 * browser while looking like a scheme-less path to a check that does not.
 * Refused outright rather than stripped: a URL carrying a control character is
 * malformed however it was meant.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Keywords every property accepts, whatever its value type.
 * Property-specific keywords (`auto` on a margin, `thin` on a border width)
 * are declared by the catalog entry, because a keyword one property accepts is
 * discarded by the browser on another: `margin: auto` is meaningful and
 * `padding: auto` is not.
 */
const CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

/**
 * CSS length units. A `Dimension` node carries any unit at all, so an angle, a
 * duration, a resolution or a grid fraction reaches a length property looking
 * structurally identical to `16px`; only these are measurements of distance.
 */
const LENGTH_UNITS: ReadonlySet<string> = new Set([
  "px",
  "cm",
  "mm",
  "q",
  "in",
  "pt",
  "pc",
  "em",
  "rem",
  "ex",
  "rex",
  "ch",
  "rch",
  "ic",
  "ric",
  "cap",
  "rcap",
  "lh",
  "rlh",
  "vw",
  "vh",
  "vi",
  "vb",
  "vmin",
  "vmax",
  "svw",
  "svh",
  "svi",
  "svb",
  "svmin",
  "svmax",
  "lvw",
  "lvh",
  "lvi",
  "lvb",
  "lvmin",
  "lvmax",
  "dvw",
  "dvh",
  "dvi",
  "dvb",
  "dvmin",
  "dvmax",
  "cqw",
  "cqh",
  "cqi",
  "cqb",
  "cqmin",
  "cqmax",
]);

/**
 * Functions that can produce a length. Bounded on purpose: treating every
 * function as a measurement would accept `rotate(20deg)` or `rgb(1 2 3)` as a
 * width. `var()` and `env()` are included because what they resolve to is not
 * knowable here, and refusing them would break token references.
 */
const DIMENSION_FUNCTIONS: ReadonlySet<string> = new Set([
  "calc",
  "min",
  "max",
  "clamp",
  "round",
  "mod",
  "rem",
  "abs",
  "sign",
  "var",
  "env",
  "fit-content",
  "anchor-size",
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

/**
 * Functions that take a URL as a plain string rather than inside `url()`.
 * An image source is `<url> | <string>`, so `image("a.png")` and
 * `image-set("a.png" 1x)` both load that string as an image and need the same
 * scheme allowlist, even though the parser gives them no `Url` node.
 */
const URL_STRING_FUNCTIONS: ReadonlySet<string> = new Set([
  "image",
  "image-set",
  "-webkit-image-set",
  "src",
]);

/** The first refused URL anywhere in a parsed value, or `null`. */
function nestedUrlRejection(ast: CssNode): CssValueRejection | null {
  let rejection: CssValueRejection | null = null;
  walk(ast, {
    enter(node: CssNode) {
      if (node.type === "Url") {
        rejection ??= checkUrlValue(node.value);
        return;
      }
      if (
        node.type !== "Function" ||
        !URL_STRING_FUNCTIONS.has(node.name.toLowerCase())
      ) {
        return;
      }
      for (const child of node.children) {
        if (child.type !== "String") continue;
        rejection ??= checkUrlValue(child.value);
      }
    },
  });
  return rejection;
}

/**
 * Maximum bracket nesting in one value. Parsing and walking a value are both
 * recursive, so a deeply nested value exhausts the stack — measured, a few
 * hundred nested `calc()` calls is enough, well inside any document size limit.
 * Counting brackets first is iterative and cannot itself overflow.
 */
const MAX_VALUE_NESTING = 32;

/** Deepest bracket nesting in a value. */
function nestingDepth(value: string): number {
  let depth = 0;
  let deepest = 0;
  for (const character of value) {
    // Square brackets nest the parser and walker exactly as parentheses do —
    // counting only one of them leaves the other free to exhaust the stack.
    if (character === "(" || character === "[") {
      depth += 1;
      if (depth > deepest) deepest = depth;
    } else if (character === ")" || character === "]") {
      depth -= 1;
    }
  }
  return deepest;
}

/**
 * Check a CSS value for parseability and unsafe characters. Returns `null` when
 * the value is safe to emit.
 */
export function checkCssValue(value: string): CssValueRejection | null {
  if (value.trim() === "") return "unparsable";
  if (UNSAFE_VALUE_CHARS.test(value)) return "unsafe-characters";
  if (nestingDepth(value) > MAX_VALUE_NESTING) return "too-deeply-nested";
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
export function checkDimensionValue(
  value: string,
  keywords: readonly string[] = []
): CssValueRejection | null {
  const rejection = checkCssValue(value);
  if (rejection !== null) return rejection;
  const ast = parseValue(value);
  if (ast === null || ast.type !== "Value") return "not-a-length";
  const allowed = new Set(keywords.map(keyword => keyword.toLowerCase()));
  let sawMeasurement = false;
  for (const child of ast.children) {
    if (child.type === "Operator") continue;
    const childRejection = measurementRejection(child, false, allowed);
    if (childRejection !== null) return childRejection;
    sawMeasurement = true;
  }
  return sawMeasurement ? null : "not-a-length";
}

/**
 * Whether one node can contribute to a length. `insideFunction` relaxes the
 * bare-number rule, because a plain number is a legal multiplier inside a math
 * function (`calc(2 * 1px)`) while meaning nothing on its own.
 */
function measurementRejection(
  node: CssNode,
  insideFunction: boolean,
  keywords: ReadonlySet<string>
): CssValueRejection | null {
  switch (node.type) {
    case "Dimension":
      return LENGTH_UNITS.has(node.unit.toLowerCase()) ? null : "not-a-length";
    case "Percentage":
      return null;
    case "Number":
      return insideFunction || Number(node.value) === 0 ? null : "not-a-length";
    case "Identifier": {
      const name = node.name.toLowerCase();
      return CSS_WIDE_KEYWORDS.has(name) || keywords.has(name)
        ? null
        : "not-a-length";
    }
    case "Operator":
      return null;
    case "Function": {
      const name = node.name.toLowerCase();
      if (!DIMENSION_FUNCTIONS.has(name)) return "not-a-length";
      // What a custom property or an environment variable resolves to is not
      // knowable here, and their arguments include an arbitrary fallback, so
      // their contents are not inspected.
      if (name === "var" || name === "env") return null;
      for (const child of node.children) {
        const childRejection = measurementRejection(child, true, keywords);
        if (childRejection !== null) return childRejection;
      }
      return null;
    }
    default:
      return "not-a-length";
  }
}

/**
 * Colour keywords: the CSS named colours, which are a closed set, plus the
 * keywords that stand in for one.
 */
const COLOR_KEYWORDS: ReadonlySet<string> = new Set(
  `transparent currentcolor inherit initial unset revert revert-layer
   aliceblue antiquewhite aqua aquamarine azure beige bisque black
   blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse
   chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
   darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
   darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
   darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink
   deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
   fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey
   honeydew hotpink indianred indigo ivory khaki lavender lavenderblush
   lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow
   lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
   lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime
   limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid
   mediumpurple mediumseagreen mediumslateblue mediumspringgreen
   mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
   navajowhite navy oldlace olive olivedrab orange orangered orchid
   palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff
   peru pink plum powderblue purple rebeccapurple red rosybrown royalblue
   saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
   slateblue slategray slategrey snow springgreen steelblue tan teal thistle
   tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(
    /\s+/
  )
);

/** A hex colour: three, four, six, or eight hexadecimal digits after the `#`. */
const HEX_COLOR = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Functions that produce a colour. */
const COLOR_FUNCTIONS: ReadonlySet<string> = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
  "light-dark",
  "device-cmyk",
  "var",
  "env",
]);

/**
 * Check a value for a property that takes a colour. Everything
 * `checkCssValue` checks, plus the requirement that what was written is a
 * colour: `"16px"` and `"rotate(2deg)"` are valid CSS values that a browser
 * discards when given as a colour.
 *
 * Which colour a function actually produces is not checked — the argument
 * grammar of `oklch()` and friends moves faster than any data available here,
 * and that is the same reason grammar matching is not used anywhere in this
 * module.
 */
export function checkColorValue(value: string): CssValueRejection | null {
  const rejection = checkCssValue(value);
  if (rejection !== null) return rejection;
  const ast = parseValue(value);
  if (ast === null || ast.type !== "Value") return "not-a-color";
  const parts = [...ast.children].filter(node => node.type !== "Operator");
  const node = parts[0];
  if (parts.length !== 1 || node === undefined) return "not-a-color";
  switch (node.type) {
    // A hex literal. The parser accepts any token after `#`, so the digits and
    // the length are checked here rather than assumed.
    case "Hash":
      return HEX_COLOR.test(node.value) ? null : "not-a-color";
    case "Identifier":
      return COLOR_KEYWORDS.has(node.name.toLowerCase()) ? null : "not-a-color";
    case "Function":
      return COLOR_FUNCTIONS.has(node.name.toLowerCase())
        ? null
        : "not-a-color";
    default:
      return "not-a-color";
  }
}

/**
 * Check a URL destined for `url()`. Returns `null` when it is safe to emit.
 */
export function checkUrlValue(value: string): CssValueRejection | null {
  if (value.trim() === "") return "unsafe-url-scheme";
  // Control characters come first: they are what would let a scheme hide from
  // the check below while a browser still reads it.
  if (hasControlCharacter(value)) return "unsafe-url-characters";
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
