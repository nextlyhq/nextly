/**
 * A where condition judged against a row in memory, as the database judges
 * it in a query.
 *
 * The ONE evaluator of the conditions the releases domain hands the adapter,
 * so a rule stated once as a condition can be both a query and a predicate:
 * the tabs (`releaseTabOf`) and the due boundary (`release-due`) read rows
 * through it rather than restating their rules in code beside their queries.
 *
 * @module domains/releases/release-conditions
 */
import type { VersionsWhere, VersionsWhereCondition } from "../versions/db-api";

/** One condition or a nested group, the shapes a releases query uses. */
export type ReleaseCondition = VersionsWhereCondition | VersionsWhere;

/**
 * Whether a row meets a condition. Only the operators the releases domain
 * uses are understood, and an unknown one answers `false` rather than `true`:
 * a release that met every tab would be counted several times.
 */
export function meetsCondition(
  row: object,
  condition: ReleaseCondition
): boolean {
  return "column" in condition
    ? compares(row, condition)
    : groupHolds(row, condition);
}

/**
 * A nested group: every `and` holds, and at least one `or` does when an `or`
 * is given — the reading the adapter gives the same shape.
 */
function groupHolds(row: object, group: VersionsWhere): boolean {
  const all = (group.and ?? []).every(c => meetsCondition(row, c));
  return (
    all &&
    (group.or === undefined || group.or.some(c => meetsCondition(row, c)))
  );
}

/** One column against one value. */
function compares(row: object, condition: VersionsWhereCondition): boolean {
  // Read by name: a releases row is a plain object whose keys are the
  // condition's columns.
  const actual: unknown = Reflect.get(row, condition.column);
  // A missing instant compares as SQL NULL does: it meets no comparison.
  if (actual === null || actual === undefined) return false;
  const a = comparable(actual);
  const expected = condition.value;
  switch (condition.op) {
    case "=":
      return a === comparable(expected);
    case "IN":
      return Array.isArray(expected) && expected.some(v => comparable(v) === a);
    case ">=":
      return (a as number) >= (comparable(expected) as number);
    case "<=":
      return (a as number) <= (comparable(expected) as number);
    case "<":
      return (a as number) < (comparable(expected) as number);
    case "!=":
      return a !== comparable(expected);
    default:
      return false;
  }
}

/** Instants compared as numbers, as the database compares them. */
function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}
