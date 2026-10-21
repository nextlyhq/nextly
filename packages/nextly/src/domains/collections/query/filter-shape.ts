/**
 * Whether a filter is well formed, judged before any part of it is translated.
 *
 * Every translator downstream of here used to SKIP what it did not understand:
 * an unknown operator, a field whose value carried no operator, an `undefined`
 * operand, an empty `in`, an `and` that was not a list. Skipping a member of a
 * filter does not make a query fail, it makes it answer a WIDER question than
 * the one asked — and when the filter is an access constraint, "wider" means
 * rows the caller was never meant to see. So a filter that is not well formed
 * is refused here, whole, with every problem named, and never runs without its
 * bad part.
 *
 * This judges SHAPE only: which keys are operators, what each operator's
 * operand may be, and how `and`/`or` nest. Whether a key names a column the
 * collection can filter on needs the table, so the condition builder refuses
 * that where it resolves the column (`services/collections/drizzle-condition`).
 *
 * @module domains/collections/query/filter-shape
 */

import { NextlyError } from "../../../errors/nextly-error";
import { TRANSLATION_FILTER_STATES } from "../../i18n/translation-filter-states";

import { parseNearQuery, parseWithinQuery } from "./geo-utils";
import {
  isWorkflowKey,
  WORKFLOW_KEY_PURPOSE,
  workflowKeyForm,
  workflowKeyProblem,
} from "./workflow-filter";

/** One problem with a filter, as `NextlyError.validation` reports it. */
export interface FilterProblem {
  path: string;
  code: string;
  message: string;
}

/**
 * The refusal of a key that names no field this collection can be filtered on.
 *
 * Exported so a condition that must be refused AS IF it were unknown — one a
 * caller may not use, where saying so would tell them it exists for others —
 * is refused in exactly these words. It is the same sentence the condition
 * builder (`services/collections/drizzle-condition`) gives a name it cannot
 * resolve.
 */
export function unknownFieldProblem(path: string, key: string): FilterProblem {
  return {
    path,
    code: "FILTER_UNKNOWN_FIELD",
    message: `"${key}" is not a field this collection can be filtered on.`,
  };
}

/** The reserved key carrying the language filter. */
export const TRANSLATED_KEY = "_translated";

/**
 * The one key no filter may carry. JSON makes `__proto__` an own key, and
 * assigning it anywhere sets an object's prototype instead of a key, so it
 * can never be a field. `constructor` and `prototype` are ordinary names a
 * schema may use, and every walk here reads only own keys.
 */
const PROTOTYPE_KEY = "__proto__";

/** How deep a filter may nest before it is refused rather than copied. */
const MAX_SNAPSHOT_DEPTH = 64;

/** Whether a value is a plain object: not an array, a date, or null. */
export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/**
 * A value a column can be compared with: a string, a finite number, a boolean
 * or a valid date. Anything else would be bound as a parameter the database
 * either coerces into something the caller did not write or rejects as a
 * server error.
 */
function isScalar(value: unknown): boolean {
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return value instanceof Date && Number.isFinite(value.getTime());
}

/** A value ordered comparisons accept: a string, a number or a date. */
function isOrderable(value: unknown): boolean {
  return typeof value !== "boolean" && isScalar(value);
}

/** A value text matching accepts: a string, or a number matched as text. */
function isMatchable(value: unknown): boolean {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/** How a value reads in an error message, without echoing its contents. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "a list";
  if (value instanceof Date) return "an invalid date";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

/** What is wrong with one operand: the code it is refused with, and why. */
interface OperandIssue {
  code: string;
  message: string;
}

/** Judges one operator's operand, already known not to be null or undefined. */
type OperandRule = (
  operator: string,
  operand: unknown
) => OperandIssue | undefined;

const invalid = (message: string): OperandIssue => ({
  code: "FILTER_INVALID_OPERAND",
  message,
});

/** A rule accepting what `accepts` does, described as `kinds` when it refuses. */
const accepting =
  (accepts: (value: unknown) => boolean, kinds: string): OperandRule =>
  (operator, operand) =>
    accepts(operand)
      ? undefined
      : invalid(`"${operator}" needs ${kinds}, not ${describe(operand)}.`);

/**
 * A list of comparable values. Read by index, so a hole in a sparse list is
 * judged as the `undefined` it reads as rather than skipped.
 */
const membership: OperandRule = (operator, operand) => {
  if (!Array.isArray(operand)) {
    return invalid(
      `"${operator}" needs a list, not ${describe(operand)}. Write ["value"] for a single value.`
    );
  }
  // An empty `in` matches nothing, and the translators used to drop it, so the
  // condition vanished and every row matched instead. An empty `not_in`
  // excludes nothing, which is what it says, so it stays well formed.
  if (operator === "in" && operand.length === 0) {
    return {
      code: "FILTER_EMPTY_IN",
      message: `"in" has an empty list, which matches no entry. Leave the condition out, or skip the query.`,
    };
  }
  for (let i = 0; i < operand.length; i++) {
    if (!isScalar(operand[i])) {
      return invalid(
        `"${operator}" may only list strings, numbers, booleans or dates, not ${describe(operand[i])}.`
      );
    }
  }
  return undefined;
};

/** A geo operand: text its own parser can read. */
const geo =
  (parse: (value: string) => unknown, shape: string): OperandRule =>
  (operator, operand) =>
    typeof operand === "string" && parse(operand) !== null
      ? undefined
      : invalid(`"${operator}" needs ${shape}.`);

const EQUALITY = accepting(isScalar, "a string, number, boolean or date");
const ORDERED = accepting(isOrderable, "a string, number or date");
const TEXT = accepting(isMatchable, "a string");

/**
 * Every operator a filter may use, SQL and geo alike, with what its operand
 * may be. One table, so an operator cannot be accepted without a rule for its
 * operand, and {@link FILTER_OPERATORS} is read from it rather than kept
 * beside it.
 */
const OPERAND_RULES: Readonly<Record<string, OperandRule>> = {
  equals: EQUALITY,
  not_equals: EQUALITY,
  greater_than: ORDERED,
  greater_than_equal: ORDERED,
  less_than: ORDERED,
  less_than_equal: ORDERED,
  like: TEXT,
  contains: TEXT,
  search: TEXT,
  in: membership,
  not_in: membership,
  exists: accepting(
    value =>
      value === true ||
      value === false ||
      value === "true" ||
      value === "false",
    "true or false"
  ),
  near: geo(
    parseNearQuery,
    '"longitude,latitude,maxDistance[,minDistance][,unit]"'
  ),
  // A circle is the one region the parser reads.
  within: geo(parseWithinQuery, '"longitude,latitude,radius[,unit]"'),
};

/** Every operator a filter may use, SQL and geo alike. */
export const FILTER_OPERATORS: ReadonlySet<string> = new Set(
  Object.keys(OPERAND_RULES)
);

/**
 * What is wrong with a known operator's operand, or `undefined` when usable.
 *
 * `null` is refused for every operator: `equals: null` compiles to `= NULL`,
 * which matches no row in SQL, so the caller who wrote it meant `exists:
 * false` and would otherwise get an empty answer with no reason given.
 */
function operandIssue(
  operator: string,
  operand: unknown
): OperandIssue | undefined {
  if (operand === undefined) {
    return {
      code: "FILTER_UNDEFINED_VALUE",
      message: `"${operator}" has no value (undefined). Give it a value, or leave the condition out.`,
    };
  }
  if (operand === null) return invalid(nullAdvice(operator));
  return OPERAND_RULES[operator](operator, operand);
}

/**
 * What is wrong with a field's value when it is not an object of operators,
 * which as shorthand means `equals`.
 */
function shorthandIssue(key: string, value: unknown): OperandIssue | undefined {
  if (value === undefined) {
    return {
      code: "FILTER_UNDEFINED_VALUE",
      message: `"${key}" has no value (undefined). Give it a condition, or leave the field out.`,
    };
  }
  if (value === null) {
    return invalid(
      `"${key}" cannot be compared with null. To match an empty field, write { exists: false }.`
    );
  }
  if (Array.isArray(value)) {
    return invalid(
      `"${key}" was given a list. To match any of several values, write { in: [...] }.`
    );
  }
  return EQUALITY("equals", value);
}

/** The problems with one field's object of operators, appended to `into`. */
function operatorProblems(
  path: string,
  key: string,
  condition: Record<string, unknown>,
  into: FilterProblem[]
): void {
  const operators = Object.entries(condition);
  if (operators.length === 0) {
    into.push({
      path,
      code: "FILTER_NO_OPERATOR",
      message: `"${key}" has an empty condition. Name an operator, such as { equals: … }, or leave the field out.`,
    });
    return;
  }
  for (const [operator, operand] of operators) {
    const issue = FILTER_OPERATORS.has(operator)
      ? operandIssue(operator, operand)
      : {
          code: "FILTER_UNKNOWN_OPERATOR",
          message: `"${operator}" is not a filter operator. Use one of: ${[...FILTER_OPERATORS].join(", ")}.`,
        };
    if (issue) into.push({ path: `${path}.${operator}`, ...issue });
  }
}

/** The problems with one field's condition, appended to `into`. */
function fieldProblems(
  path: string,
  key: string,
  value: unknown,
  into: FilterProblem[]
): void {
  if (key === TRANSLATED_KEY) {
    into.push({
      path,
      code: "FILTER_MISPLACED_KEY",
      message: `"${TRANSLATED_KEY}" filters by language and may only be given at the top level of a filter, as { "${TRANSLATED_KEY}": { "locale": "…", "state": "…" } }.`,
    });
    return;
  }
  // The workflow keys are conditions on other tables, read only at the top
  // level, like the language filter. Below it they would reach the condition
  // builder as a field name.
  if (isWorkflowKey(key)) {
    into.push({
      path,
      code: "FILTER_MISPLACED_KEY",
      message: `"${key}" ${WORKFLOW_KEY_PURPOSE[key]} and may only be given at the top level of a filter, as ${workflowKeyForm(key)}.`,
    });
    return;
  }
  // Refused before any walk runs: a walk that rebuilds a filter by assignment
  // would set a prototype with it and lose the condition.
  if (key === PROTOTYPE_KEY) {
    into.push(unknownFieldProblem(path, key));
    return;
  }
  if (isPlainObject(value)) {
    operatorProblems(path, key, value, into);
    return;
  }
  const issue = shorthandIssue(key, value);
  if (issue) into.push({ path, ...issue });
}

/** The problems with the root's language filter, appended to `into`. */
function translatedProblems(value: unknown, into: FilterProblem[]): void {
  const states: readonly string[] = TRANSLATION_FILTER_STATES;
  if (
    isPlainObject(value) &&
    typeof value.locale === "string" &&
    value.locale.length > 0 &&
    typeof value.state === "string" &&
    states.includes(value.state) &&
    Object.keys(value).every(k => k === "locale" || k === "state")
  ) {
    return;
  }
  into.push({
    path: `where.${TRANSLATED_KEY}`,
    code: "FILTER_INVALID_OPERAND",
    message: `"${TRANSLATED_KEY}" needs { "locale": "<code>", "state": one of ${states.join(", ")} }.`,
  });
}

/** The problems with one filter node and everything under it. */
function nodeProblems(
  node: unknown,
  path: string,
  into: FilterProblem[],
  allowTranslated: boolean
): void {
  if (!isPlainObject(node)) {
    into.push({
      path,
      code: "FILTER_NOT_AN_OBJECT",
      message: `A filter must be an object of field conditions, not ${describe(node)}.`,
    });
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    const at = `${path}.${key}`;
    if (key === "and" || key === "or") {
      if (!Array.isArray(value)) {
        into.push({
          path: at,
          code: "FILTER_INVALID_LOGICAL",
          message: `"${key}" must be a list of filters, not ${describe(value)}.`,
        });
        continue;
      }
      // By index rather than `forEach`, which skips the holes of a sparse
      // list — and a query string such as `where[or][3]` with no `[0]` builds
      // exactly that. A hole is no filter, and must be refused like one.
      for (let i = 0; i < value.length; i++) {
        nodeProblems(value[i], `${at}.${i}`, into, false);
      }
      continue;
    }
    if (key === TRANSLATED_KEY && allowTranslated) {
      translatedProblems(value, into);
      continue;
    }
    if (isWorkflowKey(key) && allowTranslated) {
      const problem = workflowKeyProblem(key, value);
      if (problem) into.push(problem);
      continue;
    }
    fieldProblems(at, key, value, into);
  }
}

/**
 * Every problem with a filter's shape, without throwing.
 *
 * `allowTranslated` admits the reserved top-level keys: the language filter,
 * and the workflow keys `workflow-filter` reads (`_pendingChange`,
 * `_inRelease`). It is set by a caller that receives the whole filter; the
 * condition builder receives one with those keys already taken out, so there
 * each is refused wherever it is. The option keeps the name it had when the
 * language filter was the only reserved key, so no caller changes meaning.
 */
export function filterShapeProblems(
  where: unknown,
  opts: { allowTranslated?: boolean } = {}
): FilterProblem[] {
  const problems: FilterProblem[] = [];
  nodeProblems(where, "where", problems, opts.allowTranslated === true);
  return problems;
}

/**
 * Refuse a filter that is not well formed, naming every problem.
 *
 * `undefined` is no filter and passes. Anything else must be an object of
 * field conditions, each a value (meaning `equals`) or an object of known
 * operators with operands of the right type, nested through `and`/`or` lists.
 */
export function assertWellFormedFilter(
  where: unknown,
  opts: { allowTranslated?: boolean } = {}
): void {
  if (where === undefined) return;
  refuseFilterProblems(filterShapeProblems(where, opts));
}

/**
 * What to write instead of comparing with null. SQL's `= NULL` matches no
 * row, so the caller meant a test for an empty field; which one depends on
 * the operator, and an ordered comparison has no equivalent to offer.
 */
function nullAdvice(operator: string): string {
  const instead =
    operator === "equals"
      ? " To match an empty field, write { exists: false }."
      : operator === "not_equals"
        ? " To match a field with a value, write { exists: true }."
        : "";
  return `"${operator}" cannot compare with null.${instead}`;
}

/**
 * A copy of a filter's own data, read once, for checking and translating.
 *
 * Validating one read of a filter and translating another would let a getter
 * or a proxy answer the check with a restrictive value and the translator
 * with none. Each property is read exactly once here, and both steps then
 * work on the copy. Plain objects and lists are copied; every other value,
 * dates included, is kept as it is for the shape check to judge. A filter
 * nested past any real need is refused rather than copied without end.
 */
export function snapshotFilter<T>(value: T): T {
  return copyFilterValue(value, 0) as T;
}

function copyFilterValue(value: unknown, depth: number): unknown {
  if (depth > MAX_SNAPSHOT_DEPTH) {
    refuseFilterProblems([
      {
        path: "where",
        code: "FILTER_TOO_DEEP",
        message: `A filter may not nest more than ${MAX_SNAPSHOT_DEPTH} levels.`,
      },
    ]);
  }
  if (Array.isArray(value)) {
    // By index, so a hole is copied as the undefined it reads as and the
    // shape check refuses it.
    const list: unknown[] = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) {
      list[i] = copyFilterValue(value[i], depth + 1);
    }
    return list;
  }
  if (!isPlainObject(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    // Defined, not assigned, so a `__proto__` key stays a key for the shape
    // check to refuse.
    Object.defineProperty(copy, key, {
      value: copyFilterValue(value[key], depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copy;
}

/** Throw the one refusal for a malformed filter, if there is anything to say. */
export function refuseFilterProblems(problems: FilterProblem[]): void {
  if (problems.length === 0) return;
  throw NextlyError.validation({
    errors: problems,
    logContext: { filterProblems: problems.map(p => p.code) },
  });
}
