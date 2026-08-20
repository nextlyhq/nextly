/**
 * Query building type definitions for database-agnostic queries.
 *
 * @packageDocumentation
 */

import type { SqlParam } from "./core";

/**
 * Every supported WHERE clause operator, as a value.
 *
 * @remarks
 * - Standard comparison: =, !=, <, >, <=, >=
 * - Set operations: IN, NOT IN
 * - Pattern matching: LIKE, ILIKE (case-insensitive, PostgreSQL/emulated)
 * - NULL checks: IS NULL, IS NOT NULL
 * - Range: BETWEEN, NOT BETWEEN
 * - JSON/Array: CONTAINS, OVERLAPS
 *
 * This list is the source of truth and {@link WhereOperator} is derived from it,
 * rather than the two being written out separately. A guard that has to enumerate
 * the operators — a validator over caller input, or a test asserting the builder
 * handles or refuses each one — can only do that from a runtime value, and a
 * hand-kept copy of the union would agree with it on the day it was written and
 * silently stop agreeing the next time a member is added.
 *
 * @public
 */
export const WHERE_OPERATORS = [
  "=",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "IN",
  "NOT IN",
  "LIKE",
  "ILIKE",
  "IS NULL",
  "IS NOT NULL",
  "BETWEEN",
  "NOT BETWEEN",
  "CONTAINS", // JSON contains
  "OVERLAPS", // Array overlaps
] as const;

/**
 * Supported WHERE clause operators. Derived from {@link WHERE_OPERATORS}.
 *
 * @public
 */
export type WhereOperator = (typeof WHERE_OPERATORS)[number];

/**
 * Individual WHERE condition.
 *
 * @remarks
 * Represents a single condition in a WHERE clause. For IS NULL and IS NOT NULL
 * operators, the value field is optional.
 *
 * @public
 */
export interface WhereCondition {
  /** Column name to filter on */
  column: string;

  /** Comparison operator */
  op: WhereOperator;

  /** Value(s) to compare against (optional for IS NULL/IS NOT NULL) */
  value?: SqlParam | SqlParam[];

  /** Second value for BETWEEN operator */
  valueTo?: SqlParam;
}

/**
 * Complex WHERE clause with logical operators.
 *
 * @remarks
 * Supports nested conditions with AND, OR, and NOT logical operators.
 * Can be recursively nested for complex queries.
 *
 * @example
 * ```typescript
 * const where: WhereClause = {
 *   and: [
 *     { column: "status", op: "=", value: "published" },
 *     {
 *       or: [
 *         { column: "author", op: "=", value: "john" },
 *         { column: "author", op: "=", value: "jane" }
 *       ]
 *     }
 *   ]
 * };
 * ```
 *
 * @public
 */
export interface WhereClause {
  /** All conditions must be true (AND) */
  and?: (WhereCondition | WhereClause)[];

  /** At least one condition must be true (OR) */
  or?: (WhereCondition | WhereClause)[];

  /** Negate a condition (NOT) */
  not?: WhereCondition | WhereClause;
}

/**
 * ORDER BY specification for query results.
 *
 * @remarks
 * Controls the sorting of query results. NULL handling varies by database
 * but can be explicitly controlled with the nulls field.
 *
 * @public
 */
export interface OrderBySpec {
  /** Column name to sort by */
  column: string;

  /** Sort direction (default: asc) */
  direction?: "asc" | "desc";

  /** NULL value ordering (database-specific defaults vary) */
  nulls?: "first" | "last";
}

/**
 * JOIN specification for table joins.
 *
 * @remarks
 * Supports different types of JOINs. Note that complex joins may require
 * dialect-specific handling.
 *
 * @public
 */
export interface JoinSpec {
  /** Type of join */
  type: "inner" | "left" | "right" | "full";

  /** Table name to join */
  table: string;

  /** Join condition */
  on: {
    /** Column from the left table */
    leftColumn: string;
    /** Column from the right table */
    rightColumn: string;
  };

  /** Optional alias for the joined table */
  alias?: string;
}
