/**
 * A contribution's visibility rule: a small declared language over one row,
 * and the one function that answers it.
 *
 * Its own module, importing nothing, so the admin's browser bundle and the
 * server evaluate a rule with the same function: the admin to decide whether
 * to show a contribution, the server to decide whether its action may run.
 * Two evaluators of one rule drift, and the drift would be a visible action
 * the server refuses or, worse, one it allows that the admin hid.
 *
 * The row is the row as the reader's read returned it, and a read leaves out
 * a field the reader may not read. A field missing from the row is therefore
 * one whose value the reader has no right to, and a rule that needs it answers
 * no, `exists` and `not` included. Evaluation is three-valued: a leaf on a
 * missing field is unknown, `and`, `or` and `not` combine unknowns as Kleene's
 * logic does, and an unknown answer is no. So a rule answers yes only when the
 * fields the reader can see settle it, whatever the hidden ones hold.
 *
 * @module plugins/row-predicate
 * @experimental
 */

/** @experimental A value a rule compares a field with. */
export type RowPredicateValue = string | number | boolean | null;

/**
 * @experimental A visibility rule over one row: a field compared with a value,
 * or rules combined. `field` is a field's name, or a dotted path into a group.
 */
export type RowPredicate =
  | { field: string; equals: RowPredicateValue }
  | { field: string; notEquals: RowPredicateValue }
  | { field: string; in: RowPredicateValue[] }
  | { field: string; exists: boolean }
  | { and: RowPredicate[] }
  | { or: RowPredicate[] }
  | { not: RowPredicate };

/** The operators a leaf may use, one per leaf. */
const OPERATORS = ["equals", "notEquals", "in", "exists"] as const;

/** How deeply rules may nest, so a declared rule cannot exhaust the stack. */
const MAX_DEPTH = 32;

/** A path segment: what a field's name may be. */
const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Unknown is neither yes nor no: the row lacks a field the answer needs. */
type Verdict = boolean | "unknown";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValue(value: unknown): value is RowPredicateValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/**
 * The field's value in the row, or `missing` when the row does not hold it.
 * Own properties only, so `toString` is not a field every row holds.
 */
function fieldValue(
  row: unknown,
  path: string
): { held: true; value: unknown } | { held: false } {
  let current: unknown = row;
  for (const segment of path.split(".")) {
    if (
      !isRecord(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return { held: false };
    }
    current = current[segment];
  }
  return { held: true, value: current };
}

function leafVerdict(
  predicate: Record<string, unknown>,
  row: unknown
): Verdict {
  const found = fieldValue(row, predicate.field as string);
  if (!found.held) return "unknown";
  const { value } = found;
  if ("equals" in predicate) return value === predicate.equals;
  if ("notEquals" in predicate) return value !== predicate.notEquals;
  if ("in" in predicate) {
    return (predicate.in as unknown[]).some(candidate => candidate === value);
  }
  const exists = value !== null && value !== undefined;
  return exists === predicate.exists;
}

function verdict(predicate: RowPredicate, row: unknown): Verdict {
  if ("and" in predicate) {
    const verdicts = predicate.and.map(p => verdict(p, row));
    if (verdicts.includes(false)) return false;
    return verdicts.includes("unknown") ? "unknown" : true;
  }
  if ("or" in predicate) {
    const verdicts = predicate.or.map(p => verdict(p, row));
    if (verdicts.includes(true)) return true;
    return verdicts.includes("unknown") ? "unknown" : false;
  }
  if ("not" in predicate) {
    const inner = verdict(predicate.not, row);
    return inner === "unknown" ? "unknown" : !inner;
  }
  return leafVerdict(predicate, row);
}

/**
 * @experimental Whether `row` satisfies `predicate`. A rule that needs a field
 * the row does not hold answers false, unless the fields it does hold settle
 * the answer on their own.
 */
export function rowMatches(predicate: RowPredicate, row: unknown): boolean {
  return verdict(predicate, row) === true;
}

function leafProblems(
  node: Record<string, unknown>,
  at: string,
  problems: string[]
): void {
  const keys = Object.keys(node);
  const operators = keys.filter(key =>
    (OPERATORS as readonly string[]).includes(key)
  );
  const stray = keys.filter(
    key => key !== "field" && !(OPERATORS as readonly string[]).includes(key)
  );
  if (stray.length > 0) {
    problems.push(
      `${at} has the key "${stray[0]}", which a rule does not take`
    );
    return;
  }
  const field = node.field;
  if (
    typeof field !== "string" ||
    !field.split(".").every(segment => SEGMENT.test(segment))
  ) {
    problems.push(`${at}.field is not a field's name or a dotted path`);
  }
  if (operators.length !== 1) {
    problems.push(
      `${at} must compare with exactly one of ${OPERATORS.join(", ")}`
    );
    return;
  }
  const [operator] = operators;
  const operand = node[operator];
  if (operator === "exists") {
    if (typeof operand !== "boolean") {
      problems.push(`${at}.exists is not true or false`);
    }
  } else if (operator === "in") {
    if (!Array.isArray(operand) || !operand.every(isValue)) {
      problems.push(
        `${at}.in is not a list of strings, numbers, booleans or null`
      );
    }
  } else if (!isValue(operand)) {
    problems.push(`${at}.${operator} is not a string, number, boolean or null`);
  }
}

function listProblems(
  operand: unknown,
  at: string,
  depth: number,
  problems: string[]
): void {
  if (!Array.isArray(operand) || operand.length === 0) {
    problems.push(`${at} is not a list of one or more rules`);
    return;
  }
  operand.forEach((inner, i) =>
    nodeProblems(inner, `${at}[${i}]`, depth + 1, problems)
  );
}

function nodeProblems(
  node: unknown,
  at: string,
  depth: number,
  problems: string[]
): void {
  if (depth > MAX_DEPTH) {
    problems.push(`${at} nests more than ${MAX_DEPTH} rules deep`);
    return;
  }
  if (!isRecord(node)) {
    problems.push(`${at} is not a rule`);
    return;
  }
  const combinators = ["and", "or", "not"].filter(key => key in node);
  if (combinators.length === 0) {
    leafProblems(node, at, problems);
    return;
  }
  if (Object.keys(node).length !== 1) {
    problems.push(
      `${at} combines rules with exactly one of and, or, not, and nothing beside it`
    );
    return;
  }
  const [combinator] = combinators;
  if (combinator === "not") {
    nodeProblems(node.not, `${at}.not`, depth + 1, problems);
    return;
  }
  listProblems(node[combinator], `${at}.${combinator}`, depth, problems);
}

/**
 * @experimental Every problem with a declared rule, each a sentence naming
 * where it is, or none. Checked when the app starts, so the evaluator only
 * ever meets a well-formed rule.
 */
export function rowPredicateProblems(
  predicate: unknown,
  at = "visibleWhen"
): string[] {
  const problems: string[] = [];
  nodeProblems(predicate, at, 0, problems);
  return problems;
}

/** @experimental Every field a well-formed rule reads, sorted, once each. */
export function rowPredicateFields(predicate: RowPredicate): string[] {
  const fields = new Set<string>();
  const visit = (node: RowPredicate): void => {
    if ("and" in node) node.and.forEach(visit);
    else if ("or" in node) node.or.forEach(visit);
    else if ("not" in node) visit(node.not);
    else fields.add(node.field);
  };
  visit(predicate);
  return [...fields].sort();
}
