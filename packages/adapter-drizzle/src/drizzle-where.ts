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
  getColumns,
} from "drizzle-orm";

import { caseInsensitiveContains, containsPattern } from "./text-match";
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
      // Both sides lower-cased rather than drizzle's `ilike`, which emits the ILIKE keyword that
      // only PostgreSQL has: on MySQL and SQLite the statement failed to parse. It also keeps
      // MySQL from comparing under the column's collation, which a bare LIKE inherits and which
      // can be case-sensitive (`utf8mb4_bin`). The value stays a pattern: its `%` and `_` are
      // wildcards, as with LIKE.
      return sql`lower(${col}) like lower(${cond.value as string})`;
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
      // A substring match on a TEXT column, NOT JSON containment despite the operator's name.
      // The column is used uncast, so this is text-columns-only: PostgreSQL has no `LIKE` for
      // `json`/`jsonb` and the statement errors there, while MySQL and SQLite coerce and search
      // the serialized text. Casting per dialect would make it work on all three and is a
      // change to what the operator DOES, so it is not made here.
      //
      // The value is matched LITERALLY: a `%` or `_` the caller passed is a character to find,
      // not a wildcard, so both are escaped and the escape character is declared. Without that,
      // `CONTAINS "a%b"` silently widens to "a, anything, b" — and through `delete`, which takes
      // its where clause as a required argument, a widened match is a widened deletion.
      return sql`${col} like ${containsPattern(String(cond.value))} escape '!'`;
    case "ICONTAINS":
      return caseInsensitiveContains(col, String(cond.value));
    default:
      throw new Error(`Unsupported operator: ${cond.op}`);
  }
}
