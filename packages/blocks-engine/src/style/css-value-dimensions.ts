/**
 * Whether a value declared as a length is one: the rules a dimension is
 * held to, a standalone term, a measurement inside a math function, and
 * alternatives separated by an operator.
 *
 * @module style/css-value-dimensions
 */
import type { CssNode } from "css-tree";

import { checkCssValue } from "./css-value-check";
import {
  asciiLower,
  identifierOf,
  isCssWideKeyword,
  parseValue,
  referenceNamesSomething,
  splitArguments,
  unitOf,
} from "./css-value-syntax";
import {
  ANGLE_FUNCTION_ARITY,
  ANGLE_FUNCTIONS_TAKING_ANY,
  ANGLE_UNITS,
  CALC_CONSTANTS,
  mathOperands,
  NUMBER_FUNCTION_ARITY,
  NUMBER_FUNCTION_DOMAIN,
  NUMBER_FUNCTIONS,
  type NumericDomain,
  numericType,
  sameType,
  typeIsMeasurement,
} from "./css-value-types";
import {
  CSS_WIDE_KEYWORDS,
  type CssValueRejection,
  DIMENSION_FUNCTIONS,
  LENGTH_UNITS,
  MATH_FUNCTION_ARITY,
  MATH_FUNCTIONS,
  NO_KEYWORDS,
} from "./css-value-vocabulary";

/**
 * Whether an `attr()` can produce a measurement.
 *
 * Its name says nothing on its own: `attr(title)` yields a string and
 * `attr(data-angle deg)` an angle, both of which a browser discards where a
 * length belongs. The token after the attribute name is what decides it, and
 * no token at all means a string whatever the attribute holds.
 */
// RELOCATED, not written here — see the docblock of `css-value.ts`.
// fallow-ignore-next-line complexity
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

// RELOCATED, not written here — see the docblock of `css-value.ts`.
// fallow-ignore-next-line complexity
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

// RELOCATED, not written here — see the docblock of `css-value.ts`.
// fallow-ignore-next-line complexity
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
