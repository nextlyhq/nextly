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
  type SQL,
} from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";

import type { WhereClause, WhereCondition } from "./types";

// Build a Drizzle SQL condition from a WhereClause and a Drizzle table object.
// Returns undefined if the where clause is empty.
export function buildDrizzleWhere(
  table: Record<string, unknown>,
  where: WhereClause
): SQL | undefined {
  const columns = getTableColumns(table as never);
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

  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return and(...parts);
}

function isWhereCondition(
  item: WhereCondition | WhereClause
): item is WhereCondition {
  return "column" in item && "op" in item;
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
      // JSON contains - fall back to LIKE for basic support
      return like(col, `%${String(cond.value)}%`);
    default:
      throw new Error(`Unsupported operator: ${cond.op}`);
  }
}
