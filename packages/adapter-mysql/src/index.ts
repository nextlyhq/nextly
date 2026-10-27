/**
 * @nextlyhq/adapter-mysql
 *
 * MySQL database adapter for Nextly.
 * Extends DrizzleAdapter from @nextlyhq/adapter-drizzle to provide MySQL-specific functionality.
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
 * import { createMySqlAdapter } from '@nextlyhq/adapter-mysql';
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

import { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
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
  isApplicationError,
} from "@nextlyhq/adapter-drizzle/types";
import {
  acceptsForShare,
  checkDialectVersion,
} from "@nextlyhq/adapter-drizzle/version-check";
import { and, eq, getColumns } from "drizzle-orm";
import type { AnyRelations, Column, SQL } from "drizzle-orm";
import { getTableConfig, type MySqlTable } from "drizzle-orm/mysql-core";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import type {
  Pool as CallbackPool,
  Connection as CallbackConnection,
} from "mysql2";
import mysql from "mysql2/promise";
import type {
  PoolOptions,
  RowDataPacket,
  ResultSetHeader,
} from "mysql2/promise";

import { boundPoolWait, type QueueingPool } from "./pool-wait";

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
  /** Returns the connection to the pool, for the next request to use. */
  release(): void;
  /** Closes the connection and removes it from the pool. */
  destroy(): void;
}

/**
 * What a transaction changed on its connection's session, to put back before
 * the connection returns to the pool; null when it changed nothing.
 *
 * MySQL has no transaction-scoped form of `innodb_lock_wait_timeout` or
 * `sql_mode`: a `SET SESSION` outlives the transaction, and the pooled
 * connection would carry one transaction's setting into every later query
 * handed it. Each field present is the session's value from before the
 * change, or null when it could not be read, and then the connection cannot
 * be put back.
 */
type SessionRestore = {
  lockWaitTimeout?: number | null;
  sqlMode?: string | null;
} | null;

/**
 * Puts back what a transaction changed on its connection's session. False
 * when that could not be done, and the connection must not be pooled.
 */
async function restoreSession(
  connection: PoolConnection,
  restore: SessionRestore
): Promise<boolean> {
  if (restore === null) return true;
  if (restore.lockWaitTimeout === null || restore.sqlMode === null) {
    return false;
  }
  try {
    if (restore.lockWaitTimeout !== undefined) {
      // An integer read from the server, never caller input.
      await connection.query(
        `SET SESSION innodb_lock_wait_timeout = ${restore.lockWaitTimeout}`
      );
    }
    if (restore.sqlMode !== undefined) {
      // Read from the server, and bound as a value all the same.
      await connection.query("SET SESSION sql_mode = ?", [restore.sqlMode]);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Ends a transaction's hold on its connection: back to the pool once its
 * session is as the transaction found it, or closed when it is not. A
 * connection whose ROLLBACK failed (`rollbackFailed`) may still be inside
 * the transaction, and the next request handed it would write into a
 * transaction nobody commits.
 */
async function returnTransactionConnection(
  connection: PoolConnection,
  rollbackFailed: boolean,
  restore: SessionRestore
): Promise<void> {
  if (!rollbackFailed && (await restoreSession(connection, restore))) {
    connection.release();
  } else {
    connection.destroy();
  }
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
  // How long a request waits for a connection, in the queue or opening one:
  // the same bound, and the same default, as the PostgreSQL adapter's.
  connectionTimeoutMs: 15000,
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
  // getDrizzle memoization: drizzle v1's constructor builds a relational
  // query builder per table in the relations config (~40 tables), and the
  // service layer resolves an instance on every db access — construct once
  // per relations object (identity-stable: the schema registry caches it
  // and hands out a NEW object on invalidation, which naturally misses
  // this cache and produces a fresh instance).
  private drizzleByRelations = new WeakMap<AnyRelations, unknown>();
  private drizzleBare: unknown;

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
   * Whether the server accepts `SELECT ... FOR SHARE`, read from its version
   * string at connect. Undefined until then, which callers treat as not known.
   */
  private sharedRowLock: boolean | undefined;
  private functionalIndexes: boolean | undefined;

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
      const pool = mysql.createPool(poolConfig);
      // mysql2 queues a request for a connection without limit; it fails as
      // busy past the same bound a new connection gets to open.
      boundPoolWait(
        pool.pool as unknown as QueueingPool,
        poolConfig.connectTimeout ?? 0
      );
      // Cast to our Pool interface - mysql2's mixin types don't resolve properly
      this.pool = pool as unknown as Pool;

      // Verify connection with smoke test, then check dialect version.
      // Why: F17 hard-fails at connect on real MySQL <8.0 (no variant
      // token detected). Recognized variants (MariaDB, TiDB, Aurora,
      // PlanetScale, Vitess) log a warning via the adapter logger and
      // proceed. Truly unparseable strings hard-fail so users see the
      // issue at boot rather than mid-apply.
      const connection = await this.pool.getConnection();
      try {
        await connection.query("SELECT 1");
        const { variant, functionalIndexes } = await checkDialectVersion(
          connection,
          "mysql",
          {
            // Why: route variant warnings through the adapter's logger so
            // users see a single, consistent log surface.
            onWarning: msg => this.config.logger?.warn?.(msg),
          }
        );
        // MariaDB and TiDB connect through this adapter too, and reject
        // `FOR SHARE`; the capability tells callers which lock they can take.
        this.sharedRowLock = acceptsForShare(variant);
        // Whether a unique index may key on an expression, which per-language uniqueness of a
        // translated value does.
        this.functionalIndexes = functionalIndexes;
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
    // Detach the pool FIRST, then drop the memoized drizzle instances —
    // this closes the repopulation window where a concurrent getDrizzle()
    // call during the (async) pool.end() could cache an instance wrapping
    // the closing pool.
    const pool = this.pool;
    this.pool = null;
    this.drizzleBare = undefined;
    this.drizzleByRelations = new WeakMap();
    if (!pool) {
      return;
    }

    try {
      await pool.end();

      if (this.config.logger?.info) {
        this.config.logger.info("MySQL connection closed");
      }
    } finally {
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
      // Outside the calling flow's transaction, if it has one (`notePoolAccess`).
      this.notePoolAccess(sql);
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
    // The calling flow's open transaction from BEGIN until COMMIT or ROLLBACK
    // has run, for `transactionOpenInFlow`.
    return this.runInFlowTransaction(() =>
      this.runTransactionAttempts(work, options)
    );
  }

  /** The attempts `transaction` makes, each on a connection of its own. */
  private async runTransactionAttempts<T>(
    work: (tx: TransactionContext) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> {
    const pool = this.ensurePool();
    const maxAttempts = (options?.retryCount ?? 0) + 1;
    const retryDelayMs = options?.retryDelayMs ?? 100;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const connection = await this.connectFlowTransaction(() =>
        pool.getConnection()
      );
      const startTime = Date.now();
      // Set when the ROLLBACK failed (`returnTransactionConnection`).
      let rollbackFailed = false;
      // What `beginTransaction` changed on the session, to put back once the
      // transaction has ended. Filled in as each change lands, so a setup
      // that fails part way still puts back what it had already changed.
      const restore: NonNullable<SessionRestore> = {};

      try {
        // Begin transaction with options
        await this.beginTransaction(connection, options, restore);

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
        await connection.query("ROLLBACK").catch(() => {
          rollbackFailed = true;
        });

        lastError = error;

        // Work inside a transaction may throw to roll the write back — a
        // refused value, a denied permission — and that is the application's
        // verdict, not the driver's failure. Rethrown before the retry check as
        // well as before classification: a refusal re-run is the same refusal,
        // and the caller must receive the code and payload it raised rather
        // than a generic database error with the detail stripped out.
        if (isApplicationError(error)) throw error;

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
        await returnTransactionConnection(connection, rollbackFailed, restore);
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
      sharedRowLock: this.sharedRowLock, // Known once connected
      functionalIndexes: this.functionalIndexes, // Known once connected
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
  getDrizzle<T = MySql2Database<AnyRelations>>(relations?: AnyRelations): T {
    if (typeof window !== "undefined") {
      throw new Error("getDrizzle() is server-only");
    }
    const pool = this.ensurePool();
    if (!relations) {
      this.drizzleBare ??= this.poolDrizzle(pool);
      return this.drizzleBare as T;
    }
    let cached = this.drizzleByRelations.get(relations);
    if (!cached) {
      cached = this.poolDrizzle(pool, relations);
      this.drizzleByRelations.set(relations, cached);
    }
    return cached as T;
  }

  /**
   * A Drizzle handle on the pool, for `getDrizzle`.
   *
   * Its `transaction` runs on a connection this adapter checks out and
   * returns itself (`pinDrizzleTransactions`): destroyed rather than pooled
   * when no ROLLBACK could be confirmed on it. And it counts for
   * `transactionOpenInFlow`, as the adapter's does.
   */
  private poolDrizzle(pool: Pool, relations?: AnyRelations) {
    // drizzle v1's mysql2 driver takes the CALLBACK pool and connection,
    // which the mysql2/promise wrappers expose on `.pool` and `.connection`:
    // handed a wrapper, it throws ("Cannot set properties of undefined
    // (setting 'supportBigNumbers')"). The pre-v1 `mode` option is gone.
    const onClient = (client: CallbackPool | CallbackConnection) =>
      relations ? drizzle({ client, relations }) : drizzle({ client });
    // The handle's own queries go to the pool, so it is handed a view of the
    // pool that reports them (`observedPool`).
    const callbackPool = this.observedPool(
      (pool as unknown as { pool: CallbackPool }).pool,
      ["query", "execute", "getConnection"]
    );
    return this.trackFlowTransactions(
      this.pinDrizzleTransactions(onClient(callbackPool), async () => {
        const connection = await this.connectFlowTransaction(() =>
          pool.getConnection()
        );
        return {
          drizzle: onClient(
            (connection as unknown as { connection: CallbackConnection })
              .connection
          ),
          rollback: () => connection.query("ROLLBACK"),
          release: dirty => {
            if (dirty) connection.destroy();
            else connection.release();
          },
        };
      })
    );
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

    // A request waits for a connection when the pool is full. The queue has
    // no length limit; each wait in it is bounded instead (`boundPoolWait`).
    config.waitForConnections = true;
    config.queueLimit = 0;

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
   * Begins a transaction with the specified options, recording in `changed`
   * each session setting it changes, as it changes it, for `restoreSession`
   * to put back.
   */
  private async beginTransaction(
    connection: PoolConnection,
    options: TransactionOptions | undefined,
    changed: NonNullable<SessionRestore>
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
      // Read first, so the session's own value can be put back once the
      // transaction has ended (`SessionRestore`).
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT @@SESSION.innodb_lock_wait_timeout AS timeout"
      );
      const previous = Number(rows[0]?.timeout);
      // MySQL uses seconds for lock_wait_timeout
      const timeoutSeconds = Math.ceil(options.timeoutMs / 1000);
      await connection.query(
        `SET SESSION innodb_lock_wait_timeout = ${timeoutSeconds}`
      );
      changed.lockWaitTimeout = Number.isInteger(previous) ? previous : null;
    }

    // Strict mode for this transaction: an INSERT, UPDATE or ALTER that would
    // cut a string to its column's length, or clamp a number to its range,
    // fails instead of applying with a warning. Added to the session's own
    // mode, so every other flag it had still holds, and put back afterwards.
    if (options?.strictSqlMode) {
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT @@SESSION.sql_mode AS mode"
      );
      const previous: unknown = rows[0]?.mode;
      await connection.query(
        "SET SESSION sql_mode = TRIM(BOTH ',' FROM CONCAT(@@SESSION.sql_mode, ',STRICT_ALL_TABLES'))"
      );
      changed.sqlMode = typeof previous === "string" ? previous : null;
    }
  }

  /**
   * Creates a TransactionContext for the given connection.
   *
   * @remarks
   * Note: Savepoint methods are not implemented (set to undefined)
   * as savepoints are disabled in this adapter per approved approach.
   */
  /**
   * Upsert with the meaning `INSERT … ON CONFLICT (target)` has on PostgreSQL
   * and SQLite, on the tables where MySQL can keep that promise.
   *
   * MySQL cannot limit a duplicate to one key: `ON DUPLICATE KEY UPDATE`
   * fires on a collision with ANY unique key, and a failed insert does not
   * say reliably which one. So the conflict target must be the table's only
   * unique key apart from its primary key, and any other table is refused
   * before anything is written. On such a table the row is inserted first —
   * its validation and triggers apply, as they do before `ON CONFLICT`
   * elsewhere — and a duplicate is resolved by a locking read of the target
   * key, which sees the latest committed row rather than the transaction's
   * snapshot. The row found is kept as it is when there is nothing to update
   * (a no-op assignment would still run its update triggers), or updated by
   * its key. No row there means the collision was on the primary key, and it
   * is refused as `ON CONFLICT (target)` refuses it.
   *
   * The steps run in the caller's transaction, or in one of their own, since a
   * locking read locks nothing past its statement under autocommit. Rows are
   * read back by their primary key, so a trigger that rewrites the conflict
   * value still returns the row stored. The conflict columns must also be
   * given values: MySQL cannot look a row up by a key the database would only
   * fill in itself. A conflict is resolved on the caller's key value: a
   * BEFORE INSERT trigger that moves the key onto another row's value is
   * refused as a unique violation rather than resolved onto that row. A failed insert rolls back only itself on MySQL, so a
   * caller's transaction stays usable.
   */
  override async upsert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options: UpsertOptions,
    executor?: unknown
  ): Promise<T> {
    const tableObj = this.getTableObject(table) as MySqlTable | undefined;
    // Unknown table: the base method reports it as every CRUD method does.
    if (!tableObj) return super.upsert<T>(table, data, options, executor);
    let target: { where: SQL | undefined; nullKey: boolean };
    try {
      // Judged before anything else, so a refused call takes no connection.
      target = this.upsertTarget(tableObj, table, data, options);
    } catch (error) {
      throw this.handleQueryError(error, "upsert", table);
    }
    // A locking read holds its lock only inside a transaction: under autocommit
    // it is released when its own statement ends, and the next statement may
    // run on another pooled connection. Without the caller's transaction, the
    // insert, the read and the update get one of their own, on one connection.
    if (executor === undefined) {
      return this.transaction(tx => tx.upsert<T>(table, data, options));
    }
    try {
      const db = executor as MySql2Database<AnyRelations>;
      // A conflict key holding NULL never conflicts: a unique index admits any
      // number of NULLs. It is a plain insert, read back by its primary key.
      if (target.nullKey) {
        return ((await this.insertRow(db, tableObj, data)) ?? data) as T;
      }
      return (await this.insertOrResolve(
        db,
        tableObj,
        data,
        options,
        target.where
      )) as T;
    } catch (error) {
      throw this.handleQueryError(error, "upsert", table);
    }
  }

  /**
   * What an upsert is keyed on: the target's condition, and whether its key
   * holds a NULL. Refuses a target this dialect cannot keep to, and a conflict
   * column left for the database to fill — MySQL cannot look a row up by a key
   * value only the database would supply.
   */
  private upsertTarget(
    tableObj: MySqlTable,
    table: string,
    data: Record<string, unknown>,
    options: UpsertOptions
  ): { where: SQL | undefined; nullKey: boolean } {
    // MySQL needs every conflict value whether or not it updates: the row is
    // found by them after a duplicate, so the keep-existing rule applies to
    // every call here.
    this.assertUpsertTarget(table, data, options, true);
    const key = this.conflictKey(tableObj, table, options.conflictColumns);
    const values = options.conflictColumns.map(column => data[column]);
    return {
      where: and(...key.map((column, i) => eq(column, values[i] as never))),
      nullKey: values.some(value => value === null),
    };
  }

  /**
   * The table's columns for a conflict target, refusing a target MySQL cannot
   * keep to: one that is not a primary or unique key, which an update could
   * spread over several rows, and one beside which the table has another
   * unique key, a collision on which MySQL would not tell apart.
   */
  private conflictKey(
    tableObj: MySqlTable,
    table: string,
    conflictColumns: readonly string[]
  ): Column[] {
    const record = tableObj as unknown as Record<string, Column | undefined>;
    const columns = conflictColumns.map(name => record[name]);
    const names = new Set(columns.map(column => column?.name));
    const isTarget = (key: readonly string[]) =>
      key.length === names.size && key.every(name => names.has(name));
    const { primary, unique } = keysOf(tableObj);
    // Every row this upsert returns is read back by its primary key, so a
    // table without one has no stable way to find the row it wrote.
    if (primary.length === 0) {
      throw createDatabaseError({
        kind: "query",
        message: `upsert on ${table}: MySQL upserts need a table with a primary key, to read back the row they write.`,
      });
    }
    const known = columns.every(column => column !== undefined);
    if (
      !known ||
      !(isTarget(primary) || unique.some(k => isTarget(k.columns)))
    ) {
      throw createDatabaseError({
        kind: "query",
        message: `upsert on ${table}: the conflict columns (${conflictColumns.join(", ")}) are not a primary or unique key of the table.`,
      });
    }
    const others = unique.filter(key => !isTarget(key.columns));
    if (others.length > 0) {
      throw createDatabaseError({
        kind: "query",
        message: `upsert on ${table}: MySQL cannot limit a duplicate to the conflict columns (${conflictColumns.join(", ")}) while the table has other unique keys (${others.map(key => key.name).join(", ")}). Upsert only on a table whose one unique key besides the primary key is the conflict target, or insert and update inside a transaction.`,
      });
    }
    return columns;
  }

  /** The update an upsert applies to an existing row: never its key. */
  private updateValues(
    data: Record<string, unknown>,
    options: UpsertOptions
  ): Record<string, unknown> {
    const key = new Set(options.conflictColumns);
    const update: Record<string, unknown> = {};
    for (const column of options.updateColumns ?? Object.keys(data)) {
      if (!key.has(column) && column in data) update[column] = data[column];
    }
    return update;
  }

  /** The row matching `where`, by a locking (current) read. */
  private async lockedRow(
    db: MySql2Database<AnyRelations>,
    tableObj: MySqlTable,
    where: SQL | undefined
  ): Promise<unknown> {
    const rows = await db
      .select()
      .from(tableObj)
      .where(where)
      .limit(1)
      .for("update");
    return rows[0];
  }

  /**
   * Insert the row, or resolve a duplicate on the target key. The insert is
   * read back by the primary key it reports, not by the conflict key: a
   * BEFORE INSERT trigger may have rewritten the conflict value, and the row
   * stored is the one to return.
   *
   * A duplicate is resolved when a row holds the TARGET key, whichever unique
   * key MySQL names in its error. PostgreSQL checks the target's index before
   * any other, so a row colliding on the target and on another key resolves
   * on the target there too; refusing it here because MySQL happened to check
   * the other index first would answer that case differently. A target row
   * committed by another transaction after this insert failed is the order in
   * which that transaction ran first, where PostgreSQL also resolves on it.
   */
  private async insertOrResolve(
    db: MySql2Database<AnyRelations>,
    tableObj: MySqlTable,
    data: Record<string, unknown>,
    options: UpsertOptions,
    where: SQL | undefined
  ): Promise<unknown> {
    let failure: unknown;
    try {
      const stored = await this.insertRow(db, tableObj, data);
      return stored ?? (await this.lockedRow(db, tableObj, where));
    } catch (error) {
      // Classified as everything else is, through the driver's own error
      // under Drizzle's wrapper (`classifyError`).
      if (this.classifyError(error).kind !== "unique_violation") throw error;
      failure = error;
    }
    const existing = await this.lockedRow(db, tableObj, where);
    // No row holds the target key: the collision was on another unique key,
    // refused as `ON CONFLICT (target)` refuses it, as the unique violation the
    // classifier reads it to be.
    if (existing === undefined) throw failure;
    const update = this.updateValues(data, options);
    if (Object.keys(update).length === 0) return existing;
    await db.update(tableObj).set(update).where(where);
    // Read back by the row's primary key as the update left it: the update may
    // set the key itself (every given column is updated by default, as `ON
    // CONFLICT DO UPDATE` does elsewhere), and a BEFORE UPDATE trigger may
    // have changed the conflict value the update was keyed on. A trigger that
    // changed the primary key instead leaves the conflict value standing, so
    // the row is looked for there next; one that changed both is not found.
    const identity = this.byIdentity(tableObj, {
      ...(existing as Record<string, unknown>),
      ...update,
    });
    const updated =
      identity === undefined
        ? undefined
        : await this.lockedRow(db, tableObj, identity);
    return updated ?? this.lockedRow(db, tableObj, where);
  }

  /**
   * Insert a row and read it back by its primary key: the value the caller
   * gave, or the one MySQL or the model generated, which `$returningId()`
   * reports and a given value it does not. Undefined when the table has no
   * primary key to read by.
   */
  private async insertRow(
    db: MySql2Database<AnyRelations>,
    tableObj: MySqlTable,
    data: Record<string, unknown>
  ): Promise<unknown> {
    const [generated] = (await db
      .insert(tableObj)
      .values(data as never)
      .$returningId()) as Record<string, unknown>[];
    // A key the caller gave wins; one given as undefined or null does not hide
    // the value MySQL generated for it.
    const given = Object.fromEntries(
      Object.entries(data).filter(
        ([, value]) => value !== undefined && value !== null
      )
    );
    const identity = this.byIdentity(tableObj, { ...generated, ...given });
    return identity === undefined
      ? undefined
      : this.lockedRow(db, tableObj, identity);
  }

  /**
   * A row's primary key as a condition, from a record keyed as the model's
   * properties are. Undefined when the table has no primary key or the record
   * lacks part of it.
   */
  private byIdentity(
    tableObj: MySqlTable,
    record: Record<string, unknown>
  ): SQL | undefined {
    const primary = new Set(keysOf(tableObj).primary);
    const parts = Object.entries(getColumns(tableObj)).filter(([, column]) =>
      primary.has(column.name)
    );
    if (
      parts.length === 0 ||
      parts.some(
        ([name]) => record[name] === undefined || record[name] === null
      )
    ) {
      return undefined;
    }
    return and(
      ...parts.map(([name, column]) => eq(column, record[name] as never))
    );
  }

  /** A table-level `primaryKey({ columns })`, read through the MySQL table config. */
  protected override compositePrimaryKey(
    tableObj: Record<string, unknown>
  ): object[] {
    return getTableConfig(
      tableObj as unknown as MySqlTable
    ).primaryKeys.flatMap(key => key.columns);
  }

  private createTransactionContext(
    connection: PoolConnection
  ): TransactionContext {
    // Bind a Drizzle instance to this transaction's checked-out connection so
    // the delegated CRUD methods run inside the transaction and see its
    // uncommitted rows. drizzle's mysql2 driver needs the underlying CALLBACK
    // connection, which the mysql2/promise wrapper exposes on `.connection`
    // (mirrors the `.pool` unwrap in getDrizzle()); getDrizzle() itself wraps
    // the pool, which would use a different connection. Built lazily and
    // memoized: transactions that use only raw execute/insert never construct
    // it.
    const txConnection = (
      connection as unknown as { connection: CallbackConnection }
    ).connection;
    const txHandles = this.transactionDrizzleHandles(relations =>
      relations
        ? drizzle({ client: txConnection, relations })
        : drizzle({ client: txConnection })
    );
    const txDb = txHandles.bare;
    return {
      drizzleWithRelations: txHandles.withRelations,

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

      // Run on the transaction-bound Drizzle instance rather than the pool, so
      // the statement is part of this transaction and sees its uncommitted rows.
      runStatement: async (statement: SQL): Promise<void> => {
        await txDb().execute(statement);
      },

      // mysql2 answers a `[rows, fields]` tuple; the transaction-bound instance
      // keeps the read inside this transaction so it sees its uncommitted writes.
      queryStatement: async <T = Record<string, unknown>>(
        statement: SQL
      ): Promise<T[]> => {
        const result = await txDb().execute(statement);
        // A tuple's first element is the rows. Anything else was not understood,
        // and must not reach a caller as "there is nothing there" — the same
        // reason the pooled `queryStatement` refuses rather than answering
        // empty.
        if (!Array.isArray(result)) {
          throw this.createDatabaseError(
            "query",
            "Drizzle statement returned a result shape this adapter does not recognise; refusing to report it as an empty result.",
            undefined
          );
        }
        return result[0] as unknown as T[];
      },

      lockRow: async (table: string, id: SqlParam): Promise<void> => {
        const idColumn = this.escapeIdentifier("id");
        await connection.query(
          `SELECT ${idColumn} FROM ${this.escapeIdentifier(table)} ` +
            `WHERE ${idColumn} = ? FOR UPDATE`,
          [id] as unknown[]
        );
      },

      insert: async <T = unknown>(
        table: string,
        data: Record<string, unknown>,
        options?: InsertOptions
      ): Promise<T> => {
        const mapped = this.mapRowToRawSql(this.getTableObject(table), data);
        const columns = Object.keys(mapped);
        const values = Object.values(mapped);
        const placeholders = this.buildPlaceholders(values.length, 0);

        const sql = `INSERT INTO ${this.escapeIdentifier(table)} (${columns.map(c => this.escapeIdentifier(c)).join(", ")}) VALUES (${placeholders})`;

        const [result] = await connection.query<ResultSetHeader>(sql, values);

        const ret = options?.returning;
        // No columns requested: skip the select-back reread entirely.
        if (Array.isArray(ret) && ret.length === 0) {
          return undefined as T;
        }

        // MySQL has no RETURNING; select the inserted row back. Project only the
        // requested columns so a large JSON snapshot is not read unless asked.
        const insertTableObj = this.getTableObject(table);
        // Each timestamp's wall clock, spelled out by the database. mysql2
        // turns one into a `Date` in the LOCAL zone before this code sees it,
        // and that conversion cannot be undone: a wall clock inside a
        // daylight-saving gap is normalized away.
        const aliases = this.dateWallClockAliases(insertTableObj, ret ?? "*");
        const spelled = aliases
          .map(
            a =>
              `DATE_FORMAT(${this.escapeIdentifier(a.sqlName)}, '%Y-%m-%dT%H:%i:%s.%f') AS ${this.escapeIdentifier(a.alias)}`
          )
          .join(", ");
        const projected =
          !ret || ret === "*"
            ? "*"
            : this.mapColumnNamesToSql(insertTableObj, ret)
                .map(c => this.escapeIdentifier(c))
                .join(", ");
        const selectList = spelled ? `${projected}, ${spelled}` : projected;

        // Prefer the primary key: auto-increment via insertId, otherwise a
        // supplied id (manually-keyed tables like nextly_versions). Matching by
        // all values is a last resort because `col = NULL` never matches, so a
        // row with nullable columns would not be found by that path.
        const idValue = result.insertId ? result.insertId : mapped.id;
        if (idValue !== undefined) {
          const [rows] = await connection.query<RowDataPacket[]>(
            `SELECT ${selectList} FROM ${this.escapeIdentifier(table)} WHERE id = ?`,
            [idValue]
          );
          return this.mapRowFromRawSql(insertTableObj, rows[0] as T, aliases);
        }

        const whereClauses = columns.map(
          c => `${this.escapeIdentifier(c)} = ?`
        );
        const [rows] = await connection.query<RowDataPacket[]>(
          `SELECT ${selectList} FROM ${this.escapeIdentifier(table)} WHERE ${whereClauses.join(" AND ")} LIMIT 1`,
          values
        );
        return this.mapRowFromRawSql(insertTableObj, rows[0] as T, aliases);
      },

      insertMany: async <T = unknown>(
        table: string,
        data: Record<string, unknown>[],
        options?: InsertOptions
      ): Promise<T[]> => {
        if (data.length === 0) return [];
        const retMany = options?.returning;
        const skipReread = Array.isArray(retMany) && retMany.length === 0;

        const tableObj = this.getTableObject(table);
        const mappedRecords = data.map(r => this.mapRowToRawSql(tableObj, r));
        const columns = Object.keys(mappedRecords[0]);
        const allValues: unknown[] = [];
        const valuesClauses: string[] = [];

        for (const record of mappedRecords) {
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
        if (!skipReread && result.insertId && result.affectedRows > 0) {
          const ids: number[] = [];
          for (let i = 0; i < result.affectedRows; i++) {
            ids.push(result.insertId + i);
          }
          const placeholders = ids.map(() => "?").join(", ");
          const bulkAliases = this.dateWallClockAliases(tableObj, "*");
          const bulkSpelled = bulkAliases
            .map(
              a =>
                `DATE_FORMAT(${this.escapeIdentifier(a.sqlName)}, '%Y-%m-%dT%H:%i:%s.%f') AS ${this.escapeIdentifier(a.alias)}`
            )
            .join(", ");
          const [rows] = await connection.query<RowDataPacket[]>(
            `SELECT *${bulkSpelled ? `, ${bulkSpelled}` : ""} FROM ${this.escapeIdentifier(table)} WHERE id IN (${placeholders})`,
            ids
          );
          return (rows as T[]).map(r =>
            this.mapRowFromRawSql(tableObj, r, bulkAliases)
          );
        }

        // Fallback: return empty if we can't determine inserted rows
        return [];
      },

      // Adapter-built, as `insert` above is; `transactionUpdate` says why.
      // A column the model does not declare binds natively, as every value
      // on this path's insert does.
      update: this.transactionUpdate(
        txDb,
        async statement => {
          // No RETURNING on MySQL: nothing to report, the read-back is by
          // the caller's predicate.
          await txDb().execute(statement);
          return undefined;
        },
        // Structured values as JSON text: mysql2's formatter spells an object
        // as `key = value` pairs and an array as a value list, neither JSON.
        value => this.bindUnmodeledStructuredAsJson(value)
      ),

      ...this.createTransactionForwarders(txDb),

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
  protected override classifyError(
    error: unknown,
    sql?: string
  ): DatabaseError {
    // Why short-circuit on existing DatabaseError: F17's
    // UnsupportedDialectVersionError is already a typed DatabaseError with
    // kind: "unsupported_version" plus detectedVersion/requiredVersion
    // fields. Re-wrapping it here would erase those fields and re-tag it
    // as kind: "unknown".
    if (isDatabaseError(error)) return error;

    // Classified from mysql2's own error, which Drizzle puts on `cause` when it
    // wraps a failed query (`driverErrorIn`); it is the one carrying `errno`.
    const mysqlError = this.driverErrorIn<{
      errno?: number;
      code?: string;
      sqlState?: string;
      message?: string;
      sql?: string;
      cause?: unknown;
    }>(error, candidate => typeof candidate.errno === "number");

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
}

/** A table's keys by database column name, as its model declares them. */
interface TableKeys {
  primary: string[];
  unique: { name: string; columns: string[] }[];
}

const TABLE_KEYS = new WeakMap<MySqlTable, TableKeys>();

/**
 * A table's primary key and its unique keys other than the primary key, read
 * from its model once and kept for the table's lifetime: a model is not
 * changed in place, a new schema brings new table objects.
 */
function keysOf(tableObj: MySqlTable): TableKeys {
  const cached = TABLE_KEYS.get(tableObj);
  if (cached) return cached;
  const config = getTableConfig(tableObj);
  const primary = [
    ...config.columns.filter(column => column.primary),
    ...config.primaryKeys.flatMap(key => key.columns),
  ].map(column => column.name);
  const unique = [
    ...config.columns
      .filter(column => column.isUnique && !column.primary)
      .map(column => ({
        // Drizzle's own name for an unnamed column-level unique key.
        name: column.uniqueName ?? `${config.name}_${column.name}_unique`,
        columns: [column.name],
      })),
    ...config.uniqueConstraints.map(constraint => ({
      name: constraint.name,
      columns: constraint.columns.map(column => column.name),
    })),
    ...config.indexes
      .filter(index => index.config.unique === true)
      .map(index => ({
        name: index.config.name,
        columns: (index.config.columns as { name: string }[]).map(
          column => column.name
        ),
      })),
  ];
  const keys = { primary, unique };
  TABLE_KEYS.set(tableObj, keys);
  return keys;
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
