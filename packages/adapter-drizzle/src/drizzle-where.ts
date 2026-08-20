// Translates WhereClause objects into Drizzle SQL conditions.
// Used internally by the adapter's CRUD methods when a TableResolver is available.

import {
  eq,
  ne,
  gt,
  lt,
  gte,
  lte,
  like,
  ilike,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  between,
  notBetween,
  and,
  or,
  not,
  sql,
  type SQL,
} from "drizzle-orm";
import { getColumns } from "drizzle-orm";

import type { WhereClause, WhereCondition } from "./types";

// Build a Drizzle SQL condition from a WhereClause and a Drizzle table object.
// Returns undefined if the where clause is empty.
export function buildDrizzleWhere(
  table: Record<string, unknown>,
  where: WhereClause
): SQL | undefined {
  const columns = getColumns(table as never);
  return processWhereClause(columns, where);
}

function processWhereClause(
  columns: Record<string, unknown>,
  where: WhereClause
): SQL | undefined {
  const parts: SQL[] = [];

  if (where.and?.length) {
    const andParts = where.and
      .map(item => {
        if (isWhereCondition(item)) {
          return buildCondition(columns, item);
        }
        return processWhereClause(columns, item);
      })
      .filter((p): p is SQL => p !== undefined);

    if (andParts.length) {
      parts.push(and(...andParts)!);
    }
  }

  if (where.or?.length) {
    const orParts = where.or
      .map(item => {
        if (isWhereCondition(item)) {
          return buildCondition(columns, item);
        }
        return processWhereClause(columns, item);
      })
      .filter((p): p is SQL => p !== undefined);

    if (orParts.length) {
      parts.push(or(...orParts)!);
    }
  }

  if (where.not) {
    const notItem = where.not;
    const notCondition = isWhereCondition(notItem)
      ? buildCondition(columns, notItem)
      : processWhereClause(columns, notItem);

    if (notCondition) {
      parts.push(not(notCondition));
    }
  }

  if (parts.length === 0) {
    // A clause that named no branch at all is the caller saying "no filter", and `undefined` is
    // how that reaches the adapter. A clause that named one and produced nothing is a different
    // thing entirely: every branch it asked for evaporated — an `and`/`or` whose every member
    // resolved to nothing, or a `not` over such a member. Returning `undefined` for that is what
    // makes it dangerous rather than merely wrong, because `update` and `delete` take the where
    // clause as a REQUIRED argument and simply omit the WHERE when none comes back. A caller
    // that asked to delete a subset would delete the table. Refusing is consistent with the two
    // refusals below: this builder already rejects input it cannot express rather than
    // approximating it.
    if (namesABranch(where)) {
      throw new Error(
        `Where clause produced no condition: ${JSON.stringify(where)}. ` +
          `Every branch resolved to nothing, which would match every row. ` +
          `Pass {} to mean "no filter".`
      );
    }
    return undefined;
  }
  if (parts.length === 1) return parts[0];
  return and(...parts);
}

function isWhereCondition(
  item: WhereCondition | WhereClause
): item is WhereCondition {
  return "column" in item && "op" in item;
}

/**
 * Whether the clause asked for a constraint at all — as opposed to being the empty clause a
 * caller passes to mean "no filter".
 *
 * An empty `and`/`or` array does NOT count: nothing was named, so nothing could be dropped.
 * What counts is a branch with members in it, or a `not`, because those are the shapes that can
 * resolve to nothing and leave the caller believing a filter was applied.
 */
function namesABranch(where: WhereClause): boolean {
  // `||` and not `??`: an empty array's `length` is 0, which is defined, so `??` would stop at
  // the first branch that exists and never look at the others — `{ and: [], or: [{}] }` would
  // read as "named nothing" on the strength of the empty `and`.
  return Boolean(where.and?.length || where.or?.length || where.not);
}

/**
 * Wraps a value in `%…%` for a substring match, escaping the LIKE metacharacters inside it so
 * the value matches literally.
 *
 * `!` is the escape character rather than the more usual backslash, and it has to be, because
 * this builder emits one statement for every dialect. SQLite gives LIKE no default escape
 * character at all, so a backslash there is just a backslash; declaring `ESCAPE '\'` instead
 * runs into MySQL, where the backslash also escapes inside the string literal and the clause
 * would have to be spelled differently per dialect. `ESCAPE '!'` parses identically on
 * PostgreSQL, MySQL and SQLite, and needs no per-dialect branch to stay correct.
 *
 * The escape character is escaped FIRST by including it in the character class, so a literal
 * `!` in the value cannot be produced by escaping something else afterwards.
 */
function containsPattern(value: string): string {
  return `%${value.replace(/[!%_]/g, character => `!${character}`)}%`;
}

function buildCondition(
  columns: Record<string, unknown>,
  cond: WhereCondition
): SQL {
  const column = columns[cond.column];
  if (!column) {
    throw new Error(
      `Column "${cond.column}" not found in table. Available: ${Object.keys(columns).join(", ")}`
    );
  }

  const col = column as never;

  switch (cond.op) {
    case "=":
      return eq(col, cond.value);
    case "!=":
      return ne(col, cond.value);
    case ">":
      return gt(col, cond.value);
    case "<":
      return lt(col, cond.value);
    case ">=":
      return gte(col, cond.value);
    case "<=":
      return lte(col, cond.value);
    case "LIKE":
      return like(col, cond.value as string);
    case "ILIKE":
      return ilike(col, cond.value as string);
    case "IN":
      return inArray(col, cond.value as unknown[]);
    case "NOT IN":
      return notInArray(col, cond.value as unknown[]);
    case "IS NULL":
      return isNull(col);
    case "IS NOT NULL":
      return isNotNull(col);
    case "BETWEEN":
      return between(col, cond.value, cond.valueTo);
    case "NOT BETWEEN":
      return notBetween(col, cond.value, cond.valueTo);
    case "CONTAINS":
      // JSON contains - fall back to a substring LIKE for basic support. The value is matched
      // LITERALLY: a `%` or `_` the caller passed is a character to find, not a wildcard, so
      // both are escaped and the escape character is declared. Without that, `CONTAINS "a%b"`
      // silently widens to "a, anything, b" — and through `delete`, which takes its where clause
      // as a required argument, a widened match is a widened deletion.
      return sql`${col} like ${containsPattern(String(cond.value))} escape '!'`;
    default:
      throw new Error(`Unsupported operator: ${cond.op}`);
  }
}
