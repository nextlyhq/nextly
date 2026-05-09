/**
 * CRUD operation type definitions.
 *
 * @packageDocumentation
 */

import type { WhereClause, OrderBySpec, JoinSpec } from "./query";

/**
 * Options for SELECT queries.
 *
 * @remarks
 * Provides a database-agnostic way to build SELECT queries with filtering,
 * sorting, pagination, and joins.
 *
 * @public
 */
export interface SelectOptions {
  /** Specific columns to select (default: all columns) */
  columns?: string[];

  /** Filter conditions */
  where?: WhereClause;

  /** Sort order */
  orderBy?: OrderBySpec[];

  /** Maximum number of rows to return */
  limit?: number;

  /** Number of rows to skip */
  offset?: number;

  /** Table joins */
  joins?: JoinSpec[];

  /** GROUP BY columns */
  groupBy?: string[];

  /** HAVING clause (for aggregated results) */
  having?: WhereClause;

  /** Return distinct rows only */
  distinct?: boolean;
}

/**
 * Options for INSERT operations.
 *
 * @remarks
 * Controls the behavior of INSERT operations including conflict handling
 * and returning inserted data.
 *
 * @public
 */
export interface InsertOptions {
  /** Columns to return after insert (use "*" for all columns) */
  returning?: string[] | "*";

  /** Handle conflicts (unique constraint violations) */
  onConflict?: {
    /** Columns that define the conflict (unique constraint) */
    columns: string[];

    /** Action to take on conflict */
    action: "ignore" | "update";

    /** Columns to update on conflict (required if action is "update") */
    updateColumns?: string[];
  };
}

/**
 * Options for UPDATE operations.
 *
 * @remarks
 * Controls what data is returned after an update operation.
 *
 * @public
 */
export interface UpdateOptions {
  /** Columns to return after update (use "*" for all columns) */
  returning?: string[] | "*";
}

/**
 * Options for DELETE operations.
 *
 * @remarks
 * Controls what data is returned after a delete operation.
 *
 * @public
 */
export interface DeleteOptions {
  /** Columns to return after delete (use "*" for all columns) */
  returning?: string[] | "*";
}

/**
 * Options for UPSERT operations (INSERT or UPDATE).
 *
 * @remarks
 * Combines INSERT and UPDATE behavior. If a row with the specified
 * conflict columns exists, it will be updated; otherwise, a new row
 * will be inserted.
 *
 * @public
 */
export interface UpsertOptions {
  /** Columns that define uniqueness for conflict detection */
  conflictColumns: string[];

  /** Columns to update if conflict occurs (default: all provided columns) */
  updateColumns?: string[];

  /** Columns to return after upsert (use "*" for all columns) */
  returning?: string[] | "*";
}
