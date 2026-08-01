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
 * The same characters minus the parentheses, for a URL the parser has already
 * delimited. Inside `url("…")` or a quoted image-set argument the boundary is
 * the quote, so a parenthesis there is an ordinary path character that cannot
 * close the function: refusing it would reject `photo(1).png`, which is a real
 * filename shape. Quotes and backslashes stay refused, because those are what
 * the boundary is made of.
 */
const UNSAFE_QUOTED_URL_CHARS = /["'\\<>]/;

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
 *
 * A function legal on only some properties is not listed here but declared by
 * the catalog entry, exactly as a keyword is: `fit-content()` is a size, so a
 * browser honours it on `width` and discards it on `gap`.
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
  "hypot",
  "var",
  "env",
  "anchor-size",
  "attr",
]);

/**
 * The math functions, and how many comma-separated arguments each one takes.
 * `null` is one or more, which is what `min()`, `max()` and `hypot()` accept.
 *
 * Arity is listed rather than inferred because a comma and a `+` are both
 * `Operator` nodes, and reading them as interchangeable accepts `calc(1px, 2px)`
 * and `clamp(1px)` — declarations a browser discards. This is a narrow enough
 * fact to state: the arity of the math functions is settled, unlike the
 * argument grammars the module deliberately declines to model.
 */
const MATH_FUNCTION_ARITY: ReadonlyMap<string, readonly number[] | null> =
  new Map([
    ["calc", [1]],
    ["abs", [1]],
    ["min", null],
    ["max", null],
    // The square root of the sum of squares, over as many terms as given.
    ["hypot", null],
    ["clamp", [3]],
    ["mod", [2]],
    ["rem", [2]],
    // A rounding strategy is optional, so two arguments or three.
    ["round", [2, 3]],
  ]);

/**
 * The functions whose arguments are an arithmetic expression, where operands
 * and operators alternate. Derived from the arity map rather than listed beside
 * it, so the two cannot disagree about which functions those are: a function
 * missing from the map would otherwise be treated as arithmetic while having no
 * arity to check against.
 *
 * Everything else produces a length by its name alone and carries a grammar of
 * its own, which moves faster than anything knowable here.
 * `anchor-size(--hero width)` names an anchor and then an axis, so an
 * arithmetic reading of it refuses a value the browser honours.
 */
const MATH_FUNCTIONS: ReadonlySet<string> = new Set(MATH_FUNCTION_ARITY.keys());

/**
 * Whether an `attr()` can produce a measurement.
 *
 * Its name says nothing on its own: `attr(title)` yields a string and
 * `attr(data-angle deg)` an angle, both of which a browser discards where a
 * length belongs. The token after the attribute name is what decides it, and
 * no token at all means a string whatever the attribute holds.
 */
function attrProducesDimension(node: CssNode): boolean {
  if (node.type !== "Function") return false;
  const [first] = splitArguments(node.children);
  const declared = first?.[1];
  if (declared === undefined) return false;
  // `type(<syntax>)` names a syntax this module does not model; abstaining is
  // the same answer it gives everywhere else it cannot read a grammar.
  if (declared.type === "Function") return true;
  return (
    declared.type === "Identifier" &&
    LENGTH_UNITS.has(asciiLower(declared.name))
  );
}

/** Split a function's children on its top-level commas. */
function splitArguments(children: Iterable<CssNode>): CssNode[][] {
  const args: CssNode[][] = [[]];
  for (const child of children) {
    // Only a comma separates arguments. An arithmetic operator carries its
    // surrounding whitespace in the same node, which is why this compares the
    // trimmed text rather than the raw value.
    if (child.type === "Operator" && child.value.trim() === ",") {
      args.push([]);
      continue;
    }
    args[args.length - 1]?.push(child);
  }
  return args;
}

/**
 * CSS whitespace, which is narrower than JavaScript's `\s`: that also matches
 * NO-BREAK SPACE and the Unicode spaces, and the CSS parser does not. It keeps
 * those inside the identifier, so `block\u00a0` is a single token the browser
 * discards rather than `block` with something trimmable after it. Normalising
 * with `\s` would therefore accept a value that never renders.
 */
const CSS_WHITESPACE = /[ \t\r\n\f]+/;
const CSS_WHITESPACE_EDGES = /^[ \t\r\n\f]+|[ \t\r\n\f]+$/g;

/** A value with only CSS whitespace removed from either end. */
export function trimCssWhitespace(value: string): string {
  return value.replace(CSS_WHITESPACE_EDGES, "");
}

/** A value split on CSS whitespace, with no empty parts. */
export function splitCssWhitespace(value: string): string[] {
  const trimmed = trimCssWhitespace(value);
  return trimmed === "" ? [] : trimmed.split(CSS_WHITESPACE);
}

/**
 * Lowercase the ASCII letters and nothing else.
 *
 * CSS folds identifier case for A–Z only, while JavaScript's `toLowerCase` is
 * Unicode-aware and maps U+212A KELVIN SIGN to `k`. Folding with it would match
 * `blocK` against `block` here while the browser keeps them distinct
 * identifiers and discards the declaration, so every identifier comparison in
 * this module and the validator uses this instead.
 */
export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, letter => letter.toLowerCase());
}

/** True when a value is one of the keywords legal on every CSS property. */
export function isCssWideKeyword(value: string): boolean {
  return CSS_WIDE_KEYWORDS.has(asciiLower(value));
}

/**
 * Identifiers that belong to a specific math function's grammar. In
 * `round(up, …)` the keyword is an argument rather than a property value, which
 * is why it is listed per function instead of being allowed everywhere or
 * nowhere. Only the math functions have their arguments read, so only they need
 * an entry here.
 */
const FUNCTION_IDENTIFIERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["round", new Set(["up", "down", "to-zero", "nearest"])],
]);

/**
 * The numeric constants CSS defines for math expressions. They are operands
 * rather than property values, so they are legal inside any math function and
 * nowhere else: `calc(pi * 1px)` is a length, while a bare `pi` is not.
 */
/**
 * Math functions whose result is a number rather than a length. Legal only as
 * an operand inside arithmetic that goes on to produce one — `sqrt(4) * 1px` is
 * a length while `sqrt(4)` alone is not a width. The angle-returning inverses
 * are absent: they satisfy no leaf this module validates.
 */
const NUMBER_FUNCTION_ARITY: ReadonlyMap<string, readonly number[]> = new Map([
  ["sqrt", [1]],
  ["exp", [1]],
  ["sign", [1]],
  ["sin", [1]],
  ["cos", [1]],
  ["tan", [1]],
  ["pow", [2]],
  // An optional base.
  ["log", [1, 2]],
]);

const NUMBER_FUNCTIONS: ReadonlySet<string> = new Set(
  NUMBER_FUNCTION_ARITY.keys()
);

/**
 * What each number-producing function will take.
 *
 * `sqrt()` and friends are defined over bare numbers; the trigonometric ones
 * take an angle or a number, which is why `sin(45deg)` is a value and
 * `sin(1px)` is not; and `sign()` reports which side of zero its argument
 * falls whatever the argument is made of. One rule for all of them refused two
 * of the three.
 */
type NumericDomain = "number" | "angleOrNumber" | "any";

const NUMBER_FUNCTION_DOMAIN: ReadonlyMap<string, NumericDomain> = new Map([
  ["sqrt", "number"],
  ["exp", "number"],
  ["pow", "number"],
  ["log", "number"],
  ["sin", "angleOrNumber"],
  ["cos", "angleOrNumber"],
  ["tan", "angleOrNumber"],
  ["sign", "any"],
]);

/** Units that measure an angle. */
const ANGLE_UNITS: ReadonlySet<string> = new Set([
  "deg",
  "grad",
  "rad",
  "turn",
]);

const CALC_CONSTANTS: ReadonlySet<string> = new Set([
  "pi",
  "e",
  "infinity",
  "-infinity",
  "nan",
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

/**
 * The first refused URL anywhere in a parsed value, or `null`.
 *
 * The walk is recursive, so it is wrapped: the depth cap ahead of it is what
 * keeps the recursion bounded, and if a value ever gets past that cap the
 * honest answer is to refuse it rather than let an exception escape a
 * validator. Failing closed costs a value that was already at the limit; the
 * alternative turns a document write into a server error.
 */
function nestedUrlRejection(ast: CssNode): CssValueRejection | null {
  try {
    return walkForUrlRejection(ast);
  } catch {
    return "too-deeply-nested";
  }
}

function walkForUrlRejection(ast: CssNode): CssValueRejection | null {
  let rejection: CssValueRejection | null = null;
  walk(ast, {
    enter(node: CssNode) {
      if (node.type === "Url") {
        rejection ??= checkUrlValue(node.value, "quoted");
        return;
      }
      if (
        node.type !== "Function" ||
        !URL_STRING_FUNCTIONS.has(asciiLower(node.name))
      ) {
        return;
      }
      for (const child of node.children) {
        if (child.type !== "String") continue;
        rejection ??= checkUrlValue(child.value, "quoted");
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

/** True when a stored string is longer than any declaration should carry. */
export function isOverlongValue(value: string): boolean {
  return value.length > MAX_VALUE_LENGTH;
}

/**
 * Longest value that will be parsed. Nesting is not the only way to make an
 * expensive parse: a flat value of a few hundred thousand tokens builds an AST
 * node for each. No real declaration approaches this.
 */
const MAX_VALUE_LENGTH = 8192;

/**
 * Deepest bracket nesting in a value.
 *
 * Counted the way the parser reads the text, not by tallying raw characters. A
 * backslash escapes whatever follows it, so `\)` is an ordinary character
 * inside an identifier and closes nothing; a bracket inside a quoted string is
 * likewise just text. A counter blind to either reads a closer that is not
 * there, undercounts the depth, and lets a value through that then exhausts the
 * stack while being walked — which is a crash rather than a rejection, on
 * input a stranger can write.
 */
function nestingDepth(value: string): number {
  let depth = 0;
  let deepest = 0;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") {
      // Skip the escaped character itself, whatever it is.
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
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
  // The size cap goes first because it is the only constant-time check here:
  // trimming an oversized string scans and copies all of it before anything
  // decides the value was never going to be read.
  if (value.length > MAX_VALUE_LENGTH) return "too-long";
  if (value.trim() === "") return "unparsable";
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
  /** Functions this property accepts beyond the universally legal ones. */
  functions?: readonly string[];
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
    functions = [],
  } = rules;
  const rejection = checkCssValue(value);
  if (rejection !== null) return rejection;
  const ast = parseValue(value);
  if (ast === null || ast.type !== "Value") return "not-a-length";
  const allowed = new Set(keywords.map(keyword => asciiLower(keyword)));
  const allowedFunctions = new Set(functions.map(fnName => asciiLower(fnName)));
  let parts = 0;
  let cssWideKeyword = false;
  for (const child of ast.children) {
    // No length property takes an operator at the top level. Corner radii are
    // expressed per corner instead, which is also the only form that flips with
    // writing direction.
    if (child.type === "Operator") return "not-a-length";
    const childRejection = measurementRejection(child, false, allowed, {
      allowNegative,
      allowPercentage,
      functions: allowedFunctions,
    });
    if (childRejection !== null) return childRejection;
    if (child.type === "Identifier" && isCssWideKeyword(child.name)) {
      cssWideKeyword = true;
    }
    parts += 1;
    // A shorthand may carry several measurements; a scalar property may not,
    // and a browser discards the whole declaration when it does.
    if (parts > maxParts) return "not-a-length";
  }
  // A CSS-wide keyword is a complete declaration by itself. Beside anything
  // else it is not one half of a valid value, it voids the whole declaration,
  // so `inherit 1px` and `1px unset` paint nothing at all.
  if (cssWideKeyword && parts !== 1) return "not-a-length";
  return parts > 0 ? null : "not-a-length";
}

/**
 * Whether one node can contribute to a length. `insideFunction` relaxes the
 * bare-number rule, because a plain number is a legal multiplier inside a math
 * function (`calc(2 * 1px)`) while meaning nothing on its own.
 */
interface MeasurementLimits {
  allowNegative: boolean;
  allowPercentage: boolean;
  /** Functions the property accepts beyond the universally legal ones. */
  functions?: ReadonlySet<string>;
  /**
   * Set while reading the arguments of a number-producing function, naming what
   * that function will take. Absent means an ordinary length context.
   */
  domain?: NumericDomain;
}

function measurementRejection(
  node: CssNode,
  insideFunction: boolean,
  keywords: ReadonlySet<string>,
  limits: MeasurementLimits = {
    allowNegative: true,
    allowPercentage: true,
  }
): CssValueRejection | null {
  switch (node.type) {
    case "Dimension": {
      const unit = asciiLower(node.unit);
      if (limits.domain === "number") return "not-a-length";
      if (limits.domain === "angleOrNumber") {
        return ANGLE_UNITS.has(unit) ? null : "not-a-length";
      }
      if (limits.domain === "any") return null;
      if (!LENGTH_UNITS.has(unit)) return "not-a-length";
      return limits.allowNegative || !String(node.value).startsWith("-")
        ? null
        : "not-a-length";
    }
    case "Percentage":
      if (limits.domain === "any") return null;
      if (limits.domain !== undefined) return "not-a-length";
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
        const inner = asciiLower(node.name);
        return CALC_CONSTANTS.has(inner) || keywords.has(inner)
          ? null
          : "not-a-length";
      }
      const name = asciiLower(node.name);
      return CSS_WIDE_KEYWORDS.has(name) || keywords.has(name)
        ? null
        : "not-a-length";
    }
    case "Operator":
      return null;
    case "Function": {
      const name = asciiLower(node.name);
      if (
        !DIMENSION_FUNCTIONS.has(name) &&
        limits.functions?.has(name) !== true &&
        !(insideFunction && NUMBER_FUNCTIONS.has(name))
      ) {
        return "not-a-length";
      }
      if (name === "attr" && !attrProducesDimension(node)) {
        return "not-a-length";
      }
      // Outside the math functions the name is the whole signal. What `var()`
      // and `env()` resolve to is not knowable here and their arguments carry
      // an arbitrary fallback; `anchor-size()` and `fit-content()` have
      // argument grammars of their own. Reading any of them arithmetically
      // refuses valid values, and the characters that would make an argument
      // dangerous were already refused for the value as a whole.
      if (NUMBER_FUNCTIONS.has(name)) {
        // Allowlisted by name is not the same as unchecked: these have settled
        // arities, and all but `sign()` take a bare number, so a measurement
        // inside one is a value the browser discards.
        const numberArity = NUMBER_FUNCTION_ARITY.get(name) ?? [1];
        const numberArgs = splitArguments(node.children);
        if (!numberArity.includes(numberArgs.length)) return "not-a-length";
        for (const arg of numberArgs) {
          const rejection = alternationRejection(arg, NO_KEYWORDS, {
            allowNegative: true,
            allowPercentage: false,
            functions: limits.functions,
            domain: NUMBER_FUNCTION_DOMAIN.get(name) ?? "number",
          });
          if (rejection !== null) return rejection;
        }
        return null;
      }
      if (!MATH_FUNCTIONS.has(name)) return null;
      const ownIdentifiers = FUNCTION_IDENTIFIERS.get(name) ?? NO_KEYWORDS;
      const args = splitArguments(node.children);
      // Present for every math function, since the set is the map's own keys.
      const arity = MATH_FUNCTION_ARITY.get(name) ?? null;
      if (arity !== null && !arity.includes(args.length)) {
        return "not-a-length";
      }
      for (const arg of args) {
        // Inside a math function the sign of any one term says nothing about
        // the sign of the result, so the non-negative rule does not apply. The
        // property's keywords are dropped: `auto` is a whole value, not an
        // operand, and `calc(auto)` is discarded by the browser.
        const rejection = alternationRejection(arg, ownIdentifiers, {
          allowNegative: true,
          allowPercentage: limits.allowPercentage,
          functions: limits.functions,
          domain: limits.domain,
        });
        if (rejection !== null) return rejection;
      }
      return null;
    }
    case "Parentheses":
      // Grouping is part of math-expression syntax, not of a value: `(1px)`
      // standing alone is discarded by the browser, while inside a function an
      // explicitly grouped term is an operand whose contents follow the same
      // rules, so `calc((1px + 2px) * 3)` is a length like its ungrouped form.
      if (!insideFunction) return "not-a-length";
      return alternationRejection([...node.children], keywords, limits);
    default:
      return "not-a-length";
  }
}

/**
 * Whether one arithmetic expression alternates correctly: operands and
 * operators in turn, starting and ending on an operand.
 *
 * css-tree will happily build a tree for `calc(1px,)`, `calc(/ 1px)`,
 * `calc(1px 2px)` and `calc()`; a browser discards them all. An even count is an
 * empty expression or a trailing operator, while a lone operand such as
 * `abs(1px)` is valid alternation.
 *
 * One function for both callers because a math function's argument and a
 * parenthesised group are the same thing grammatically, and a rule that lives
 * in two places is a rule that will hold in one of them.
 */
function alternationRejection(
  terms: readonly CssNode[],
  keywords: ReadonlySet<string>,
  limits: MeasurementLimits
): CssValueRejection | null {
  if (terms.length === 0 || terms.length % 2 === 0) return "not-a-length";
  for (let index = 0; index < terms.length; index += 1) {
    const expectingOperator = index % 2 === 1;
    const term = terms[index];
    if (term === undefined) return "not-a-length";
    if ((term.type === "Operator") !== expectingOperator) {
      return "not-a-length";
    }
    if (expectingOperator) continue;
    const rejection = measurementRejection(term, true, keywords, limits);
    if (rejection !== null) return rejection;
  }
  return null;
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
  "contrast-color",
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
  // A colour is exactly one term. No colour syntax takes an operator at this
  // level — the commas and slashes inside `rgb()` and `color-mix()` sit within
  // the function — so an operator here means the browser discards the whole
  // declaration, as it does for `red,` and `/ red`. Counting every child rather
  // than filtering the operators out is what makes that refusal happen.
  const parts = [...ast.children];
  const node = parts[0];
  if (parts.length !== 1 || node === undefined) return "not-a-color";
  switch (node.type) {
    // A hex literal. The parser accepts any token after `#`, so the digits and
    // the length are checked here rather than assumed.
    case "Hash":
      return HEX_COLOR.test(node.value) ? null : "not-a-color";
    case "Identifier": {
      const name = asciiLower(node.name);
      return COLOR_KEYWORDS.has(name) || SYSTEM_COLORS.has(name)
        ? null
        : "not-a-color";
    }
    case "Function":
      return COLOR_FUNCTIONS.has(asciiLower(node.name)) ? null : "not-a-color";
    default:
      return "not-a-color";
  }
}

/**
 * Where a URL was read from, which decides what can still break out of it.
 * `raw` is a stored value that will be wrapped in `url(...)` on the way out;
 * `quoted` is one the parser has already delimited for us.
 */
type UrlContext = "raw" | "quoted";

/**
 * Check a URL destined for `url()`. Returns `null` when it is safe to emit.
 */
export function checkUrlValue(
  value: string,
  context: UrlContext = "raw"
): CssValueRejection | null {
  // A dedicated URL property does not pass through the free-form value check,
  // so without this its own cap is the document byte limit: one stored value
  // could otherwise emit a megabyte-long declaration and request. Checked
  // first, before anything scans the string.
  if (value.length > MAX_VALUE_LENGTH) return "too-long";
  if (value.trim() === "") return "unsafe-url-scheme";
  // Control characters come first: they are what would let a scheme hide from
  // the check below while a browser still reads it.
  if (hasControlCharacter(value)) return "unsafe-url-characters";
  // The scheme is checked first because a refused scheme is the more useful
  // thing to tell an author, and a hostile URL usually trips both guards.
  const scheme = URL_SCHEME.exec(value);
  if (scheme !== null) {
    const matched = scheme[1];
    const name = matched === undefined ? undefined : asciiLower(matched);
    if (name === undefined || !ALLOWED_URL_SCHEMES.includes(name)) {
      return "unsafe-url-scheme";
    }
  }
  // Checked against the raw value, not a trimmed copy: trimming first would
  // quietly discard a trailing newline rather than refuse it, and the value
  // emitted is the one stored, not the trimmed one. No scheme at all is a
  // relative, absolute, or protocol-relative path, which resolves against the
  // page's own origin and needs no allowlisting.
  const unsafe =
    context === "quoted" ? UNSAFE_QUOTED_URL_CHARS : UNSAFE_URL_CHARS;
  if (unsafe.test(value)) return "unsafe-url-characters";
  return null;
}
