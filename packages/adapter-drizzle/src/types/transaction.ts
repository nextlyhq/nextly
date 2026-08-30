/**
 * Transaction type definitions for database operations.
 *
 * @packageDocumentation
 */

import type { SQL } from "drizzle-orm";

import type { SqlParam } from "./core";
import type {
  SelectOptions,
  InsertOptions,
  UpdateOptions,
  DeleteOptions,
  UpsertOptions,
} from "./crud";
import type { WhereClause } from "./query";

/**
 * Transaction isolation levels.
 *
 * @remarks
 * Controls the visibility of changes between concurrent transactions.
 * Not all levels are supported by all databases:
 * - PostgreSQL: All levels supported
 * - MySQL: All levels supported
 * - SQLite: Serializable only (default)
 *
 * @public
 */
export type TransactionIsolationLevel =
  | "read uncommitted"
  | "read committed"
  | "repeatable read"
  | "serializable";

/**
 * Options for transaction execution.
 *
 * @remarks
 * Configures transaction behavior including isolation level, read-only mode,
 * timeouts, and retry logic.
 *
 * @public
 */
export interface TransactionOptions {
  /** Transaction isolation level */
  isolationLevel?: TransactionIsolationLevel;

  /** Read-only transaction (optimization hint) */
  readOnly?: boolean;

  /** Per-transaction statement timeout in milliseconds */
  timeoutMs?: number;

  /** Number of retry attempts on serialization failures (default: 0) */
  retryCount?: number;

  /** Delay between retry attempts in milliseconds (default: 100) */
  retryDelayMs?: number;
}

/**
 * Transaction context for executing operations within a transaction.
 *
 * @remarks
 * All operations executed through this context are part of the same
 * database transaction. The transaction is automatically committed on
 * success or rolled back on error.
 *
 * Savepoint methods are optional and only available on databases that
 * support them (PostgreSQL, SQLite).
 *
 * @public
 */
export interface TransactionContext {
  /**
   * Execute raw SQL within the transaction.
   *
   * @param sql - SQL statement to execute
   * @param params - Optional parameters for the statement
   * @returns Array of result rows
   */
  execute<T = unknown>(sql: string, params?: SqlParam[]): Promise<T[]>;

  /**
   * Run a Drizzle-built statement within the transaction, for its effect.
   *
   * @remarks
   * The typed CRUD methods below resolve their table through the schema
   * registry and reject any name it does not declare. That leaves no way to
   * write to a table addressed under a name the ORM does not know — a table
   * mid-rename, most of all — other than assembling SQL by hand, which also
   * means hand-picking each driver's placeholder syntax.
   *
   * This accepts Drizzle's `sql` template instead, so identifier quoting and
   * parameter binding are generated for the dialect in use. Implemented per
   * adapter because the underlying call is not uniform: node-postgres and
   * mysql2 expose `execute`, while better-sqlite3 needs `run` and throws on a
   * statement that returns no rows.
   *
   * Returns nothing: this is for statements run to change data, not to read it.
   *
   * @param statement - Drizzle `sql` template to run
   */
  runStatement(statement: SQL): Promise<void>;

  /**
   * Run a Drizzle-built statement within the transaction and return its rows.
   *
   * @remarks
   * The reading half of `runStatement`, for the same reason: a table the schema
   * registry does not declare cannot be reached through the typed CRUD methods,
   * which reject the name outright. Implemented per adapter because the drivers
   * disagree about both the call and the result — node-postgres answers
   * `{ rows }`, mysql2 a `[rows, fields]` tuple, and better-sqlite3 needs `all`.
   *
   * @param statement - Drizzle `sql` template to run
   * @returns Rows the statement produced
   */
  queryStatement<T = Record<string, unknown>>(statement: SQL): Promise<T[]>;

  /**
   * Take an exclusive lock on a single row for the rest of this transaction.
   *
   * @remarks
   * For read-modify-write sequences that must not interleave: without a lock
   * another transaction can commit between the read and the write, leaving the
   * caller's view of the prior state inconsistent with what its own write
   * applied on top of.
   *
   * No-ops on dialects without row-level locking. SQLite is the case that
   * matters and needs nothing — its transactions open with `BEGIN IMMEDIATE`,
   * which already serializes writers.
   *
   * @param table - Table name
   * @param id - Primary-key value of the row to lock
   */
  lockRow(table: string, id: SqlParam): Promise<void>;

  /**
   * Insert a single record.
   *
   * @param table - Table name
   * @param data - Record data to insert
   * @param options - Insert options
   * @returns Inserted record (with RETURNING columns if specified)
   */
  insert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options?: InsertOptions
  ): Promise<T>;

  /**
   * Insert multiple records.
   *
   * @param table - Table name
   * @param data - Array of records to insert
   * @param options - Insert options
   * @returns Inserted records (with RETURNING columns if specified)
   */
  insertMany<T = unknown>(
    table: string,
    data: Record<string, unknown>[],
    options?: InsertOptions
  ): Promise<T[]>;

  /**
   * Select multiple records.
   *
   * @param table - Table name
   * @param options - Select options (filtering, sorting, etc.)
   * @returns Array of matching records
   */
  select<T = unknown>(table: string, options?: SelectOptions): Promise<T[]>;

  /**
   * Select a single record.
   *
   * @param table - Table name
   * @param options - Select options (filtering, sorting, etc.)
   * @returns First matching record or null
   */
  selectOne<T = unknown>(
    table: string,
    options?: SelectOptions
  ): Promise<T | null>;

  /**
   * Update records.
   *
   * @param table - Table name
   * @param data - Data to update
   * @param where - Conditions for records to update
   * @param options - Update options
   * @returns Updated records (with RETURNING columns if specified)
   */
  update<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    where: WhereClause,
    options?: UpdateOptions
  ): Promise<T[]>;

  /**
   * Update records and report how many rows the statement affected.
   *
   * @remarks
   * The transactional half of the adapter's `updateCount`, and the only way to
   * perform a fenced compare-and-set inside a transaction. `update` cannot
   * answer this: without `returning` it discards the driver's count, and WITH
   * `returning` on a dialect that lacks RETURNING it re-SELECTs using the same
   * WHERE — so a conditional update whose own write falsifies its predicate
   * reads back zero rows, and a write that landed reports as unmatched.
   *
   * 🔴 Inherits the adapter's MySQL caveat: MySQL counts CHANGED rows rather
   * than matched ones, so a caller using this as a compare-and-set must write
   * at least one column the update always moves — a state transition, a version
   * bump, a timestamp of sufficient resolution. Postgres (`rowCount`) and
   * SQLite (`changes`) count matched rows and do not need the precaution, which
   * is exactly why it cannot be dropped: the dialect where the distinction
   * exists is the one with no RETURNING to fall back on.
   *
   * @param table - Table name
   * @param data - Column values to write
   * @param where - Conditions the update must match
   * @returns Number of rows the statement affected
   */
  updateCount(
    table: string,
    data: Record<string, unknown>,
    where: WhereClause
  ): Promise<number>;

  /**
   * Delete records.
   *
   * @param table - Table name
   * @param where - Conditions for records to delete
   * @param options - Delete options
   * @returns Number of deleted records
   */
  delete(
    table: string,
    where: WhereClause,
    options?: DeleteOptions
  ): Promise<number>;

  /**
   * Upsert a record (INSERT or UPDATE).
   *
   * @param table - Table name
   * @param data - Record data
   * @param options - Upsert options (must specify conflict columns)
   * @returns Upserted record (with RETURNING columns if specified)
   */
  upsert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options: UpsertOptions
  ): Promise<T>;

  /**
   * Create a savepoint (PostgreSQL, SQLite only).
   *
   * @remarks
   * Savepoints allow partial rollback within a transaction.
   * Not supported on MySQL.
   *
   * @param name - Savepoint name
   */
  savepoint?(name: string): Promise<void>;

  /**
   * Rollback to a savepoint (PostgreSQL, SQLite only).
   *
   * @remarks
   * Discards all changes made after the savepoint was created.
   *
   * @param name - Savepoint name
   */
  rollbackToSavepoint?(name: string): Promise<void>;

  /**
   * Release a savepoint (PostgreSQL, SQLite only).
   *
   * @remarks
   * Commits the savepoint, making its changes permanent within the transaction.
   *
   * @param name - Savepoint name
   */
  releaseSavepoint?(name: string): Promise<void>;

  /**
   * Return the Drizzle ORM instance bound to THIS transaction's connection.
   *
   * @remarks
   * Runs Drizzle `sql` templates / fluent queries inside the caller's
   * transaction (same client the delegated CRUD methods use), so services
   * that drop to Drizzle raw SQL (e.g. junction-table writes) can participate
   * in the transaction instead of running on the pooled connection. Required
   * so callers never silently fall back to the pooled connection (which would
   * run a write outside the transaction); every adapter must implement it.
   * Generic return so callers narrow to the dialect Drizzle type they need
   * without an `any` cast.
   */
  getDrizzle<T = unknown>(): T;
}
