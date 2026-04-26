/**
 * @revnixhq/adapter-mysql
 *
 * MySQL database adapter for Nextly.
 * Extends DrizzleAdapter from @revnixhq/adapter-drizzle to provide MySQL-specific functionality.
 *
 * @remarks
 * This adapter uses the mysql2 package for database connectivity and provides:
 * - Connection pooling via mysql2 Pool
 * - Full transaction support with isolation levels
 * - CRUD operations with workarounds for missing RETURNING clause
 * - MySQL-specific error classification
 * - Automatic retry for deadlocks (error 1213)
 *
 * @example
 * ```typescript
 * import { createMySqlAdapter } from '@revnixhq/adapter-mysql';
 *
 * const adapter = createMySqlAdapter({
 *   url: process.env.DATABASE_URL!,
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
  type MySqlAdapterConfig,
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
  type PoolConfig,
  type SslConfig,
} from "@revnixhq/adapter-drizzle/types";
import { checkDialectVersion } from "@revnixhq/adapter-drizzle/version-check";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import type {
  PoolOptions,
  RowDataPacket,
  ResultSetHeader,
} from "mysql2/promise";

// mysql2 type definitions use mixin patterns that TypeScript struggles with.
// We define explicit interfaces for the methods we need.

/**
 * Query result type - either rows or a result header
 */
type QueryResult = RowDataPacket[] | RowDataPacket[][] | ResultSetHeader;

/**
 * Queryable interface for mysql2 connections
 */
interface Queryable {
  query<T extends QueryResult>(sql: string): Promise<[T, unknown]>;
  query<T extends QueryResult>(
    sql: string,
    values: unknown[]
  ): Promise<[T, unknown]>;
}

/**
 * mysql2 Pool interface with query method
 */
interface Pool extends Queryable {
  getConnection(): Promise<PoolConnection>;
  end(): Promise<void>;
  pool?: {
    _allConnections?: { length: number };
    _freeConnections?: { length: number };
    _connectionQueue?: { length: number };
  };
}

/**
 * mysql2 PoolConnection interface with query and release methods
 */
interface PoolConnection extends Queryable {
  release(): void;
}

// Re-export types for convenience
export type {
  MySqlAdapterConfig,
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
  PoolConfig,
  SslConfig,
};

/**
 * Package version
 */
export const VERSION = "0.1.0";

/**
 * Default pool configuration values.
 */
const DEFAULT_POOL_CONFIG = {
  min: 2,
  max: 10,
  idleTimeoutMs: 30000,
  connectionTimeoutMs: 10000,
};

/**
 * MySQL error codes mapping to DatabaseErrorKind.
 *
 * @see https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html
 */
const MYSQL_ERROR_CODES: Record<number, DatabaseErrorKind> = {
  // Unique/Duplicate key violations
  1022: "unique_violation", // ER_DUP_KEY
  1062: "unique_violation", // ER_DUP_ENTRY
  1169: "unique_violation", // ER_DUP_UNIQUE
  1586: "unique_violation", // ER_DUP_ENTRY_WITH_KEY_NAME

  // Foreign key violations
  1216: "foreign_key_violation", // ER_NO_REFERENCED_ROW
  1217: "foreign_key_violation", // ER_ROW_IS_REFERENCED
  1451: "foreign_key_violation", // ER_ROW_IS_REFERENCED_2
  1452: "foreign_key_violation", // ER_NO_REFERENCED_ROW_2

  // Not null violations
  1048: "not_null_violation", // ER_BAD_NULL_ERROR
  1364: "not_null_violation", // ER_NO_DEFAULT_FOR_FIELD

  // Check constraint violations (MySQL 8.0.16+)
  3819: "check_violation", // ER_CHECK_CONSTRAINT_VIOLATED

  // Deadlock
  1213: "deadlock", // ER_LOCK_DEADLOCK

  // Timeout
  1205: "timeout", // ER_LOCK_WAIT_TIMEOUT

  // Connection errors
  1040: "connection", // ER_CON_COUNT_ERROR - Too many connections
  1042: "connection", // ER_BAD_HOST_ERROR
  1043: "connection", // ER_HANDSHAKE_ERROR
  1044: "connection", // ER_DBACCESS_DENIED_ERROR
  1045: "connection", // ER_ACCESS_DENIED_ERROR
  1129: "connection", // ER_HOST_IS_BLOCKED
  1130: "connection", // ER_HOST_NOT_PRIVILEGED
  2002: "connection", // CR_CONNECTION_ERROR
  2003: "connection", // CR_CONN_HOST_ERROR
  2006: "connection", // CR_SERVER_GONE_ERROR
  2013: "connection", // CR_SERVER_LOST

  // Query errors
  1064: "query", // ER_PARSE_ERROR
  1146: "query", // ER_NO_SUCH_TABLE
  1054: "query", // ER_BAD_FIELD_ERROR
};

/**
 * Delay helper for retry logic.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * MySQL database adapter for Nextly.
 *
 * Extends the base DrizzleAdapter to provide MySQL-specific functionality
 * using the mysql2 package.
 *
 * @remarks
 * MySQL has some limitations compared to PostgreSQL:
 * - No native RETURNING clause (requires INSERT then SELECT)
 * - No native ILIKE (uses LOWER() LIKE workaround)
 * - No native JSONB (uses JSON type)
 * - No array types
 * - Savepoints disabled for safety (MySQL has nested transaction quirks)
 *
 * @example
 * ```typescript
 * const adapter = new MySqlAdapter({
 *   url: 'mysql://user:pass@localhost:3306/mydb',
 *   pool: { max: 20 },
 * });
 *
 * await adapter.connect();
 * ```
 */
export class MySqlAdapter extends DrizzleAdapter {
  /**
   * The database dialect - always 'mysql' for this adapter.
   */
  readonly dialect = "mysql" as const;

  /**
   * Adapter configuration.
   */
  protected readonly config: MySqlAdapterConfig;

  /**
   * Connection pool instance.
   */
  private pool: Pool | null = null;

  /**
   * Connection state flag.
   */
  private connected = false;

  /**
   * Creates a new MySQL adapter instance.
   *
   * @param config - Adapter configuration
   */
  constructor(config: MySqlAdapterConfig) {
    super();
    this.config = config;
  }

  /**
   * Connect to the MySQL database.
   * Creates a connection pool using mysql2.
   *
   * @remarks
   * This method initializes the connection pool and verifies connectivity
   * by executing a simple query. It is idempotent - calling it multiple
   * times will not create multiple pools.
   *
   * @throws {DatabaseError} If connection fails
   */
  async connect(): Promise<void> {
    if (this.connected && this.pool) {
      return;
    }

    try {
      const poolConfig = this.buildPoolConfig();
      // Cast to our Pool interface - mysql2's mixin types don't resolve properly
      this.pool = mysql.createPool(poolConfig) as unknown as Pool;

      // Verify connection with smoke test, then check dialect version.
      // Why: F17 hard-fails at connect on real MySQL <8.0 (no variant
      // token detected). Recognized variants (MariaDB, TiDB, Aurora,
      // PlanetScale, Vitess) log a warning via the adapter logger and
      // proceed. Truly unparseable strings hard-fail so users see the
      // issue at boot rather than mid-apply.
      const connection = await this.pool.getConnection();
      try {
        await connection.query("SELECT 1");
        await checkDialectVersion(connection, "mysql", {
          // Why: route variant warnings through the adapter's logger so
          // users see a single, consistent log surface.
          onWarning: msg => this.config.logger?.warn?.(msg),
        });
        this.connected = true;

        if (this.config.logger?.info) {
          this.config.logger.info("MySQL connection established", {
            host: this.config.host ?? "from URL",
            database: this.config.database ?? "from URL",
          });
        }
      } finally {
        connection.release();
      }
    } catch (error) {
      // Clean up on failure
      if (this.pool) {
        await this.pool.end().catch(() => {});
        this.pool = null;
      }
      throw this.classifyError(error);
    }
  }

  /**
   * Disconnect from the MySQL database.
   * Gracefully closes the connection pool.
   *
   * @remarks
   * This method is idempotent - calling it multiple times is safe.
   * It waits for all connections to be released before shutting down.
   */
  async disconnect(): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      await this.pool.end();

      if (this.config.logger?.info) {
        this.config.logger.info("MySQL connection closed");
      }
    } finally {
      this.pool = null;
      this.connected = false;
    }
  }

  /**
   * Check if connected to the database.
   */
  isConnected(): boolean {
    return this.connected && this.pool !== null;
  }

  /**
   * Get connection pool statistics.
   * Returns null if not connected.
   *
   * @remarks
   * MySQL2 pool exposes different stats than pg:
   * - _allConnections: all connections
   * - _freeConnections: idle connections
   * - _connectionQueue: waiting requests
   */
  getPoolStats(): PoolStats | null {
    if (!this.pool) {
      return null;
    }

    // mysql2 Pool internal properties (cast to access internals)
    const poolInternal = this.pool as unknown as {
      pool?: {
        _allConnections?: { length: number };
        _freeConnections?: { length: number };
        _connectionQueue?: { length: number };
      };
    };

    const internal = poolInternal.pool;
    if (!internal) {
      return {
        total: 0,
        idle: 0,
        waiting: 0,
        active: 0,
      };
    }

    const total = internal._allConnections?.length ?? 0;
    const idle = internal._freeConnections?.length ?? 0;
    const waiting = internal._connectionQueue?.length ?? 0;

    return {
      total,
      idle,
      waiting,
      active: total - idle,
    };
  }

  /**
   * Execute a raw SQL query.
   *
   * @param sql - SQL query string with ? placeholders
   * @param params - Query parameters
   * @returns Query results
   *
   * @throws {DatabaseError} If query execution fails
   */
  async executeQuery<T = unknown>(
    sql: string,
    params: SqlParam[] = []
  ): Promise<T[]> {
    const pool = this.ensurePool();
    const startTime = Date.now();

    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        sql,
        params as unknown[]
      );

      // Log query if logger configured
      if (this.config.logger?.query) {
        const durationMs = Date.now() - startTime;
        this.config.logger.query(sql, params, durationMs);
      }

      return rows as T[];
    } catch (error) {
      throw this.classifyError(error, sql);
    }
  }

  /**
   * Execute work within a transaction.
   *
   * @param work - Function containing transactional operations
   * @param options - Transaction options (isolation level, timeout, retry)
   * @returns Result of the work function
   *
   * @remarks
   * MySQL transactions support isolation levels. Automatic retry is
   * implemented for deadlocks (error 1213) when `retryCount` is specified.
   *
   * Note: Savepoints are disabled in this adapter for safety due to
   * MySQL's quirks with nested transactions.
   */
  async transaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> {
    const pool = this.ensurePool();
    const maxAttempts = (options?.retryCount ?? 0) + 1;
    const retryDelayMs = options?.retryDelayMs ?? 100;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const connection = await pool.getConnection();
      const startTime = Date.now();

      try {
        // Begin transaction with options
        await this.beginTransaction(connection, options);

        // Create transaction context
        const ctx = this.createTransactionContext(connection);

        // Execute callback
        const result = await work(ctx);

        // Commit transaction
        await connection.query("COMMIT");

        // Log success
        if (this.config.logger?.debug) {
          const durationMs = Date.now() - startTime;
          this.config.logger.debug("Transaction committed", {
            attempt,
            durationMs,
          });
        }

        return result;
      } catch (error) {
        // Rollback transaction
        await connection.query("ROLLBACK").catch(() => {});

        lastError = error;

        // Check if error is retryable (deadlock only per approved approach)
        const mysqlError = error as { errno?: number; code?: string };
        const isRetryable = mysqlError.errno === 1213; // ER_LOCK_DEADLOCK

        if (isRetryable && attempt < maxAttempts) {
          if (this.config.logger?.warn) {
            this.config.logger.warn(
              `Transaction failed with deadlock, retrying (${attempt}/${maxAttempts})`,
              { errno: mysqlError.errno, attempt }
            );
          }
          await delay(retryDelayMs * attempt); // Exponential backoff
          continue;
        }

        throw this.classifyError(error);
      } finally {
        connection.release();
      }
    }

    // Should not reach here, but handle just in case
    throw this.classifyError(lastError);
  }

  /**
   * Get MySQL database capabilities.
   *
   * @remarks
   * MySQL has some limitations:
   * - No JSONB (uses JSON)
   * - No arrays
   * - No native ILIKE
   * - No RETURNING clause
   * - Savepoints disabled for safety
   */
  getCapabilities(): DatabaseCapabilities {
    return {
      dialect: "mysql",
      supportsJsonb: false, // MySQL uses JSON, not JSONB
      supportsJson: true,
      supportsArrays: false, // MySQL doesn't support array types
      supportsGeneratedColumns: true, // MySQL 5.7.6+
      supportsFts: true, // MySQL has FULLTEXT indexes
      supportsIlike: false, // No native ILIKE, use LOWER() LIKE
      supportsReturning: false, // No RETURNING clause in MySQL
      supportsSavepoints: false, // Disabled for safety per approved approach
      supportsOnConflict: true, // ON DUPLICATE KEY UPDATE
      maxParamsPerQuery: 65535, // MySQL limit
      maxIdentifierLength: 64, // MySQL limit
    };
  }

  /**
   * Build a placeholder for MySQL (uses ? instead of $1, $2, etc.)
   *
   * @param _index - Parameter index (ignored for MySQL)
   * @returns The ? placeholder
   */
  protected buildPlaceholder(_index: number): string {
    return "?";
  }

  /**
   * Build multiple placeholders for MySQL.
   *
   * @param count - Number of placeholders needed
   * @param _startIndex - Starting index (ignored for MySQL)
   * @returns Comma-separated ? placeholders
   */
  protected buildPlaceholders(count: number, _startIndex: number = 0): string {
    return Array(count).fill("?").join(", ");
  }

  /**
   * Escape an identifier for MySQL (uses backticks instead of double quotes).
   *
   * @param identifier - The identifier to escape
   * @returns Escaped identifier with backticks
   */
  protected escapeIdentifier(identifier: string): string {
    // MySQL uses backticks for identifiers
    return `\`${identifier.replace(/`/g, "``")}\``;
  }

  // ============================================================
  // Protected Helper Methods
  // ============================================================

  /**
   * Ensures pool is connected and returns it.
   *
   * @throws {DatabaseError} If not connected
   */
  private ensurePool(): Pool {
    if (!this.pool) {
      throw createDatabaseError({
        kind: "connection",
        message: "MySqlAdapter is not connected. Call connect() first.",
      });
    }
    return this.pool;
  }

  /**
   * Return the typed Drizzle instance for MySQL.
   * Guarded for server-only usage and requires an active connection.
   *
   * @param schema - Optional schema for relational queries (db.query.*)
   * @returns Drizzle ORM instance wrapping the mysql2 pool connection
   * @throws {Error} If called in browser or not connected
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDrizzle<T = MySql2Database<any>>(schema?: Record<string, unknown>): T {
    if (typeof window !== "undefined") {
      throw new Error("getDrizzle() is server-only");
    }
    const pool = this.ensurePool();
    // Cast needed because mysql2/promise Pool type differs from drizzle's expected type
    // MySQL requires mode when schema is provided

    /* eslint-disable @typescript-eslint/no-explicit-any */
    return (
      schema
        ? drizzle({ client: pool as any, schema, mode: "default" })
        : drizzle(pool as any)
    ) as T;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  /**
   * Builds mysql2 Pool configuration from adapter config.
   */
  private buildPoolConfig(): PoolOptions {
    const config: PoolOptions = {};

    // Connection string or explicit options
    if (this.config.url) {
      config.uri = this.config.url;
    } else {
      if (this.config.host) config.host = this.config.host;
      if (this.config.port) config.port = this.config.port;
      if (this.config.database) config.database = this.config.database;
      if (this.config.user) config.user = this.config.user;
      if (this.config.password) config.password = this.config.password;
    }

    // Pool settings - mysql2 uses different property names
    config.connectionLimit = this.config.pool?.max ?? DEFAULT_POOL_CONFIG.max;
    config.idleTimeout =
      this.config.pool?.idleTimeoutMs ?? DEFAULT_POOL_CONFIG.idleTimeoutMs;
    config.connectTimeout =
      this.config.pool?.connectionTimeoutMs ??
      DEFAULT_POOL_CONFIG.connectionTimeoutMs;

    // Enable waiting for connections when pool is full
    config.waitForConnections = true;
    config.queueLimit = 0; // Unlimited queue

    // SSL configuration
    if (this.config.ssl) {
      if (typeof this.config.ssl === "boolean") {
        config.ssl = this.config.ssl ? {} : undefined;
      } else {
        config.ssl = {
          rejectUnauthorized: this.config.ssl.rejectUnauthorized,
          ca: this.config.ssl.ca,
          cert: this.config.ssl.cert,
          key: this.config.ssl.key,
        };
      }
    }

    // MySQL-specific options
    if (this.config.timezone) {
      config.timezone = this.config.timezone;
    }

    if (this.config.charset) {
      config.charset = this.config.charset;
    }

    // Enable multiple statements if needed (disabled by default for security)
    config.multipleStatements = false;

    // Date handling
    config.dateStrings = false; // Return Date objects

    return config;
  }

  /**
   * Begins a transaction with the specified options.
   */
  private async beginTransaction(
    connection: PoolConnection,
    options?: TransactionOptions
  ): Promise<void> {
    // Set isolation level if specified (must be done before BEGIN)
    if (options?.isolationLevel) {
      const isolationMap: Record<string, string> = {
        "read uncommitted": "READ UNCOMMITTED",
        "read committed": "READ COMMITTED",
        "repeatable read": "REPEATABLE READ",
        serializable: "SERIALIZABLE",
      };
      const level = isolationMap[options.isolationLevel];
      if (level) {
        await connection.query(`SET TRANSACTION ISOLATION LEVEL ${level}`);
      }
    }

    // Set read-only mode if specified
    if (options?.readOnly) {
      await connection.query("SET TRANSACTION READ ONLY");
    }

    // Begin the transaction
    await connection.query("START TRANSACTION");

    // Set lock wait timeout if specified
    if (options?.timeoutMs) {
      // MySQL uses seconds for lock_wait_timeout
      const timeoutSeconds = Math.ceil(options.timeoutMs / 1000);
      await connection.query(
        `SET SESSION innodb_lock_wait_timeout = ${timeoutSeconds}`
      );
    }
  }

  /**
   * Creates a TransactionContext for the given connection.
   *
   * @remarks
   * Note: Savepoint methods are not implemented (set to undefined)
   * as savepoints are disabled in this adapter per approved approach.
   */
  private createTransactionContext(
    connection: PoolConnection
  ): TransactionContext {
    return {
      execute: async <T = unknown>(
        sql: string,
        params: SqlParam[] = []
      ): Promise<T[]> => {
        const [rows] = await connection.query<RowDataPacket[]>(
          sql,
          params as unknown[]
        );
        return rows as T[];
      },

      insert: async <T = unknown>(
        table: string,
        data: Record<string, unknown>,
        _options?: InsertOptions
      ): Promise<T> => {
        const columns = Object.keys(data);
        const values = Object.values(data);
        const placeholders = this.buildPlaceholders(values.length, 0);

        const sql = `INSERT INTO ${this.escapeIdentifier(table)} (${columns.map(c => this.escapeIdentifier(c)).join(", ")}) VALUES (${placeholders})`;

        const [result] = await connection.query<ResultSetHeader>(sql, values);

        // MySQL doesn't have RETURNING, so we need to SELECT the inserted row
        // Use insertId if available (auto-increment), otherwise use all inserted values
        if (result.insertId) {
          const [rows] = await connection.query<RowDataPacket[]>(
            `SELECT * FROM ${this.escapeIdentifier(table)} WHERE id = ?`,
            [result.insertId]
          );
          return rows[0] as T;
        }

        // Fallback: SELECT by all inserted values
        const whereClauses = columns.map(
          c => `${this.escapeIdentifier(c)} = ?`
        );
        const [rows] = await connection.query<RowDataPacket[]>(
          `SELECT * FROM ${this.escapeIdentifier(table)} WHERE ${whereClauses.join(" AND ")} LIMIT 1`,
          values
        );
        return rows[0] as T;
      },

      insertMany: async <T = unknown>(
        table: string,
        data: Record<string, unknown>[],
        _options?: InsertOptions
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

        const sql = `INSERT INTO ${this.escapeIdentifier(table)} (${columns.map(c => this.escapeIdentifier(c)).join(", ")}) VALUES ${valuesClauses.join(", ")}`;

        const [result] = await connection.query<ResultSetHeader>(
          sql,
          allValues
        );

        // For bulk insert, we need to SELECT the inserted rows
        // MySQL's insertId gives the first auto-increment ID
        if (result.insertId && result.affectedRows > 0) {
          const ids: number[] = [];
          for (let i = 0; i < result.affectedRows; i++) {
            ids.push(result.insertId + i);
          }
          const placeholders = ids.map(() => "?").join(", ");
          const [rows] = await connection.query<RowDataPacket[]>(
            `SELECT * FROM ${this.escapeIdentifier(table)} WHERE id IN (${placeholders})`,
            ids
          );
          return rows as T[];
        }

        // Fallback: return empty if we can't determine inserted rows
        return [];
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

      // Savepoints disabled per approved approach
      savepoint: undefined,
      rollbackToSavepoint: undefined,
      releaseSavepoint: undefined,
    };
  }

  /**
   * Classifies a MySQL error into a DatabaseError.
   *
   * @param error - Original error from mysql2
   * @param sql - SQL statement that caused the error (optional)
   * @returns DatabaseError with proper classification
   */
  private classifyError(error: unknown, sql?: string): DatabaseError {
    // Why short-circuit on existing DatabaseError: F17's
    // UnsupportedDialectVersionError is already a typed DatabaseError with
    // kind: "unsupported_version" plus detectedVersion/requiredVersion
    // fields. Re-wrapping it here would erase those fields and re-tag it
    // as kind: "unknown".
    if (isDatabaseError(error)) return error;

    const mysqlError = error as {
      errno?: number;
      code?: string;
      sqlState?: string;
      message?: string;
      sql?: string;
    };

    // Determine error kind from MySQL error number
    const kind: DatabaseErrorKind =
      (mysqlError.errno && MYSQL_ERROR_CODES[mysqlError.errno]) || "unknown";

    // Build error message
    let message = mysqlError.message ?? String(error);
    if (sql && kind === "query") {
      message = `Query failed: ${message}`;
    }

    return createDatabaseError({
      kind,
      message,
      code: mysqlError.code ?? mysqlError.errno?.toString(),
      detail: mysqlError.sql,
      cause: error instanceof Error ? error : undefined,
    });
  }

  /**
   * Override handleQueryError to use MySQL-specific classification.
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
 * Create a MySQL database adapter.
 *
 * @param config - MySQL adapter configuration
 * @returns A new MySqlAdapter instance
 *
 * @example
 * ```typescript
 * // Simple usage with URL
 * const adapter = createMySqlAdapter({
 *   url: 'mysql://user:pass@localhost:3306/mydb',
 * });
 *
 * // Full configuration
 * const adapter = createMySqlAdapter({
 *   url: process.env.DATABASE_URL!,
 *   pool: {
 *     min: 2,
 *     max: 20,
 *     idleTimeoutMs: 30000,
 *     connectionTimeoutMs: 10000,
 *   },
 *   ssl: {
 *     rejectUnauthorized: true,
 *   },
 * });
 *
 * await adapter.connect();
 * ```
 */
export function createMySqlAdapter(config: MySqlAdapterConfig): MySqlAdapter {
  return new MySqlAdapter(config);
}

/**
 * Type guard to check if a value is a MySqlAdapter.
 *
 * @param value - Value to check
 * @returns True if value is a MySqlAdapter instance
 *
 * @example
 * ```typescript
 * if (isMySqlAdapter(adapter)) {
 *   // TypeScript knows adapter is MySqlAdapter
 *   console.log('Using MySQL');
 * }
 * ```
 */
export function isMySqlAdapter(value: unknown): value is MySqlAdapter {
  return value instanceof MySqlAdapter;
}
