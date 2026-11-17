/**
 * The type of a numeric value: which functions produce a number or an
 * angle, how many arguments each takes, the category a unit measures, and
 * the numeric type a math expression resolves to.
 *
 * @module style/css-value-types
 */
import type { CssNode } from "css-tree";

import {
  asciiLower,
  decodeIdentifier,
  identifierOf,
  splitArguments,
  unitOf,
} from "./css-value-syntax";
import {
  LENGTH_UNITS,
  MATH_FUNCTIONS,
  NO_KEYWORDS,
} from "./css-value-vocabulary";

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
 * are absent: they satisfy no leaf `css-value` validates.
 */
export const NUMBER_FUNCTION_ARITY: ReadonlyMap<string, readonly number[]> =
  new Map([
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

export const NUMBER_FUNCTIONS: ReadonlySet<string> = new Set(
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
export type NumericDomain = "number" | "angleOrNumber" | "any";

/**
 * Functions whose result is an angle. They satisfy no leaf here on their own,
 * but an angle is exactly what the trigonometric functions take, so
 * `sin(asin(0.5))` is a number while `asin(0.5)` alone is not a width.
 */
export const ANGLE_FUNCTION_ARITY: ReadonlyMap<string, readonly number[]> =
  new Map([
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
export const ANGLE_FUNCTIONS_TAKING_ANY: ReadonlySet<string> = new Set([
  "atan2",
]);

export const NUMBER_FUNCTION_DOMAIN: ReadonlyMap<string, NumericDomain> =
  new Map([
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
 * What a unit measures, for the one question `css-value` asks about two
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

export function sameType(a: NumericType, b: NumericType): boolean {
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
// RELOCATED, not written here — see the docblock of `css-value.ts`.
// fallow-ignore-next-line complexity
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
// RELOCATED, not written here — see the docblock of `css-value.ts`.
// fallow-ignore-next-line complexity
export function numericType(
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
export function typeIsMeasurement(
  type: NumericType,
  allowNumber: boolean
): boolean {
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
export function mathOperands(name: string, args: CssNode[][]): CssNode[][] {
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
export const ANGLE_UNITS: ReadonlySet<string> = new Set([
  "deg",
  "grad",
  "rad",
  "turn",
]);

export const CALC_CONSTANTS: ReadonlySet<string> = new Set([
  "pi",
  "e",
  "infinity",
  "-infinity",
  "nan",
]);
