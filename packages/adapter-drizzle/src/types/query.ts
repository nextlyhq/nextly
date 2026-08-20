/**
 * Query building type definitions for database-agnostic queries.
 *
 * @packageDocumentation
 */

import type { SqlParam } from "./core";

/**
 * Every WHERE clause operator this package DECLARES, as a value.
 *
 * @remarks
 * Declared, not guaranteed executable. Membership here means a `WhereCondition`
 * carrying the operator type-checks — it does NOT mean the adapter can run it.
 * `OVERLAPS` is declared and unimplemented, and throws at build time, so a
 * validator written against this list will admit input the query layer then
 * rejects. Validate against it to catch a misspelled operator; do not read
 * acceptance here as a capability.
 *
 * - Standard comparison: =, !=, <, >, <=, >=
 * - Set operations: IN, NOT IN
 * - Pattern matching: LIKE, ILIKE (case-insensitive, PostgreSQL/emulated)
 * - NULL checks: IS NULL, IS NOT NULL
 * - Range: BETWEEN, NOT BETWEEN
 * - Substring: CONTAINS — a LITERAL match on a TEXT column; see below
 * - Declared but NOT implemented: OVERLAPS, which throws
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
  // Substring match on a TEXT column, with the value taken literally. Despite the name it is
  // not JSON containment, and it is not safe to point at a JSON column: the builder emits a
  // bare `LIKE` with no cast, so on PostgreSQL a `json`/`jsonb` column has no matching operator
  // and the statement ERRORS (`operator does not exist: jsonb ~~ text`). MySQL and SQLite
  // coerce, and there it searches the serialized text — which hits a key name as readily as a
  // value. Text columns only, and a search rather than a containment check.
  "CONTAINS",
  // Declared, never implemented — the builder throws `Unsupported operator: OVERLAPS`. Kept in
  // the union because removing it would be a breaking change to a published type; the refusal
  // is pinned by a test so implementing it has to come through here.
  "OVERLAPS",
] as const;

/**
 * Every WHERE clause operator this package declares. Derived from
 * {@link WHERE_OPERATORS}, and carrying the same caveat: a value of this type
 * type-checks, which is not the same as the adapter being able to execute it.
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
