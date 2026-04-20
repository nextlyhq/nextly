/**
 * Transaction type definitions for database operations.
 *
 * @packageDocumentation
 */

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
}
