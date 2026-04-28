/**
 * @revnixhq/adapter-sqlite
 *
 * SQLite database adapter for Nextly.
 * Extends DrizzleAdapter from @revnixhq/adapter-drizzle to provide SQLite-specific functionality.
 *
 * @remarks
 * This adapter uses the better-sqlite3 package for database connectivity and provides:
 * - Synchronous API wrapped for async interface compatibility
 * - Full transaction support with savepoints (via better-sqlite3's native transaction handling)
 * - CRUD operations with RETURNING clause support (SQLite 3.35+)
 * - WAL mode for better concurrent read performance
 * - In-memory and file-based database support
 *
 * @example
 * ```typescript
 * import { createSqliteAdapter } from '@revnixhq/adapter-sqlite';
 *
 * const adapter = createSqliteAdapter({
 *   url: 'file:./data/app.db',
 * });
 *
 * await adapter.connect();
 *
 * // Query data
 * const users = await adapter.select('users', {
 *   where: { and: [{ column: 'status', op: '=', value: 'active' }] },
 *   limit: 10,
 * });
 *
 * await adapter.disconnect();
 * ```
 *
 * @packageDocumentation
 */

import { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
// F17: connect-time DB version check shared across all adapters.
import {
  createDatabaseError,
  isDatabaseError,
  type SqliteAdapterConfig,
  type DatabaseCapabilities,
  type PoolStats,
  type TransactionContext,
  type TransactionOptions,
  type SqlParam,
  type WhereClause,
  type WhereCondition,
  type WhereOperator,
  type SelectOptions,
  type InsertOptions,
  type UpdateOptions,
  type DeleteOptions,
  type UpsertOptions,
  type OrderBySpec,
  type JoinSpec,
  type DatabaseError,
  type DatabaseErrorKind,
  type BaseAdapterConfig,
  type AdapterLogger,
} from "@revnixhq/adapter-drizzle/types";
import { checkDialectVersion } from "@revnixhq/adapter-drizzle/version-check";
import type Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";

// Re-export types for convenience
export type {
  SqliteAdapterConfig,
  DatabaseCapabilities,
  PoolStats,
  TransactionContext,
  TransactionOptions,
  SqlParam,
  WhereClause,
  WhereCondition,
  WhereOperator,
  SelectOptions,
  InsertOptions,
  UpdateOptions,
  DeleteOptions,
  UpsertOptions,
  OrderBySpec,
  JoinSpec,
  DatabaseError,
  DatabaseErrorKind,
  BaseAdapterConfig,
  AdapterLogger,
};

/**
 * Package version
 */
export const VERSION = "0.1.0";

/**
 * SQLite error codes mapping to DatabaseErrorKind.
 *
 * @see https://sqlite.org/rescode.html
 */
const SQLITE_ERROR_CODES: Record<string, DatabaseErrorKind> = {
  // Constraint violations
  SQLITE_CONSTRAINT: "constraint",
  SQLITE_CONSTRAINT_UNIQUE: "unique_violation",
  SQLITE_CONSTRAINT_PRIMARYKEY: "unique_violation",
  SQLITE_CONSTRAINT_FOREIGNKEY: "foreign_key_violation",
  SQLITE_CONSTRAINT_NOTNULL: "not_null_violation",
  SQLITE_CONSTRAINT_CHECK: "check_violation",

  // Busy/locked errors
  SQLITE_BUSY: "timeout",
  SQLITE_LOCKED: "timeout",

  // Connection errors
  SQLITE_CANTOPEN: "connection",
  SQLITE_NOTADB: "connection",
  SQLITE_CORRUPT: "connection",

  // Query errors
  SQLITE_ERROR: "query",
  SQLITE_MISUSE: "query",
  SQLITE_RANGE: "query",
};

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG = {
  busyTimeout: 5000,
  wal: true,
  foreignKeys: true,
};

/**
 * SQLite database adapter for Nextly.
 *
 * Extends the base DrizzleAdapter to provide SQLite-specific functionality
 * using the better-sqlite3 package.
 *
 * @remarks
 * SQLite has some differences from PostgreSQL:
 * - Synchronous API (wrapped for async compatibility)
 * - No connection pooling (single file/connection)
 * - RETURNING clause supported (SQLite 3.35+)
 * - Savepoints supported via nested transactions
 * - No native ILIKE (uses LOWER() LIKE workaround)
 * - JSON support (not JSONB)
 * - No array types
 *
 * @example
 * ```typescript
 * const adapter = new SqliteAdapter({
 *   url: 'file:./data.db',
 * });
 *
 * await adapter.connect();
 * ```
 */
export class SqliteAdapter extends DrizzleAdapter {
  /**
   * The database dialect - always 'sqlite' for this adapter.
   */
  readonly dialect = "sqlite" as const;

  /**
   * Adapter configuration.
   */
  protected readonly config: SqliteAdapterConfig;

  /**
   * better-sqlite3 Database instance.
   */
  private db: Database.Database | null = null;

  /**
   * Connection state flag.
   */
  private connected = false;

  /**
   * Creates a new SQLite adapter instance.
   *
   * @param config - Adapter configuration
   */
  constructor(config: SqliteAdapterConfig) {
    super();
    this.config = config;
  }

  /**
   * Connect to the SQLite database.
   *
   * @remarks
   * This method initializes the database connection. For SQLite, this
   * opens the database file or creates an in-memory database.
   * Also configures WAL mode and foreign keys based on config.
   *
   * @throws {DatabaseError} If connection fails
   */
  async connect(): Promise<void> {
    if (this.connected && this.db) {
      return;
    }

    try {
      // Dynamic import of better-sqlite3 to avoid bundling issues
      const BetterSqlite3 = await import("better-sqlite3");
      const Database = BetterSqlite3.default;

      // Determine database path
      let dbPath: string;
      if (this.config.memory) {
        dbPath = ":memory:";
      } else if (this.config.url) {
        // Strip file: prefix if present
        dbPath = this.config.url.replace(/^file:/, "");
      } else {
        dbPath = ":memory:";
      }

      // Create database instance
      this.db = new Database(dbPath, {
        readonly: this.config.readonly ?? false,
        timeout: this.config.busyTimeout ?? DEFAULT_CONFIG.busyTimeout,
      });

      // Configure WAL mode for better concurrency (unless in-memory or readonly)
      if (
        (this.config.wal ?? DEFAULT_CONFIG.wal) &&
        dbPath !== ":memory:" &&
        !this.config.readonly
      ) {
        this.db.pragma("journal_mode = WAL");
      }

      // Enable foreign keys
      if (this.config.foreignKeys ?? DEFAULT_CONFIG.foreignKeys) {
        this.db.pragma("foreign_keys = ON");
      }

      // F17: check SQLite version. Hard-fails on SQLite <3.38. SQLite has
      // no recognized cloud variants we warn on, so onWarning is omitted.
      // Note: better-sqlite3's bundled SQLite is set by the package
      // version; users on this package's pinned better-sqlite3 (3.45+)
      // will always pass.
      await checkDialectVersion(this.db, "sqlite");

      this.connected = true;

      if (this.config.logger?.info) {
        this.config.logger.info("SQLite connection established", {
          url: dbPath === ":memory:" ? "in-memory" : dbPath,
          wal: this.config.wal ?? DEFAULT_CONFIG.wal,
          foreignKeys: this.config.foreignKeys ?? DEFAULT_CONFIG.foreignKeys,
        });
      }
    } catch (error) {
      // Clean up on failure
      if (this.db) {
        try {
          this.db.close();
        } catch {
          // Ignore close errors during error handling
        }
        this.db = null;
      }
      throw this.classifyError(error);
    }
  }

  /**
   * Disconnect from the SQLite database.
   *
   * @remarks
   * This method closes the database connection and releases resources.
   */
  async disconnect(): Promise<void> {
    if (!this.db) {
      return;
    }

    try {
      this.db.close();

      if (this.config.logger?.info) {
        this.config.logger.info("SQLite connection closed");
      }
    } finally {
      this.db = null;
      this.connected = false;
    }
  }

  /**
   * Check if connected to the database.
   */
  isConnected(): boolean {
    return this.connected && this.db !== null;
  }

  /**
   * Get connection pool statistics.
   *
   * @remarks
   * SQLite doesn't use connection pooling, so this returns null.
   * The database is single-file with a single connection.
   */
  getPoolStats(): PoolStats | null {
    // SQLite doesn't have connection pooling
    return null;
  }

  /**
   * Execute a raw SQL query.
   *
   * @param sql - SQL query string with $1, $2 placeholders (converted to ? for SQLite)
   * @param params - Query parameters
   * @returns Query results
   *
   * @throws {DatabaseError} If query execution fails
   */
  async executeQuery<T = unknown>(
    sql: string,
    params: SqlParam[] = []
  ): Promise<T[]> {
    const db = this.ensureDb();
    const startTime = Date.now();

    try {
      // Convert $1, $2 placeholders to ? for better-sqlite3
      const convertedSql = this.convertPlaceholders(sql);

      // Determine if this is a SELECT query or a modifying query
      const trimmedSql = convertedSql.trim().toUpperCase();

      // Check for PRAGMA query statements (e.g., "PRAGMA foreign_keys").
      // Setting PRAGMAs (e.g., "PRAGMA foreign_keys = OFF") don't return data.
      const isPragmaQuery =
        trimmedSql.startsWith("PRAGMA") && !trimmedSql.includes("=");

      const isSelect =
        trimmedSql.startsWith("SELECT") ||
        isPragmaQuery ||
        trimmedSql.startsWith("WITH");
      const hasReturning = trimmedSql.includes("RETURNING");

      let result: T[];

      if (isSelect || hasReturning) {
        // Use .all() for SELECT queries or queries with RETURNING
        const stmt = db.prepare(convertedSql);
        result = stmt.all(...(params as unknown[])) as T[];
      } else {
        // Use .run() for INSERT/UPDATE/DELETE/PRAGMA settings without RETURNING
        const stmt = db.prepare(convertedSql);
        const runResult = stmt.run(...(params as unknown[]));
        // Return info about the operation
        result = [
          {
            changes: runResult.changes,
            lastInsertRowid: runResult.lastInsertRowid,
          } as unknown as T,
        ];
      }

      // Log query if logger configured
      if (this.config.logger?.query) {
        const durationMs = Date.now() - startTime;
        this.config.logger.query(convertedSql, params, durationMs);
      }

      return result;
    } catch (error) {
      throw this.classifyError(error, sql);
    }
  }

  /**
   * Execute work within a transaction.
   *
   * @param work - Function containing transactional operations
   * @param options - Transaction options (isolation level not fully supported in SQLite)
   * @returns Result of the work function
   *
   * @remarks
   * Uses better-sqlite3's native transaction handling which:
   * - Automatically commits on success
   * - Automatically rolls back on error
   * - Converts nested transactions to savepoints
   *
   * Note: SQLite uses DEFERRED, IMMEDIATE, or EXCLUSIVE transaction modes
   * rather than isolation levels. This adapter uses IMMEDIATE by default.
   */
  async transaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
    _options?: TransactionOptions
  ): Promise<T> {
    const db = this.ensureDb();
    const startTime = Date.now();

    try {
      // Create transaction context
      const ctx = this.createTransactionContext(db);

      // Since better-sqlite3's db.transaction() doesn't support async functions,
      // we manually manage the transaction with BEGIN/COMMIT/ROLLBACK
      db.exec("BEGIN IMMEDIATE");

      try {
        const result = await work(ctx);
        db.exec("COMMIT");

        // Log success
        if (this.config.logger?.debug) {
          const durationMs = Date.now() - startTime;
          this.config.logger.debug("Transaction committed", {
            durationMs,
          });
        }

        return result;
      } catch (error) {
        // Rollback on error
        try {
          db.exec("ROLLBACK");
        } catch {
          // Ignore rollback errors - transaction may already be aborted
        }
        throw error;
      }
    } catch (error) {
      throw this.classifyError(error);
    }
  }

  /**
   * Get SQLite database capabilities.
   *
   * @remarks
   * SQLite capabilities:
   * - JSON support (not JSONB)
   * - No arrays
   * - No native ILIKE
   * - RETURNING clause (3.35+)
   * - Savepoints supported
   * - ON CONFLICT supported
   */
  getCapabilities(): DatabaseCapabilities {
    return {
      dialect: "sqlite",
      supportsJsonb: false, // SQLite uses JSON, not JSONB
      supportsJson: true,
      supportsArrays: false, // SQLite doesn't support array types
      supportsGeneratedColumns: true, // SQLite 3.31+
      supportsFts: true, // SQLite FTS5
      supportsIlike: false, // No native ILIKE, use LOWER() LIKE
      supportsReturning: true, // SQLite 3.35+
      supportsSavepoints: true, // SQLite supports savepoints
      supportsOnConflict: true, // ON CONFLICT clause
      maxParamsPerQuery: 999, // SQLite SQLITE_MAX_VARIABLE_NUMBER default
      maxIdentifierLength: 128, // SQLite doesn't have a strict limit
    };
  }

  /**
   * Override insertMany for bulk insert optimization.
   *
   * @remarks
   * Uses a single multi-row INSERT statement for better performance.
   */
  override async insertMany<T = unknown>(
    table: string,
    data: Record<string, unknown>[],
    options?: InsertOptions
  ): Promise<T[]> {
    if (data.length === 0) {
      return [];
    }

    const db = this.ensureDb();

    // For single record, use parent implementation
    if (data.length === 1) {
      const result = await this.insert<T>(table, data[0], options);
      return [result];
    }

    // Build multi-row INSERT
    const columns = Object.keys(data[0]);
    const params: SqlParam[] = [];
    const valuesClauses: string[] = [];

    for (const record of data) {
      const placeholders: string[] = [];
      for (const col of columns) {
        params.push(record[col] as SqlParam);
        placeholders.push("?");
      }
      valuesClauses.push(`(${placeholders.join(", ")})`);
    }

    const columnList = columns
      .map(col => this.escapeIdentifier(col))
      .join(", ");
    let sql = `INSERT INTO ${this.escapeIdentifier(table)} (${columnList}) VALUES ${valuesClauses.join(", ")}`;

    // Add RETURNING clause
    if (options?.returning) {
      const returning =
        options.returning === "*"
          ? "*"
          : options.returning.map(col => this.escapeIdentifier(col)).join(", ");
      sql += ` RETURNING ${returning}`;
    } else {
      sql += " RETURNING *";
    }

    try {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...(params as unknown[])) as T[];
      return rows;
    } catch (error) {
      throw this.handleQueryError(error, "insertMany", table);
    }
  }

  // ============================================================
  // Protected Helper Methods
  // ============================================================

  /**
   * Ensures database is connected and returns it.
   *
   * @throws {DatabaseError} If not connected
   */
  private ensureDb(): Database.Database {
    if (!this.db) {
      throw createDatabaseError({
        kind: "connection",
        message: "SqliteAdapter is not connected. Call connect() first.",
      });
    }
    return this.db;
  }

  /**
   * Return the typed Drizzle instance for SQLite.
   * Guarded for server-only usage and requires an active connection.
   *
   * @param schema - Optional schema for relational queries (db.query.*)
   * @returns Drizzle ORM instance wrapping the better-sqlite3 connection
   * @throws {Error} If called in browser or not connected
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDrizzle<T = BetterSQLite3Database<any>>(
    schema?: Record<string, unknown>
  ): T {
    if (typeof window !== "undefined") {
      throw new Error("getDrizzle() is server-only");
    }
    const db = this.ensureDb();
    return (schema ? drizzle(db, { schema }) : drizzle(db)) as T;
  }

  /**
   * Convert $1, $2 placeholders to ? for better-sqlite3.
   *
   * @param sql - SQL with PostgreSQL-style placeholders
   * @returns SQL with ? placeholders
   */
  private convertPlaceholders(sql: string): string {
    // Replace $1, $2, etc. with ?
    return sql.replace(/\$\d+/g, "?");
  }

  /**
   * Creates a TransactionContext for the given database connection.
   */
  private createTransactionContext(db: Database.Database): TransactionContext {
    return {
      execute: async <T = unknown>(
        sql: string,
        params: SqlParam[] = []
      ): Promise<T[]> => {
        const convertedSql = this.convertPlaceholders(sql);
        const trimmedSql = convertedSql.trim().toUpperCase();
        const isSelect =
          trimmedSql.startsWith("SELECT") || trimmedSql.includes("RETURNING");

        if (isSelect) {
          const stmt = db.prepare(convertedSql);
          return stmt.all(...(params as unknown[])) as T[];
        } else {
          const stmt = db.prepare(convertedSql);
          const result = stmt.run(...(params as unknown[]));
          return [
            {
              changes: result.changes,
              lastInsertRowid: result.lastInsertRowid,
            } as unknown as T,
          ];
        }
      },

      insert: async <T = unknown>(
        table: string,
        data: Record<string, unknown>,
        options?: InsertOptions
      ): Promise<T> => {
        const columns = Object.keys(data);
        const values = Object.values(data);
        const placeholders = values.map(() => "?").join(", ");

        let sql = `INSERT INTO ${this.escapeIdentifier(table)} (${columns.map(c => this.escapeIdentifier(c)).join(", ")}) VALUES (${placeholders})`;

        if (options?.returning) {
          const returning =
            options.returning === "*"
              ? "*"
              : options.returning
                  .map(col => this.escapeIdentifier(col))
                  .join(", ");
          sql += ` RETURNING ${returning}`;
        } else {
          sql += " RETURNING *";
        }

        const stmt = db.prepare(sql);
        const rows = stmt.all(...values) as T[];
        return rows[0];
      },

      insertMany: async <T = unknown>(
        table: string,
        data: Record<string, unknown>[],
        options?: InsertOptions
      ): Promise<T[]> => {
        if (data.length === 0) return [];

        const columns = Object.keys(data[0]);
        const allValues: unknown[] = [];
        const valuesClauses: string[] = [];

        for (const record of data) {
          const placeholders: string[] = [];
          for (const col of columns) {
            allValues.push(record[col]);
            placeholders.push("?");
          }
          valuesClauses.push(`(${placeholders.join(", ")})`);
        }

        let sql = `INSERT INTO ${this.escapeIdentifier(table)} (${columns.map(c => this.escapeIdentifier(c)).join(", ")}) VALUES ${valuesClauses.join(", ")}`;

        if (options?.returning) {
          const returning =
            options.returning === "*"
              ? "*"
              : options.returning
                  .map(col => this.escapeIdentifier(col))
                  .join(", ");
          sql += ` RETURNING ${returning}`;
        } else {
          sql += " RETURNING *";
        }

        const stmt = db.prepare(sql);
        return stmt.all(...allValues) as T[];
      },

      // TransactionContext CRUD methods delegate to the adapter's CRUD
      // which uses Drizzle query API via the TableResolver.
      select: async <T = unknown>(
        table: string,
        options?: SelectOptions
      ): Promise<T[]> => {
        return this.select<T>(table, options);
      },

      selectOne: async <T = unknown>(
        table: string,
        options?: SelectOptions
      ): Promise<T | null> => {
        return this.selectOne<T>(table, options);
      },

      update: async <T = unknown>(
        table: string,
        data: Record<string, unknown>,
        where: WhereClause,
        options?: UpdateOptions
      ): Promise<T[]> => {
        return this.update<T>(table, data, where, options);
      },

      delete: async (
        table: string,
        where: WhereClause,
        _options?: DeleteOptions
      ): Promise<number> => {
        return this.delete(table, where);
      },

      upsert: async <T = unknown>(
        table: string,
        data: Record<string, unknown>,
        options: UpsertOptions
      ): Promise<T> => {
        return this.upsert<T>(table, data, options);
      },

      savepoint: async (name: string): Promise<void> => {
        db.exec(`SAVEPOINT ${this.escapeIdentifier(name)}`);
      },

      rollbackToSavepoint: async (name: string): Promise<void> => {
        db.exec(`ROLLBACK TO SAVEPOINT ${this.escapeIdentifier(name)}`);
      },

      releaseSavepoint: async (name: string): Promise<void> => {
        db.exec(`RELEASE SAVEPOINT ${this.escapeIdentifier(name)}`);
      },
    };
  }

  /**
   * Classifies a SQLite error into a DatabaseError.
   *
   * @param error - Original error from better-sqlite3
   * @param sql - SQL statement that caused the error (optional)
   * @returns DatabaseError with proper classification
   */
  private classifyError(error: unknown, sql?: string): DatabaseError {
    // Why short-circuit on existing DatabaseError: F17's
    // UnsupportedDialectVersionError is already a typed DatabaseError with
    // kind: "unsupported_version" plus detectedVersion/requiredVersion
    // fields. Re-wrapping it here would erase those fields.
    if (isDatabaseError(error)) return error;

    const sqliteError = error as {
      code?: string;
      message?: string;
      name?: string;
    };

    // Determine error kind from SQLite error code
    let kind: DatabaseErrorKind = "unknown";

    if (sqliteError.code) {
      kind = SQLITE_ERROR_CODES[sqliteError.code] || "unknown";
    } else if (sqliteError.message) {
      // Try to extract error type from message
      const msg = sqliteError.message.toUpperCase();
      if (msg.includes("UNIQUE CONSTRAINT")) {
        kind = "unique_violation";
      } else if (msg.includes("FOREIGN KEY CONSTRAINT")) {
        kind = "foreign_key_violation";
      } else if (msg.includes("NOT NULL CONSTRAINT")) {
        kind = "not_null_violation";
      } else if (msg.includes("CHECK CONSTRAINT")) {
        kind = "check_violation";
      } else if (msg.includes("BUSY") || msg.includes("LOCKED")) {
        kind = "timeout";
      } else if (
        msg.includes("SQLITE_CANTOPEN") ||
        msg.includes("UNABLE TO OPEN")
      ) {
        kind = "connection";
      }
    }

    // Build error message
    let message = sqliteError.message ?? String(error);
    if (sql && kind === "query") {
      message = `Query failed: ${message}`;
    }

    return createDatabaseError({
      kind,
      message,
      code: sqliteError.code,
      cause: error instanceof Error ? error : undefined,
    });
  }

  /**
   * Override handleQueryError to use SQLite-specific classification.
   */
  protected override handleQueryError(
    error: unknown,
    operation: string,
    table: string
  ): DatabaseError {
    const dbError = this.classifyError(error);

    // Add operation context if not already present
    if (!dbError.message.includes(operation)) {
      dbError.message = `${operation} operation failed on table '${table}': ${dbError.message}`;
    }

    if (!dbError.table) {
      dbError.table = table;
    }

    return dbError;
  }
}

/**
 * Create a SQLite database adapter.
 *
 * @param config - SQLite adapter configuration
 * @returns A new SqliteAdapter instance
 *
 * @example
 * ```typescript
 * // Simple usage with file path
 * const adapter = createSqliteAdapter({
 *   url: 'file:./data.db',
 * });
 *
 * // In-memory database
 * const memAdapter = createSqliteAdapter({
 *   memory: true,
 * });
 *
 * // Full configuration
 * const adapter = createSqliteAdapter({
 *   url: 'file:./data.db',
 *   wal: true,
 *   foreignKeys: true,
 *   busyTimeout: 5000,
 *   logger: {
 *     query: (sql, params, duration) => console.log(`Query: ${sql}`),
 *   },
 * });
 *
 * await adapter.connect();
 * ```
 */
export function createSqliteAdapter(
  config: SqliteAdapterConfig
): SqliteAdapter {
  return new SqliteAdapter(config);
}

/**
 * Type guard to check if a value is a SqliteAdapter.
 *
 * @param value - Value to check
 * @returns True if value is a SqliteAdapter instance
 *
 * @example
 * ```typescript
 * if (isSqliteAdapter(adapter)) {
 *   // TypeScript knows adapter is SqliteAdapter
 *   console.log('Using SQLite');
 * }
 * ```
 */
export function isSqliteAdapter(value: unknown): value is SqliteAdapter {
  return value instanceof SqliteAdapter;
}
