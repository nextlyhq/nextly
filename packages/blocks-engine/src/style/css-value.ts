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
  | "too-long"
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
 * Comment delimiters, which the parser treats as trivia and therefore accepts.
 * An unterminated comment opener emitted into a declaration swallows whatever
 * follows it, and a lone closer ends a comment the emitter opened around
 * something else. Neither belongs in a stored value.
 */
const COMMENT_DELIMITERS = /\/\*|\*\//;

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
/** No keyword is legal as a math operand. */
const NO_KEYWORDS: ReadonlySet<string> = new Set();

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
 * width. `sign()` is deliberately absent — it always yields a number, whatever
 * it is given. `var()` and `env()` are included because what they resolve to is
 * not knowable here, and refusing them would break token references.
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
  "var",
  "env",
  "fit-content",
  "anchor-size",
]);

/** True when a value is one of the keywords legal on every CSS property. */
export function isCssWideKeyword(value: string): boolean {
  return CSS_WIDE_KEYWORDS.has(value.toLowerCase());
}

/**
 * Identifiers that belong to a specific function's grammar. `round(up, …)` and
 * `anchor-size(width)` are lengths, and their keyword is an argument rather than
 * a property value, which is why they are listed per function instead of being
 * allowed everywhere or nowhere.
 */
const FUNCTION_IDENTIFIERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["round", new Set(["up", "down", "to-zero", "nearest"])],
  [
    "anchor-size",
    new Set([
      "width",
      "height",
      "block",
      "inline",
      "self-block",
      "self-inline",
    ]),
  ],
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

/**
 * Longest value that will be parsed. Nesting is not the only way to make an
 * expensive parse: a flat value of a few hundred thousand tokens builds an AST
 * node for each. No real declaration approaches this.
 */
const MAX_VALUE_LENGTH = 8192;

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
      // Floor at zero: an unbalanced leading closer would otherwise buy the
      // rest of the value that much extra depth before the cap notices.
      if (depth > 0) depth -= 1;
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
  if (value.length > MAX_VALUE_LENGTH) return "too-long";
  if (UNSAFE_VALUE_CHARS.test(value)) return "unsafe-characters";
  if (COMMENT_DELIMITERS.test(value)) return "unsafe-characters";
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
 * `maxParts` is how many measurements the property accepts: one for a scalar
 * such as `width`, more for a shorthand such as a corner radius.
 */
export interface DimensionRules {
  keywords?: readonly string[];
  maxParts?: number;
  /** Whether a negative measurement is meaningful, as it is on a margin. */
  allowNegative?: boolean;
  /** Whether a percentage resolves against anything for this property. */
  allowPercentage?: boolean;
}

export function checkDimensionValue(
  value: string,
  rules: DimensionRules = {}
): CssValueRejection | null {
  const {
    keywords = [],
    maxParts = 1,
    allowNegative = false,
    allowPercentage = false,
  } = rules;
  const rejection = checkCssValue(value);
  if (rejection !== null) return rejection;
  const ast = parseValue(value);
  if (ast === null || ast.type !== "Value") return "not-a-length";
  const allowed = new Set(keywords.map(keyword => keyword.toLowerCase()));
  let parts = 0;
  for (const child of ast.children) {
    // No length property takes an operator at the top level. Corner radii are
    // expressed per corner instead, which is also the only form that flips with
    // writing direction.
    if (child.type === "Operator") return "not-a-length";
    const childRejection = measurementRejection(child, false, allowed, {
      allowNegative,
      allowPercentage,
    });
    if (childRejection !== null) return childRejection;
    parts += 1;
    // A shorthand may carry several measurements; a scalar property may not,
    // and a browser discards the whole declaration when it does.
    if (parts > maxParts) return "not-a-length";
  }
  return parts > 0 ? null : "not-a-length";
}

/**
 * Whether one node can contribute to a length. `insideFunction` relaxes the
 * bare-number rule, because a plain number is a legal multiplier inside a math
 * function (`calc(2 * 1px)`) while meaning nothing on its own.
 */
function measurementRejection(
  node: CssNode,
  insideFunction: boolean,
  keywords: ReadonlySet<string>,
  limits: { allowNegative: boolean; allowPercentage: boolean } = {
    allowNegative: true,
    allowPercentage: true,
  }
): CssValueRejection | null {
  switch (node.type) {
    case "Dimension":
      if (!LENGTH_UNITS.has(node.unit.toLowerCase())) return "not-a-length";
      return limits.allowNegative || !String(node.value).startsWith("-")
        ? null
        : "not-a-length";
    case "Percentage":
      if (!limits.allowPercentage) return "not-a-length";
      return limits.allowNegative || !String(node.value).startsWith("-")
        ? null
        : "not-a-length";
    case "Number":
      return insideFunction || Number(node.value) === 0 ? null : "not-a-length";
    case "Identifier": {
      // Inside a function only that function's own grammar keywords are legal;
      // a property keyword is a complete value, so `calc(auto)` and
      // `calc(inherit)` are discarded while `round(up, 10px, 1px)` is not.
      if (insideFunction) {
        return keywords.has(node.name.toLowerCase()) ? null : "not-a-length";
      }
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
      const ownIdentifiers = FUNCTION_IDENTIFIERS.get(name) ?? NO_KEYWORDS;
      // Operands and operators must alternate, starting and ending on an
      // operand. css-tree will happily build a tree for `calc(1px,)`,
      // `calc(/ 1px)`, `calc(1px 2px)` and `calc()`; a browser discards them
      // all. A lone argument such as `anchor-size(width)` is valid alternation.
      const terms = [...node.children];
      for (let index = 0; index < terms.length; index += 1) {
        const expectingOperator = index % 2 === 1;
        if ((terms[index]?.type === "Operator") !== expectingOperator) {
          return "not-a-length";
        }
      }
      // An even count means either an empty function or a trailing operator.
      if (terms.length % 2 === 0) return "not-a-length";
      for (const child of node.children) {
        // Inside a math function the sign of any one term says nothing about
        // the sign of the result, so the non-negative rule does not apply. The
        // property's keywords are dropped: `auto` is a whole value, not an
        // operand, and `calc(auto)` is discarded by the browser.
        const childRejection = measurementRejection(
          child,
          true,
          ownIdentifiers,
          {
            allowNegative: true,
            allowPercentage: limits.allowPercentage,
          }
        );
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

/**
 * System colours, which resolve to the platform's own palette. They matter more
 * than their rarity suggests: forced-colors mode and high-contrast themes are
 * expressed with them, so refusing them would refuse the accessible option.
 */
const SYSTEM_COLORS: ReadonlySet<string> = new Set(
  `accentcolor accentcolortext activetext buttonborder buttonface buttontext
   canvas canvastext field fieldtext graytext highlight highlighttext linktext
   mark marktext selecteditem selecteditemtext visitedtext`.split(/\s+/)
);

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
    case "Identifier": {
      const name = node.name.toLowerCase();
      return COLOR_KEYWORDS.has(name) || SYSTEM_COLORS.has(name)
        ? null
        : "not-a-color";
    }
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
