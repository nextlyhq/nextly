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

// Shared with the URL policy rather than spelled again here. A control
// character is refused for one reason in both places — it survives no round
// trip through a stylesheet or an attribute intact — and two copies of that
// character set would drift into a value one layer accepts and the next
// rejects.
import { hasControlCharacter } from "../url-policy";

/** Why a value was refused. Each maps to a stable validation issue code. */
export type CssValueRejection =
  | "unparsable"
  | "unsafe-characters"
  | "unsafe-url-scheme"
  | "unsafe-url-characters"
  | "url-host-not-allowed"
  | "too-deeply-nested"
  | "too-long"
  | "not-a-length"
  | "not-a-color";

/**
 * Whether this site will fetch a URL, asked of every URL a stylesheet emits.
 *
 * A PREDICATE rather than a list of patterns, so the engine stays free of the
 * matching rules and the caller keeps one answer for every channel it owns. It
 * is optional everywhere it appears: a caller with no host policy asks nothing
 * and gets the scheme allowlist alone.
 */
export type MayFetchUrl = (url: string) => boolean;

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
 *
 * Having no scheme is not the same as naming no host. A relative or absolute
 * path resolves against the page's own origin, but `//cdn.example/a.png` carries
 * no scheme and still reaches ANOTHER host, inheriting only the page's protocol.
 * This list cannot tell those apart, so which hosts may be reached is a separate
 * question, asked of `mayFetchUrl` below.
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
    // A value to round and an optional interval. The strategy is stripped
    // before this is consulted, so it is not counted here.
    ["round", [1, 2]],
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
function attrProducesDimension(
  node: CssNode,
  limits: MeasurementLimits
): boolean {
  if (node.type !== "Function") return false;
  const args = splitArguments(node.children);
  // An attribute name and an optional fallback, so one argument or two, and
  // neither may be empty — `attr(x px,)` names a fallback it does not give.
  if (args.length > 2) return false;
  if (args.some(arg => arg.length === 0)) return false;
  const first = args[0];
  // The name is an identifier; `attr(1 px)` names no attribute at all.
  if (first?.[0]?.type !== "Identifier") return false;
  if (first.length > 2) return false;
  // The fallback is what the browser substitutes when the attribute is absent
  // or unreadable, so a time or a colour there emits a declaration it discards
  // exactly as the same value would written out.
  const fallback = args[1];
  if (fallback !== undefined) {
    // The fallback replaces the whole reference, so it is read as a standalone
    // value and not as an arithmetic expression: bare operators are illegal
    // here exactly as they are where the property is written out directly.
    const rejection = standaloneValueRejection(fallback, NO_KEYWORDS, {
      ...limits,
      allowNumber: false,
      maxParts: 1,
    });
    if (rejection !== null) return false;
  }
  const declared = first[1];
  if (declared === undefined) return false;
  // A functional type is not accepted at all. The only valid one is
  // `type(<syntax>)`, and its angle brackets are refused for every value
  // before this runs — they are how `</style>` closes the element a stylesheet
  // is emitted into — and css-tree cannot parse that grammar either. Accepting
  // a function here could therefore only ever admit a WRONG one, such as
  // `type(foo)`, while never admitting the right one.
  if (declared.type === "Function") return false;
  return (
    declared.type === "Identifier" && LENGTH_UNITS.has(identifierOf(declared))
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

/** One CSS escape: a hex sequence with its optional terminator, or a literal. */
const CSS_ESCAPE = /^\\(?:[0-9a-fA-F]{1,6}(?:\r\n|[ \t\r\n\f])?|[\s\S])/;

/**
 * Split a value into the tokens CSS reads, leaving escapes intact.
 *
 * Decoding before splitting turns an escaped space into a separator, so
 * `hidden\ auto` reads as two keywords when it is one identifier containing a
 * space — a value the browser discards. Splitting first and decoding each token
 * keeps the boundary where CSS puts it.
 */
export function splitCssTokens(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") {
      const escape = CSS_ESCAPE.exec(value.slice(index))?.[0] ?? "\\";
      current += escape;
      index += escape.length - 1;
      continue;
    }
    if (character !== undefined && " \t\r\n\f".includes(character)) {
      if (current !== "") tokens.push(current);
      current = "";
      continue;
    }
    current += character ?? "";
  }
  if (current !== "") tokens.push(current);
  return tokens;
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

/**
 * Functions whose result is an angle. They satisfy no leaf here on their own,
 * but an angle is exactly what the trigonometric functions take, so
 * `sin(asin(0.5))` is a number while `asin(0.5)` alone is not a width.
 */
const ANGLE_FUNCTION_ARITY: ReadonlyMap<string, readonly number[]> = new Map([
  ["asin", [1]],
  ["acos", [1]],
  ["atan", [1]],
  ["atan2", [2]],
]);

/**
 * `atan2()` relates two values rather than reading one ratio, so it takes any
 * numeric type as long as both arguments agree. The other three are defined
 * over a bare number.
 */
const ANGLE_FUNCTIONS_TAKING_ANY: ReadonlySet<string> = new Set(["atan2"]);

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

/**
 * What a unit measures, for the one question this module asks about two
 * operands together: whether they are the same KIND of quantity. Comparing
 * unit strings would call `1s` and `1ms` incompatible; a unit in no listed
 * category is answered with `null`, which abstains rather than guesses.
 */
export function unitCategory(unit: string): string | null {
  const folded = asciiLower(decodeIdentifier(unit));
  if (LENGTH_UNITS.has(folded)) return "length";
  if (ANGLE_UNITS.has(folded)) return "angle";
  if (TIME_UNITS.has(folded)) return "time";
  if (FREQUENCY_UNITS.has(folded)) return "frequency";
  if (RESOLUTION_UNITS.has(folded)) return "resolution";
  if (folded === "fr") return "flex";
  return null;
}

/** Units outside the length and angle sets, named so operands can be compared. */
const TIME_UNITS: ReadonlySet<string> = new Set(["s", "ms"]);
const FREQUENCY_UNITS: ReadonlySet<string> = new Set(["hz", "khz"]);
const RESOLUTION_UNITS: ReadonlySet<string> = new Set([
  "dpi",
  "dpcm",
  "dppx",
  "x",
]);

/**
 * A CSS numeric type: each base type mapped to the power it is raised to. An
 * empty map is `<number>`, `{length: 1}` is a length, `{length: 2}` an area.
 *
 * This is the algebra CSS Values and Units 4 defines for math expressions,
 * modelled once rather than reinvented per shape: multiplication adds
 * exponents, division subtracts them, and addition requires both sides to
 * agree already. One model is what lets any nesting be read — a function
 * inside an expression inside a function — where a rule per shape only ever
 * covers the shapes someone thought of.
 */
type NumericType = ReadonlyMap<string, number>;

/**
 * What an expression works out to.
 *
 * `unknown` is an honest abstention: a reference, a function whose result is
 * not knowable here, or a percentage whose meaning depends on the property.
 * It is accepted everywhere. `invalid` is a positive finding that the result
 * is a quantity no property can take, which is the only case that refuses.
 */
type TypeResult = NumericType | "unknown" | "invalid";

const NUMBER_TYPE: NumericType = new Map();

function sameType(a: NumericType, b: NumericType): boolean {
  if (a.size !== b.size) return false;
  for (const [base, power] of a) {
    if (b.get(base) !== power) return false;
  }
  return true;
}

/** Multiplying quantities adds their exponents; dividing subtracts them. */
function timesType(
  a: NumericType,
  b: NumericType,
  invert: boolean
): NumericType {
  const product = new Map(a);
  for (const [base, power] of b) {
    const combined = (product.get(base) ?? 0) + (invert ? -power : power);
    // A base type raised to zero has cancelled out: `1px / 1px` is a number.
    if (combined === 0) product.delete(base);
    else product.set(base, combined);
  }
  return product;
}

/** The type two added quantities share. Adding unlike quantities is invalid. */
function addedType(a: NumericType, b: NumericType): TypeResult {
  return sameType(a, b) ? a : "invalid";
}

/**
 * The type of one term, which may itself be a group or a function.
 *
 * `percentBase` is the percent hint: a percentage is not a kind of its own but
 * a share of whatever the property resolves it against, which on every leaf
 * here is a length. Carrying the hint rather than treating a percentage as
 * incomparable is what lets `calc(10% + 1)` be seen as a length plus a number.
 */
function termType(node: CssNode, percentBase: string): TypeResult {
  switch (node.type) {
    case "Number":
      return NUMBER_TYPE;
    case "Percentage":
      return new Map([[percentBase, 1]]);
    case "Dimension": {
      const base = unitCategory(unitOf(node));
      return base === null ? "unknown" : new Map([[base, 1]]);
    }
    case "Identifier":
      // The constants a math expression may name are plain numbers. Anything
      // else here is a keyword rather than a quantity.
      return CALC_CONSTANTS.has(identifierOf(node)) ? NUMBER_TYPE : "unknown";
    case "Parentheses":
      return numericType([...node.children], percentBase);
    case "Function":
      return callType(node, percentBase);
    default:
      return "unknown";
  }
}

/** The type a function call produces. */
function callType(
  node: {
    name: string;
    children: Iterable<CssNode>;
  },
  percentBase: string
): TypeResult {
  const name = identifierOf(node);
  // These report a ratio, a sign or an exponent, all of them bare numbers, and
  // these an angle. What they PRODUCE is fixed, but an argument that is itself
  // nonsense makes the whole declaration nonsense, so the arguments are still
  // read: `sign(1px + 1deg)` reports on a sum that does not exist.
  const fixed = NUMBER_FUNCTIONS.has(name)
    ? NUMBER_TYPE
    : ANGLE_FUNCTION_ARITY.has(name)
      ? ANGLE_TYPE
      : undefined;
  if (fixed !== undefined) {
    for (const argument of splitArguments(node.children)) {
      if (numericType(argument, percentBase) === "invalid") return "invalid";
    }
    return fixed;
  }
  // Everything else resolves to something this cannot see: a custom property,
  // an environment variable, an anchor, an attribute.
  if (!MATH_FUNCTIONS.has(name)) return "unknown";
  // The math functions choose among their operands or combine them, so they
  // produce whatever type those operands agree on.
  let agreed: NumericType | undefined;
  for (const operand of mathOperands(name, splitArguments(node.children))) {
    const type = numericType(operand, percentBase);
    if (type === "invalid" || type === "unknown") return type;
    if (agreed === undefined) {
      agreed = type;
      continue;
    }
    const combined = addedType(agreed, type);
    if (combined === "invalid" || combined === "unknown") return combined;
    agreed = combined;
  }
  return agreed ?? "unknown";
}

/**
 * The type of an arithmetic expression: operands and operators in turn.
 *
 * Multiplication and division bind tighter than addition, so they fold first.
 * Folding strictly left to right would read `calc(1 + 2 * 1px)` as a number
 * added to a number and then scaled, making it a length, when the browser
 * reads it as a number added to a length and discards it.
 *
 * Any operand this cannot read makes the whole expression unreadable rather
 * than partly readable, which keeps a guess from being assembled out of the
 * parts that happened to be literals.
 */
function numericType(
  terms: readonly CssNode[],
  percentBase: string
): TypeResult {
  if (terms.length === 0 || terms.length % 2 === 0) return "unknown";
  // Narrowed as it is built: an operand that is already invalid decides the
  // whole expression, so nothing past it needs a type at all.
  const operands: (NumericType | "unknown")[] = [];
  const symbols: string[] = [];
  for (let index = 0; index < terms.length; index += 1) {
    const term = terms[index];
    if (term === undefined) return "unknown";
    if (index % 2 === 0) {
      const type = termType(term, percentBase);
      if (type === "invalid") return "invalid";
      operands.push(type);
      continue;
    }
    if (term.type !== "Operator") return "unknown";
    symbols.push(term.value.trim());
  }
  // An unreadable operand makes the RESULT unreadable, but it does not make the
  // rest of the expression unreadable. `calc(1px * 1px + var(--x))` multiplies
  // two lengths whatever `--x` turns out to be, so the parts that can be judged
  // still are, and the unknown is carried alongside them.
  const first = operands[0];
  if (first === undefined) return "unknown";
  const summands: (NumericType | "unknown")[] = [first];
  for (let index = 0; index < symbols.length; index += 1) {
    const symbol = symbols[index];
    const right = operands[index + 1];
    const left = summands[summands.length - 1];
    if (right === undefined || left === undefined) return "unknown";
    if (symbol === "*" || symbol === "/") {
      const known = left !== "unknown" && right !== "unknown";
      // Scaling a quantity is multiplying it by a number: `1px * 1px` is an
      // area and CSS has nowhere to put one. Asked of each product as it
      // forms, because a later division can cancel the area back down to a
      // length and the final type alone would not show it ever existed.
      // Division is not symmetric with it — `1px / 1px` is a plain ratio.
      if (symbol === "*" && known && left.size > 0 && right.size > 0) {
        return "invalid";
      }
      summands[summands.length - 1] = known
        ? timesType(left, right, symbol === "/")
        : "unknown";
      continue;
    }
    if (symbol !== "+" && symbol !== "-") return "unknown";
    summands.push(right);
  }
  // Every summand describes one quantity, so any two that are readable have to
  // agree with each other even when a third is not readable at all.
  let agreed: NumericType | undefined;
  let anyUnknown = false;
  for (const summand of summands) {
    if (summand === "unknown") {
      anyUnknown = true;
      continue;
    }
    if (agreed === undefined) {
      agreed = summand;
      continue;
    }
    const combined = addedType(agreed, summand);
    if (combined === "invalid") return "invalid";
    if (combined === "unknown") {
      anyUnknown = true;
      continue;
    }
    agreed = combined;
  }
  return anyUnknown || agreed === undefined ? "unknown" : agreed;
}

/**
 * Whether a computed type is a quantity the property takes.
 *
 * A length or a percentage is a measurement. A bare number is one only where
 * the property says so, which is `line-height`. Anything else — an area from
 * multiplying two lengths, an angle, a duration — is a declaration the browser
 * discards.
 */
function typeIsMeasurement(type: NumericType, allowNumber: boolean): boolean {
  if (type.size === 0) return allowNumber;
  return sameType(type, LENGTH_TYPE) || sameType(type, PERCENT_TYPE);
}

const LENGTH_TYPE: NumericType = new Map([["length", 1]]);
const PERCENT_TYPE: NumericType = new Map([["percent", 1]]);
const ANGLE_TYPE: NumericType = new Map([["angle", 1]]);

/**
 * The operands of a math function: its arguments, with a leading strategy
 * keyword dropped.
 *
 * `round()` takes an optional rounding strategy as an argument of its own. It
 * is neither a quantity to compare against the others nor a term that changes
 * what the function produces, so every caller that reads the operands has to
 * skip it. One function for all of them, so they cannot disagree about which
 * arguments those are.
 */
function mathOperands(name: string, args: CssNode[][]): CssNode[][] {
  const ownIdentifiers = FUNCTION_IDENTIFIERS.get(name) ?? NO_KEYWORDS;
  const leading = args[0];
  const strategy =
    args.length > 1 &&
    leading !== undefined &&
    leading.length === 1 &&
    leading[0]?.type === "Identifier" &&
    ownIdentifiers.has(identifierOf(leading[0]));
  return strategy ? args.slice(1) : args;
}

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
  // An escaped spelling never becomes a `Url` node — css-tree only recognises
  // the literal one — so `u\72l("…")` arrives as an ordinary function and
  // needs the same treatment its unescaped twin gets for free.
  "url",
  "image",
  "image-set",
  "-webkit-image-set",
  "src",
]);

/**
 * A CSS identifier with its escapes resolved.
 *
 * css-tree leaves escapes in a function's NAME even though it decodes them in a
 * url's value, so `u\72l(...)` arrives here spelled that way while the browser
 * reads it as `url(...)`. Classifying on the raw spelling therefore skips every
 * check that depends on knowing which function this is, including the scheme
 * allowlist.
 *
 * A code point outside the Unicode range becomes the replacement character, as
 * the CSS syntax specification requires, rather than throwing.
 */
/**
 * One string written as a CSS identifier, escaping whatever cannot appear raw.
 *
 * The inverse of {@link decodeIdentifier}, and the same algorithm the DOM
 * exposes as `CSS.escape` — implemented here because this package imports no
 * framework and `CSS` is a browser global, and because a stylesheet compiled on
 * a server has to escape exactly as the browser would parse.
 *
 * Written out rather than approximated with a "safe characters only" test. A
 * class attribute may hold a token the CSS grammar cannot spell raw — a UUID
 * beginning with a digit, `_region`, `-region` — and refusing those means
 * refusing valid input, while passing them through unescaped emits a selector
 * that silently matches something else or nothing.
 *
 * Follows CSSOM's "serialize an identifier": a leading digit, and a digit after
 * a leading dash, are written as a hex escape, because `.1a` and `.-1a` are not
 * identifiers at all; a lone dash is escaped for the same reason. Control
 * characters become hex escapes, NULL becomes the replacement character, and
 * everything from U+0080 up is left alone, since CSS identifiers admit it.
 */
export function escapeIdentifier(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const char = value[index];
    if (code === 0) {
      out += "\uFFFD";
      continue;
    }
    if (
      (code >= 0x1 && code <= 0x1f) ||
      code === 0x7f ||
      (index === 0 && code >= 0x30 && code <= 0x39) ||
      (index === 1 &&
        code >= 0x30 &&
        code <= 0x39 &&
        value.charCodeAt(0) === 0x2d)
    ) {
      out += `\\${code.toString(16)} `;
      continue;
    }
    if (index === 0 && code === 0x2d && value.length === 1) {
      out += `\\${char}`;
      continue;
    }
    if (
      code >= 0x80 ||
      code === 0x2d ||
      code === 0x5f ||
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    ) {
      out += char;
      continue;
    }
    out += `\\${char}`;
  }
  return out;
}

export function decodeIdentifier(name: string): string {
  if (!name.includes("\\")) return name;
  return name.replace(
    /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\r\n\f])?|([\s\S]))/g,
    (_match: string, hex?: string, literal?: string) => {
      if (hex === undefined) return literal ?? "";
      const point = Number.parseInt(hex, 16);
      const usable =
        point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff);
      return usable ? String.fromCodePoint(point) : "\uFFFD";
    }
  );
}

/** An identifier as CSS reads it, folded for comparison. */
function identifierOf(node: { name: string }): string {
  return asciiLower(decodeIdentifier(node.name));
}

/**
 * Whether a `var()` or `env()` carries the name it exists to reference.
 *
 * The fallback stays unread — what a custom property resolves to is not
 * knowable here — but the head is not optional: `var()` names a custom property
 * and `env()` an environment variable, so a reference with no name resolves to
 * nothing and the browser discards the declaration around it. A custom property
 * name is case-sensitive, so only the leading dashes are read and the spelling
 * is left alone.
 *
 * One function for every leaf that accepts these, because a rule about what a
 * reference must carry is the same rule whether a length or a colour is being
 * referenced.
 */
function referenceNamesSomething(node: {
  name: string;
  children: Iterable<CssNode>;
}): boolean {
  const head = splitArguments(node.children)[0] ?? [];
  const named = head[0];
  if (named?.type !== "Identifier") return false;
  if (identifierOf(node) === "var") {
    // Only the name is read here. A `var()` head carrying anything besides it
    // does not parse at all, so there is nothing left for this to refuse.
    return decodeIdentifier(named.name).startsWith("--");
  }
  // An environment variable is named by a custom identifier, which excludes
  // the CSS-wide keywords: `env(inherit)` names nothing, because `inherit` is
  // never an identifier a value can carry.
  if (!isCustomIdentifier(identifierOf(named))) return false;
  // `env()` may index into the variable it names, and an index is a
  // non-negative integer: `env(titlebar-area-x 1)` reads the second value.
  // Anything else in the head makes the reference resolve to nothing.
  return head.slice(1).every(isIndex);
}

/**
 * Whether a name is a `<custom-ident>`: an author-chosen identifier. The
 * CSS-wide keywords are excluded because they are whole values wherever they
 * appear, and `default` is reserved alongside them.
 */
function isCustomIdentifier(name: string): boolean {
  return !CSS_WIDE_KEYWORDS.has(name) && name !== "default";
}

/** Whether a node is a non-negative integer, which is what indexes a value. */
function isIndex(node: CssNode): boolean {
  // An explicit `+` is valid integer syntax, so the spelling is not the test:
  // `env(viewport-segment-width +1 0)` is a reference the browser resolves. A
  // decimal point is not an integer, which is why this is not a numeric parse.
  return node.type === "Number" && /^\+?\d+$/.test(node.value);
}

/**
 * A dimension's unit as CSS reads it. Units are identifiers, so they carry
 * escapes like any other: `1p\78` is `1px`, and comparing the raw spelling
 * against the unit sets refuses a measurement the browser accepts.
 */
function unitOf(node: { unit: string }): string {
  return asciiLower(decodeIdentifier(node.unit));
}

/**
 * The text of an unquoted `url()` argument, with its escapes resolved.
 *
 * An escaped function name never becomes a `Url` node, so an escaped
 * `url(data\3a …)` arrives as a function whose argument is a run of ordinary
 * tokens rather than a string, and the colon that makes it a scheme is hidden
 * inside an identifier. Rendering the tokens back is what lets the scheme
 * check see what the browser will see.
 *
 * `null` means the argument held something this cannot render, which on this
 * path is answered by refusing rather than by guessing.
 */
function unquotedUrlText(children: Iterable<CssNode>): string | null {
  let text = "";
  for (const child of children) {
    switch (child.type) {
      case "Identifier":
        text += decodeIdentifier(child.name);
        break;
      case "Operator":
        text += child.value;
        break;
      case "String":
        text += child.value;
        break;
      case "Number":
        text += String(child.value);
        break;
      case "Dimension":
        text += `${String(child.value)}${decodeIdentifier(child.unit)}`;
        break;
      case "Percentage":
        text += `${String(child.value)}%`;
        break;
      case "Hash":
        text += `#${decodeIdentifier(child.value)}`;
        break;
      default:
        return null;
    }
  }
  return text;
}

/**
 * The first refused URL anywhere in a parsed value, or `null`.
 *
 * The walk is recursive, so it is wrapped: the depth cap ahead of it is what
 * keeps the recursion bounded, and if a value ever gets past that cap the
 * honest answer is to refuse it rather than let an exception escape a
 * validator. Failing closed costs a value that was already at the limit; the
 * alternative turns a document write into a server error.
 */
function nestedUrlRejection(
  ast: CssNode,
  mayFetchUrl: MayFetchUrl | undefined
): CssValueRejection | null {
  try {
    return walkForUrlRejection(ast, mayFetchUrl);
  } catch {
    return "too-deeply-nested";
  }
}

function walkForUrlRejection(
  node: CssNode,
  // Before the two defaulted parameters on purpose: a caller that slots an
  // argument wrongly gets a type error rather than a predicate silently dropped,
  // which would leave every URL in the value unasked about.
  mayFetchUrl: MayFetchUrl | undefined,
  urlContext = false,
  depth = 0
): CssValueRejection | null {
  switch (node.type) {
    case "Url":
      return checkUrlValue(node.value, "quoted", mayFetchUrl);
    case "String":
      // A quoted string is a URL only where the function around it loads one.
      // The same string is a font family somewhere else, so the surrounding
      // context decides, not the node.
      return urlContext
        ? checkUrlValue(node.value, "quoted", mayFetchUrl)
        : null;
    case "Raw": {
      // A custom property's fallback is kept unparsed, so it has to be read
      // back or `var(--x, url("javascript:…"))` reaches the page whenever the
      // property is absent. It is read back IN CONTEXT: an unset property
      // hands its fallback straight to the function around it, so a bare
      // string there is loaded exactly as a written-out one would be.
      // Bounded by the same depth cap the bracket count enforces, so a
      // fallback inside a fallback cannot recurse without end.
      if (depth >= MAX_VALUE_NESTING) return null;
      const parsed = parseValue(node.value);
      return parsed === null
        ? null
        : walkForUrlRejection(parsed, mayFetchUrl, urlContext, depth + 1);
    }
    default:
      break;
  }
  if (!("children" in node) || node.children === null) return null;
  let inner = urlContext;
  if (node.type === "Function") {
    const name = identifierOf(node);
    if (URL_STRING_FUNCTIONS.has(name)) {
      inner = true;
      // Only `url()` takes an unquoted argument, and only by an escaped
      // spelling does one reach here as a function: a run of tokens rather
      // than a string, with the colon that names the scheme hidden inside an
      // identifier. The image functions take a string or a nested `url()`,
      // both of which the recursion already reaches.
      if (name === "url" && !hasStringChild(node.children)) {
        const text = unquotedUrlText(node.children);
        return text === null
          ? "unsafe-url-characters"
          : checkUrlValue(text, "raw", mayFetchUrl);
      }
    } else if (name !== "var" && name !== "env") {
      // A reference passes its context through to whatever stands in for it;
      // every other function establishes its own, and a string inside one is
      // not a URL because it sits inside something that is.
      inner = false;
    }
  }
  for (const child of node.children) {
    const rejection = walkForUrlRejection(child, mayFetchUrl, inner, depth);
    if (rejection !== null) return rejection;
  }
  return null;
}

function hasStringChild(children: Iterable<CssNode>): boolean {
  for (const child of children) {
    if (child.type === "String") return true;
  }
  return false;
}

/**
 * Maximum bracket nesting in one value. Parsing and walking a value are both
 * recursive, so a deeply nested value exhausts the stack — measured, a few
 * hundred nested `calc()` calls is enough, well inside any document size limit.
 * Counting brackets first is iterative and cannot itself overflow.
 */
const MAX_VALUE_NESTING = 32;

/**
 * Whether CSS would make a custom-property substitution anywhere in this value.
 *
 * The question, not a spelling. A function token is an identifier immediately
 * followed by `(`, and the identifier is read DECODED — so `v\61 r(--brand)` IS
 * a `var()` to a browser, and any reader matching the literal text `var(` says it
 * is not. That gap is a known sanitiser-bypass shape rather than a curiosity: it
 * is how `url(` and `expression(` filters were historically defeated.
 *
 * **Exported because the answer must not be re-derived per consumer.** The
 * builder's tokens panel refuses to preview a value carrying a reference, since
 * a `var()` there resolves against the PANEL's own `--nx-*` properties and would
 * draw a colour the canvas does not have. It asked that question with a regex
 * over the raw text, so an escaped spelling was previewed — precisely the false
 * preview the guard exists to prevent.
 *
 * **Not the same choice `dtcg.ts` makes, deliberately.** That module reads the
 * raw spelling on purpose, and says so: a `var()` with an escaped name is then
 * read as invalid rather than dynamic, which is safe THERE because its grammar
 * refuses the parentheses anyway. The two want opposite defaults — reading raw
 * fails closed for dtcg and fails OPEN for a preview, where unseen means drawn.
 *
 * **An unparseable value answers `true`.** It cannot be shown not to substitute,
 * and every caller is deciding whether to render something whose appearance would
 * be wrong; declining to draw a value that would not have rendered anyway costs
 * nothing, while drawing one that substitutes is the defect. Fail-closed is a
 * property of the question rather than of this implementation.
 *
 * `env()` is excluded. It substitutes, but from user-agent values that are the
 * same in a panel and on a canvas, so it cannot produce the disagreement this
 * exists to catch.
 */
export function referencesCustomProperty(value: string): boolean {
  const parsed = parseValue(value);
  if (parsed === null) return true;
  return walkForVarCall(parsed, 0);
}

function walkForVarCall(node: CssNode, depth: number): boolean {
  // Depth-bounded for the reason the URL walk is: parsing and walking are both
  // recursive, so a deeply nested value exhausts the stack. Answering TRUE at
  // the cap keeps the refusal fail-closed rather than declaring a value clean
  // because it was too deep to read.
  if (depth >= MAX_VALUE_NESTING) return true;
  // A fallback arrives as raw text rather than as parsed children, so a
  // reference nested inside one — `var(--a, v\61 r(--b))` — is invisible to a
  // walk that only descends `children`.
  if (node.type === "Raw") return rawCarriesVarCall(node.value, depth);
  if (isVarCall(node)) return true;
  for (const child of childrenOf(node)) {
    if (walkForVarCall(child, depth + 1)) return true;
  }
  return false;
}

/** Whether THIS node is the substitution, as CSS reads its name. */
function isVarCall(node: CssNode): boolean {
  return node.type === "Function" && identifierOf(node) === "var";
}

/** A `var()` fallback, which the parser hands back as unparsed text. */
function rawCarriesVarCall(text: string, depth: number): boolean {
  const inner = parseValue(text);
  return inner !== null && walkForVarCall(inner, depth + 1);
}

/**
 * The children a node carries, or none.
 *
 * Separated so the walk reads as one loop rather than a guard and a loop. A
 * node whose `children` is absent or null is a leaf, and a leaf has nothing to
 * descend into — which is the same answer as an empty list.
 */
function childrenOf(node: CssNode): Iterable<CssNode> {
  if (!("children" in node) || node.children === null) return [];
  return node.children;
}

/** True when a stored string is longer than any declaration should carry. */
export function isOverlongValue(value: string): boolean {
  return value.length > MAX_VALUE_LENGTH;
}

/**
 * Longest value that will be parsed. Nesting is not the only way to make an
 * expensive parse: a flat value of a few hundred thousand tokens builds an AST
 * node for each. No real declaration approaches this.
 */
/**
 * The longest style value this engine will read.
 *
 * Public for the reason every other bound here is: a value past it is REFUSED
 * before parsing, so a writer that wants its declaration emitted has to honour
 * the same number, and anything walking the same stored values has to stop
 * reading where the compiler stops.
 */
export const MAX_VALUE_LENGTH = 8192;

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
export function checkCssValue(
  value: string,
  mayFetchUrl?: MayFetchUrl
): CssValueRejection | null {
  // The size cap goes first because it is the only constant-time check here:
  // trimming an oversized string scans and copies all of it before anything
  // decides the value was never going to be read.
  if (value.length > MAX_VALUE_LENGTH) return "too-long";
  if (trimCssWhitespace(value) === "") return "unparsable";
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
  return nestedUrlRejection(ast, mayFetchUrl);
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
  /**
   * Whether a bare number is a value here, as it is on `line-height`. Declared
   * per property because a number satisfies almost none of them: `width: 1`
   * paints nothing, so an expression that resolves to one is refused unless the
   * property says otherwise.
   */
  allowNumber?: boolean;
}

/**
 * Whether one term of a STANDALONE value is a measurement.
 *
 * A standalone value is what a property receives directly: `16px`, `auto`,
 * `calc(1px + 2px)`. Arithmetic lives inside a math function and nowhere else,
 * so a bare operator here means the browser discards the declaration.
 *
 * Shared with the `attr()` fallback, which is a standalone value too — it is
 * substituted whole when the attribute is missing, so `attr(data-x px, 1px + 2)`
 * hands the property `1px + 2` and it is refused for the same reason a
 * written-out `1px + 2` is. Reading the fallback as an arithmetic expression
 * instead accepted exactly what the browser throws away.
 */
function standaloneTermRejection(
  node: CssNode,
  keywords: ReadonlySet<string>,
  rules: MeasurementLimits & { allowNumber: boolean }
): CssValueRejection | null {
  const { allowNumber, ...limits } = rules;
  // No length property takes an operator at the top level. Corner radii are
  // expressed per corner instead, which is also the only form that flips with
  // writing direction.
  if (node.type === "Operator") return "not-a-length";
  const rejection = measurementRejection(node, false, keywords, limits);
  if (rejection !== null) return rejection;
  // The structural check above says the term is WELL FORMED. What it works out
  // to is a separate question, asked once over the whole expression so that
  // nesting and operator precedence are both visible.
  if (node.type !== "Function") return null;
  const type = numericType([node], "length");
  if (type === "invalid") return "not-a-length";
  return type !== "unknown" && !typeIsMeasurement(type, allowNumber)
    ? "not-a-length"
    : null;
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
    allowNumber = false,
  } = rules;
  const rejection = checkCssValue(value);
  if (rejection !== null) return rejection;
  const ast = parseValue(value);
  if (ast === null || ast.type !== "Value") return "not-a-length";
  const allowed = new Set(keywords.map(keyword => asciiLower(keyword)));
  const allowedFunctions = new Set(functions.map(fnName => asciiLower(fnName)));
  return standaloneValueRejection([...ast.children], allowed, {
    allowNegative,
    allowPercentage,
    functions: allowedFunctions,
    allowNumber,
    maxParts,
  });
}

/**
 * Whether a run of terms is ONE standalone value.
 *
 * Per-term checks are not enough on their own: `1px 2px` is two well-formed
 * lengths and no valid width, and `inherit 1px` is a CSS-wide keyword that
 * voids whatever stands beside it. Both are properties of the run rather than
 * of any term in it, so a caller that walks terms itself and stops there
 * accepts values a browser discards.
 *
 * Shared with the `attr()` fallback, which is one standalone value in exactly
 * this sense — a `px`-typed attribute substitutes a single length, so a
 * fallback of two is as wrong there as it is written out.
 */
function standaloneValueRejection(
  terms: readonly CssNode[],
  keywords: ReadonlySet<string>,
  rules: MeasurementLimits & { allowNumber: boolean; maxParts: number }
): CssValueRejection | null {
  const { maxParts, ...termRules } = rules;
  let parts = 0;
  let cssWideKeyword = false;
  for (const term of terms) {
    const rejection = standaloneTermRejection(term, keywords, termRules);
    if (rejection !== null) return rejection;
    if (term.type === "Identifier" && isCssWideKeyword(identifierOf(term))) {
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
      const unit = unitOf(node);
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
        const inner = identifierOf(node);
        return CALC_CONSTANTS.has(inner) || keywords.has(inner)
          ? null
          : "not-a-length";
      }
      const name = identifierOf(node);
      return CSS_WIDE_KEYWORDS.has(name) || keywords.has(name)
        ? null
        : "not-a-length";
    }
    case "Operator":
      return null;
    case "Function": {
      const name = identifierOf(node);
      if (
        !DIMENSION_FUNCTIONS.has(name) &&
        limits.functions?.has(name) !== true &&
        !(insideFunction && NUMBER_FUNCTIONS.has(name)) &&
        !(insideFunction && ANGLE_FUNCTION_ARITY.has(name))
      ) {
        return "not-a-length";
      }
      if (name === "attr" && !attrProducesDimension(node, limits)) {
        return "not-a-length";
      }
      // Outside the math functions the name is the whole signal. What `var()`
      // and `env()` resolve to is not knowable here and their arguments carry
      // an arbitrary fallback; `anchor-size()` and `fit-content()` have
      // argument grammars of their own. Reading any of them arithmetically
      // refuses valid values, and the characters that would make an argument
      // dangerous were already refused for the value as a whole.
      // An angle-producing function is a value only where an angle is wanted.
      if (ANGLE_FUNCTION_ARITY.has(name)) {
        if (limits.domain !== "angleOrNumber" && limits.domain !== "any") {
          return "not-a-length";
        }
        const angleArgs = splitArguments(node.children);
        const angleArity = ANGLE_FUNCTION_ARITY.get(name) ?? [1];
        if (!angleArity.includes(angleArgs.length)) return "not-a-length";
        const angleDomain: NumericDomain = ANGLE_FUNCTIONS_TAKING_ANY.has(name)
          ? "any"
          : "number";
        for (const arg of angleArgs) {
          const rejection = alternationRejection(arg, NO_KEYWORDS, {
            allowNegative: true,
            allowPercentage: false,
            functions: limits.functions,
            domain: angleDomain,
          });
          if (rejection !== null) return rejection;
        }
        // Two operands of one function have to be the same kind of quantity.
        // Anything not readable answers nothing and abstains.
        if (angleArgs.length === 2) {
          const first = numericType(angleArgs[0] ?? [], "length");
          const second = numericType(angleArgs[1] ?? [], "length");
          if (first === "invalid" || second === "invalid")
            return "not-a-length";
          if (
            first !== "unknown" &&
            second !== "unknown" &&
            !sameType(first, second)
          ) {
            return "not-a-length";
          }
        }
        return null;
      }
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
      if (name === "var" || name === "env") {
        return referenceNamesSomething(node) ? null : "not-a-length";
      }
      if (!MATH_FUNCTIONS.has(name)) return null;
      // A rounding strategy is a leading argument of its own, not something
      // that may appear among the operands: `round(1px, up)` is discarded.
      const operands = mathOperands(name, splitArguments(node.children));
      // Present for every math function, since the set is the map's own keys.
      const arity = MATH_FUNCTION_ARITY.get(name) ?? null;
      if (arity !== null && !arity.includes(operands.length)) {
        return "not-a-length";
      }
      for (const arg of operands) {
        // Inside a math function the sign of any one term says nothing about
        // the sign of the result, so the non-negative rule does not apply. The
        // property's keywords are dropped: `auto` is a whole value, not an
        // operand, and `calc(auto)` is discarded by the browser.
        const rejection = alternationRejection(arg, NO_KEYWORDS, {
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
/**
 * Whether an arithmetic operator is written the way CSS requires.
 *
 * Only the four arithmetic operators appear inside a math expression — a comma
 * separates arguments and is split off before this, so one reaching here is
 * inside a parenthesised group where it means nothing. `+` and `-` additionally
 * need whitespace on both sides, because without it the sign binds to the
 * number and `1px+ 2px` becomes two values rather than a sum.
 */
function operatorRejection(value: string): CssValueRejection | null {
  const symbol = value.trim();
  if (symbol === "*" || symbol === "/") return null;
  if (symbol !== "+" && symbol !== "-") return "not-a-length";
  const spaced = /^[ \t\r\n\f]/.test(value) && /[ \t\r\n\f]$/.test(value);
  return spaced ? null : "not-a-length";
}

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
    if (expectingOperator) {
      if (term.type !== "Operator") return "not-a-length";
      const bad = operatorRejection(term.value);
      if (bad !== null) return bad;
      // What the operands add up to is not asked here. Reading operators in
      // pairs cannot see past its two neighbours, and precedence means the
      // neighbours are not always what combine; the whole expression is typed
      // once, by the caller, where the nesting is visible.
      continue;
    }
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
      // The digits carry escapes as any identifier does, so `#\66 ff` is the
      // colour `#fff` and comparing the raw spelling refuses it.
      return HEX_COLOR.test(decodeIdentifier(node.value))
        ? null
        : "not-a-color";
    case "Identifier": {
      const name = identifierOf(node);
      return COLOR_KEYWORDS.has(name) || SYSTEM_COLORS.has(name)
        ? null
        : "not-a-color";
    }
    case "Function": {
      const name = identifierOf(node);
      if (!COLOR_FUNCTIONS.has(name)) return "not-a-color";
      // A reference is allowlisted for what it may resolve to, not for the name
      // alone: it still has to name something to resolve.
      if (name === "var" || name === "env") {
        return referenceNamesSomething(node) ? null : "not-a-color";
      }
      return null;
    }
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
  context: UrlContext = "raw",
  // Which hosts this site will fetch from, when the caller has an answer. A
  // string is passed rather than a parsed URL because the emitted declaration
  // carries the string, and re-serialising a parse would let the two differ.
  mayFetchUrl?: MayFetchUrl
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
  // emitted is the one stored, not the trimmed one.
  const unsafe =
    context === "quoted" ? UNSAFE_QUOTED_URL_CHARS : UNSAFE_URL_CHARS;
  if (unsafe.test(value)) return "unsafe-url-characters";
  // Asked LAST, of a value already known to be well formed, so the host rule is
  // never the reason given for a value that was going to be refused anyway. A
  // caller with no host policy leaves this undefined and nothing changes: the
  // scheme allowlist above is then the only limit, which is what every caller
  // outside a configured site gets today.
  if (mayFetchUrl !== undefined && !mayFetchUrl(value)) {
    return "url-host-not-allowed";
  }
  return null;
}
