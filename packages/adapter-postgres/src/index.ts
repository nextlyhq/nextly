/**
 * @revnixhq/adapter-postgres
 *
 * PostgreSQL database adapter for Nextly.
 * Extends the base DrizzleAdapter from @revnixhq/adapter-drizzle to provide
 * PostgreSQL-specific functionality.
 *
 * @remarks
 * This adapter uses the `pg` (node-postgres) driver for database connections
 * and integrates with Drizzle ORM for type-safe queries.
 *
 * Features:
 * - Connection pooling via pg.Pool
 * - Full transaction support with savepoints
 * - RETURNING clause support for all CRUD operations
 * - PostgreSQL-specific error classification
 * - JSONB support
 * - Full-text search capabilities
 * - Automatic retry for serialization failures and deadlocks
 *
 * @example
 * Simple usage with connection string:
 * ```typescript
 * import { createPostgresAdapter } from '@revnixhq/adapter-postgres';
 *
 * const adapter = createPostgresAdapter({
 *   url: process.env.DATABASE_URL!,
 * });
 *
 * await adapter.connect();
 * ```
 *
 * @example
 * Full configuration:
 * ```typescript
 * import { createPostgresAdapter } from '@revnixhq/adapter-postgres';
 *
 * const adapter = createPostgresAdapter({
 *   url: process.env.DATABASE_URL!,
 *   pool: {
 *     min: 2,
 *     max: 20,
 *     idleTimeoutMs: 30000,
 *   },
 *   ssl: {
 *     rejectUnauthorized: true,
 *   },
 *   applicationName: 'my-nextly-app',
 * });
 * ```
 *
 * @example
 * Using the adapter class directly:
 * ```typescript
 * import { PostgresAdapter } from '@revnixhq/adapter-postgres';
 * import type { PostgresAdapterConfig } from '@revnixhq/adapter-postgres';
 *
 * const config: PostgresAdapterConfig = {
 *   url: process.env.DATABASE_URL!,
 * };
 *
 * const adapter = new PostgresAdapter(config);
 * await adapter.connect();
 * ```
 *
 * @packageDocumentation
 */

import {
  DrizzleAdapter,
  // F17: connect-time DB version check shared across all adapters.
  checkDialectVersion,
} from "@revnixhq/adapter-drizzle";
import type {
  PostgresAdapterConfig,
  DatabaseCapabilities,
  PoolStats,
  TransactionContext,
  TransactionOptions,
  SqlParam,
  SelectOptions,
  InsertOptions,
  UpdateOptions,
  DeleteOptions,
  UpsertOptions,
  WhereClause,
  DatabaseError,
  DatabaseErrorKind,
} from "@revnixhq/adapter-drizzle/types";
import {
  createDatabaseError,
  isDatabaseError,
} from "@revnixhq/adapter-drizzle/types";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PoolClient, PoolConfig } from "pg";
import { Pool } from "pg";

import {
  detectPostgresProvider,
  getProviderDefaults,
  type PostgresProvider,
  type ProviderDefaults,
} from "./provider";

// Re-export types from @revnixhq/adapter-drizzle for convenience
export type {
  PostgresAdapterConfig,
  DatabaseCapabilities,
  PoolStats,
  TransactionContext,
  TransactionOptions,
  SqlParam,
  // Additional types users might need
  BaseAdapterConfig,
  AdapterLogger,
  PoolConfig as AdapterPoolConfig,
  SslConfig,
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
} from "@revnixhq/adapter-drizzle/types";

/**
 * Package version.
 */
export const VERSION = "0.1.0";

/**
 * Default pool configuration values.
 *
 * min: 0  – Never eagerly create background connections.  This is critical
 *            for cold-start recovery (e.g. Neon auto-suspend): after the
 *            initial smoke-test connection, the pool won't immediately try
 *            to create additional connections that might still fail while
 *            the DB is waking up.
 *
 * max: 5  – Conservative default to avoid overwhelming cloud databases
 *            (Neon free-tier limit is ~25-30 simultaneous connections).
 *            With Next.js spawning up to 7 build workers this keeps the
 *            total connection count safely under typical limits.
 */
const DEFAULT_POOL_CONFIG = {
  min: 0,
  max: 5,
  idleTimeoutMs: 30000,
  connectionTimeoutMs: 15000,
};

/**
 * PostgreSQL error codes mapping to DatabaseErrorKind.
 *
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_ERROR_CODES: Record<string, DatabaseErrorKind> = {
  // Class 08 - Connection Exception
  "08000": "connection",
  "08003": "connection",
  "08006": "connection",
  "08001": "connection",
  "08004": "connection",
  "08007": "connection",
  "08P01": "connection",

  // Class 23 - Integrity Constraint Violation
  "23000": "constraint",
  "23001": "constraint",
  "23502": "not_null_violation",
  "23503": "foreign_key_violation",
  "23505": "unique_violation",
  "23514": "check_violation",
  "23P01": "constraint",

  // Class 40 - Transaction Rollback
  "40000": "query",
  "40001": "serialization_failure",
  "40002": "constraint",
  "40003": "query",
  "40P01": "deadlock",

  // Class 57 - Operator Intervention
  "57014": "timeout",
  "57P01": "connection",
  "57P02": "connection",
  "57P03": "connection",
};

/**
 * Delay helper for retry logic.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * PostgreSQL database adapter for Nextly.
 *
 * @remarks
 * This class extends the base DrizzleAdapter to provide PostgreSQL-specific
 * functionality including:
 *
 * - Connection pooling with pg.Pool
 * - Transaction support with savepoints
 * - PostgreSQL-specific error codes
 * - JSONB and array type support
 * - Full-text search
 * - Automatic retry for serialization failures and deadlocks
 *
 * For most use cases, use the `createPostgresAdapter` factory function
 * instead of instantiating this class directly.
 *
 * @example
 * ```typescript
 * import { PostgresAdapter } from '@revnixhq/adapter-postgres';
 *
 * const adapter = new PostgresAdapter({
 *   url: 'postgres://user:pass@localhost:5432/mydb',
 * });
 *
 * await adapter.connect();
 *
 * // Use the adapter
 * const users = await adapter.select('users', {
 *   where: { and: [{ column: 'status', op: '=', value: 'active' }] },
 * });
 *
 * await adapter.disconnect();
 * ```
 *
 * @public
 */
export class PostgresAdapter extends DrizzleAdapter {
  /**
   * The database dialect - always 'postgresql' for this adapter.
   */
  public readonly dialect = "postgresql" as const;

  /**
   * Adapter configuration.
   */
  protected readonly config: PostgresAdapterConfig;

  /**
   * Connection pool instance.
   */
  private pool: Pool | null = null;

  /**
   * Connection state flag.
   */
  private connected = false;

  /**
   * Auto-detected provider (Neon, Supabase, or standard).
   * Set during connect() from DATABASE_URL pattern or DB_PROVIDER env var.
   */
  private detectedProvider: PostgresProvider = "standard";

  /**
   * Provider-specific connection defaults. Applied as fallbacks when
   * user config doesn't specify a value.
   */
  private providerDefaults: ProviderDefaults = getProviderDefaults("standard");

  /**
   * Creates a new PostgreSQL adapter instance.
   *
   * @param config - Adapter configuration
   */
  constructor(config: PostgresAdapterConfig) {
    super();
    this.config = config;
  }

  /**
   * Establishes a connection to the PostgreSQL database.
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

    // Auto-detect provider from URL and apply defaults
    const url = this.config.url || "";
    this.detectedProvider = detectPostgresProvider(
      url,
      process.env.DB_PROVIDER
    );
    this.providerDefaults = getProviderDefaults(this.detectedProvider);

    // Log detected provider for developer awareness
    if (this.config.logger?.info) {
      const source = process.env.DB_PROVIDER ? "(explicit)" : "(auto-detected)";
      this.config.logger.info(
        `PostgreSQL provider: ${this.detectedProvider} ${source}`,
        {}
      );
    }

    // Node.js network error codes that are safe to retry (transient failures).
    // These cover cloud databases (e.g. Neon) waking from auto-suspend, brief
    // network hiccups, and DNS resolution races during build parallelism.
    const retryableNodeCodes = new Set([
      "ETIMEDOUT",
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "EAI_AGAIN",
    ]);

    // Use provider-specific retry count (Neon needs more for cold starts)
    const maxAttempts = this.providerDefaults.retryAttempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const poolConfig = this.buildPoolConfig();
        this.pool = new Pool(poolConfig);

        // Handle pool errors (background errors on idle clients)
        this.pool.on("error", (err: Error) => {
          // Log through adapter logger if configured
          if (this.config.logger?.error) {
            this.config.logger.error(err, {
              context: "pool_error",
              message: "Unexpected error on idle client",
            });
          }
          // Client is automatically removed from pool, no action needed
        });

        // Verify connection with smoke test, then check dialect version.
        // Why: F17 hard-fails at connect on unsupported PG versions (<15.0)
        // so users see a clear upgrade pointer instead of cryptic errors
        // mid-apply later. The version query runs inside the existing retry
        // loop's try block, so transient network failures (Neon cold start,
        // EAI_AGAIN) continue to retry; only confirmed version mismatch
        // surfaces as UnsupportedDialectVersionError and exits the loop.
        const client = await this.pool.connect();
        try {
          await client.query("SELECT 1");
          await checkDialectVersion(client, "postgresql", {
            // Why: route any future variant warnings through the adapter's
            // logger. PG has no recognized variants today, but this keeps
            // the integration symmetric with MySQL.
            onWarning: msg => this.config.logger?.warn?.(msg),
          });
          this.connected = true;

          if (this.config.logger?.info) {
            this.config.logger.info("PostgreSQL connection established", {
              host: this.config.host ?? "from URL",
              database: this.config.database ?? "from URL",
            });
          }

          return; // Success — exit retry loop
        } finally {
          client.release();
        }
      } catch (error) {
        // Clean up the failed pool before deciding whether to retry
        if (this.pool) {
          await this.pool.end().catch(() => {});
          this.pool = null;
        }

        const nodeError = error as { code?: string };
        const isRetryable =
          nodeError.code != null && retryableNodeCodes.has(nodeError.code);

        if (isRetryable && attempt < maxAttempts) {
          // Exponential back-off with jitter: ~1 s, ~2 s, ~3 s, ~4 s
          const waitMs = 1000 * attempt;
          const msg = `PostgreSQL connection attempt ${attempt}/${maxAttempts} failed with ${nodeError.code}, retrying in ${waitMs}ms...`;
          if (this.config.logger?.warn) {
            this.config.logger.warn(msg);
          } else {
            console.warn(`[PostgresAdapter] ${msg}`);
          }
          await delay(waitMs);
          continue;
        }

        // Non-retryable error or exhausted retries — surface to caller
        throw this.classifyError(error);
      }
    }
  }

  /**
   * Closes the database connection and releases all pool resources.
   *
   * @remarks
   * This method is idempotent - calling it multiple times is safe.
   * It waits for all checked-out clients to be returned before shutting down.
   */
  async disconnect(): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      await this.pool.end();

      if (this.config.logger?.info) {
        this.config.logger.info("PostgreSQL connection closed");
      }
    } finally {
      this.pool = null;
      this.connected = false;
    }
  }

  /**
   * Checks if the adapter is currently connected.
   *
   * @returns True if connected and pool is available
   */
  override isConnected(): boolean {
    return this.connected && this.pool !== null;
  }

  /**
   * Executes a raw SQL query.
   *
   * @param sql - SQL statement with $1, $2, ... placeholders
   * @param params - Query parameters
   * @returns Array of result rows
   *
   * @throws {DatabaseError} If query execution fails
   */
  async executeQuery<T = unknown>(
    sql: string,
    params: SqlParam[] = []
  ): Promise<T[]> {
    const pool = this.ensurePool();
    const startTime = Date.now();

    // Transient network errors that are safe to retry at the query level.
    // These occur when Neon auto-suspends between the pool smoke-test and the
    // actual query, or when multiple build workers compete for cold-start.
    const retryableNodeCodes = new Set([
      "ETIMEDOUT",
      "ECONNRESET",
      "ECONNREFUSED",
    ]);
    const maxQueryAttempts = 3;

    for (let attempt = 1; attempt <= maxQueryAttempts; attempt++) {
      try {
        const result = await pool.query(sql, params as unknown[]);

        // Log query if logger configured
        if (this.config.logger?.query) {
          const durationMs = Date.now() - startTime;
          this.config.logger.query(sql, params, durationMs);
        }

        return result.rows as T[];
      } catch (error) {
        const nodeError = error as { code?: string };
        const isRetryable =
          nodeError.code != null && retryableNodeCodes.has(nodeError.code);

        if (isRetryable && attempt < maxQueryAttempts) {
          const waitMs = 500 * attempt;
          console.warn(
            `[PostgresAdapter] Query attempt ${attempt}/${maxQueryAttempts} failed with ${nodeError.code}, retrying in ${waitMs}ms...`
          );
          await delay(waitMs);
          continue;
        }

        throw this.classifyError(error, sql);
      }
    }

    // Unreachable — loop always returns or throws
    throw this.classifyError(new Error("executeQuery: exhausted retries"));
  }

  /**
   * Executes a callback within a database transaction.
   *
   * @remarks
   * PostgreSQL supports full ACID transactions with savepoints.
   * If the callback throws, the transaction is rolled back.
   *
   * Supports automatic retry for serialization failures (40001) and
   * deadlocks (40P01) when `retryCount` is specified in options.
   *
   * @param callback - Function to execute within the transaction
   * @param options - Transaction options (isolation level, timeout, retry)
   * @returns The result of the callback
   *
   * @throws {DatabaseError} If transaction fails after all retries
   */
  async transaction<T>(
    callback: (ctx: TransactionContext) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> {
    const pool = this.ensurePool();
    const maxAttempts = (options?.retryCount ?? 0) + 1;
    const retryDelayMs = options?.retryDelayMs ?? 100;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const client = await pool.connect();
      const startTime = Date.now();

      try {
        // Begin transaction with options
        await this.beginTransaction(client, options);

        // Create transaction context
        const ctx = this.createTransactionContext(client);

        // Execute callback
        const result = await callback(ctx);

        // Commit transaction
        await client.query("COMMIT");

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
        await client.query("ROLLBACK").catch(() => {});

        lastError = error;

        // Check if error is retryable
        const pgError = error as { code?: string };
        const isRetryable =
          pgError.code === "40001" || // serialization_failure
          pgError.code === "40P01"; // deadlock

        if (isRetryable && attempt < maxAttempts) {
          if (this.config.logger?.warn) {
            this.config.logger.warn(
              `Transaction failed with ${pgError.code}, retrying (${attempt}/${maxAttempts})`,
              { code: pgError.code, attempt }
            );
          }
          await delay(retryDelayMs * attempt); // Exponential backoff
          continue;
        }

        throw this.classifyError(error);
      } finally {
        client.release();
      }
    }

    // Should not reach here, but handle just in case
    throw this.classifyError(lastError);
  }

  /**
   * Returns the database capabilities for PostgreSQL.
   *
   * @remarks
   * PostgreSQL has the most comprehensive feature set of all supported
   * databases, including JSONB, arrays, full-text search, and more.
   */
  getCapabilities(): DatabaseCapabilities {
    return {
      dialect: "postgresql",
      supportsJsonb: true,
      supportsJson: true,
      supportsArrays: true,
      supportsGeneratedColumns: true,
      supportsFts: true,
      supportsIlike: true,
      supportsReturning: true,
      supportsSavepoints: true,
      supportsOnConflict: true,
      maxParamsPerQuery: 65535, // PostgreSQL limit
      maxIdentifierLength: 63, // PostgreSQL default
    };
  }

  /**
   * Returns connection pool statistics.
   *
   * @returns Pool stats or null if not connected
   */
  override getPoolStats(): PoolStats | null {
    if (!this.pool) {
      return null;
    }

    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
      active: this.pool.totalCount - this.pool.idleCount,
    };
  }

  /**
   * Override insertMany for bulk insert optimization.
   *
   * @remarks
   * Uses a single multi-row INSERT statement for better performance
   * when inserting multiple records.
   */
  override async insertMany<T = unknown>(
    table: string,
    data: Record<string, unknown>[],
    options?: InsertOptions
  ): Promise<T[]> {
    if (data.length === 0) {
      return [];
    }

    // For single record, use parent implementation
    if (data.length === 1) {
      const result = await this.insert<T>(table, data[0], options);
      return [result];
    }

    // Build multi-row INSERT
    const columns = Object.keys(data[0]);
    const params: SqlParam[] = [];
    const valuesClauses: string[] = [];

    for (let i = 0; i < data.length; i++) {
      const record = data[i];
      const placeholders: string[] = [];

      for (const col of columns) {
        params.push(record[col] as SqlParam);
        placeholders.push(`$${params.length}`);
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
    }

    try {
      return await this.executeQuery<T>(sql, params);
    } catch (error) {
      throw this.handleQueryError(error, "insertMany", table);
    }
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
        message: "PostgresAdapter is not connected. Call connect() first.",
      });
    }
    return this.pool;
  }

  /**
   * Return the typed Drizzle instance for PostgreSQL.
   * Guarded for server-only usage and requires an active connection.
   *
   * @param schema - Optional schema for relational queries (db.query.*)
   * @returns Drizzle ORM instance wrapping the pg pool connection
   * @throws {Error} If called in browser or not connected
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDrizzle<T = NodePgDatabase<any>>(schema?: Record<string, unknown>): T {
    if (typeof window !== "undefined") {
      throw new Error("getDrizzle() is server-only");
    }
    const pool = this.ensurePool();
    return (schema ? drizzle(pool, { schema }) : drizzle(pool)) as T;
  }

  /**
   * Builds pg Pool configuration from adapter config.
   */
  private buildPoolConfig(): PoolConfig {
    const config: PoolConfig = {};

    // Connection string or explicit options
    if (this.config.url) {
      config.connectionString = this.config.url;
    } else {
      if (this.config.host) config.host = this.config.host;
      if (this.config.port) config.port = this.config.port;
      if (this.config.database) config.database = this.config.database;
      if (this.config.user) config.user = this.config.user;
      if (this.config.password) config.password = this.config.password;
    }

    // Pool settings (user config > provider defaults > hardcoded defaults)
    config.min =
      this.config.pool?.min ??
      this.providerDefaults.poolMin ??
      DEFAULT_POOL_CONFIG.min;
    config.max =
      this.config.pool?.max ??
      this.providerDefaults.poolMax ??
      DEFAULT_POOL_CONFIG.max;
    config.idleTimeoutMillis =
      this.config.pool?.idleTimeoutMs ??
      this.providerDefaults.idleTimeoutMs ??
      DEFAULT_POOL_CONFIG.idleTimeoutMs;
    config.connectionTimeoutMillis =
      this.config.pool?.connectionTimeoutMs ??
      this.providerDefaults.connectionTimeoutMs ??
      DEFAULT_POOL_CONFIG.connectionTimeoutMs;

    // TCP keepalive - prevents cloud databases (e.g. Neon) from silently
    // dropping idle connections between the pool smoke-test and the first
    // real query, which manifests as ETIMEDOUT on the query itself.
    config.keepAlive = true;
    config.keepAliveInitialDelayMillis = 10000;

    // SSL configuration (user config > provider default)
    if (this.config.ssl) {
      if (typeof this.config.ssl === "boolean") {
        config.ssl = this.config.ssl;
      } else {
        config.ssl = {
          rejectUnauthorized: this.config.ssl.rejectUnauthorized,
          ca: this.config.ssl.ca,
          cert: this.config.ssl.cert,
          key: this.config.ssl.key,
        };
      }
    } else if (this.providerDefaults.ssl) {
      // Provider requires SSL but user didn't explicitly configure it
      config.ssl = { rejectUnauthorized: false };
    }

    // PostgreSQL-specific options
    if (this.config.applicationName) {
      config.application_name = this.config.applicationName;
    }

    if (this.config.statementTimeout) {
      config.statement_timeout = this.config.statementTimeout;
    }

    if (this.config.queryTimeout) {
      config.query_timeout = this.config.queryTimeout;
    }

    return config;
  }

  /**
   * Begins a transaction with the specified options.
   */
  private async beginTransaction(
    client: PoolClient,
    options?: TransactionOptions
  ): Promise<void> {
    let beginSql = "BEGIN";

    // Add isolation level if specified
    if (options?.isolationLevel) {
      const isolationMap: Record<string, string> = {
        "read uncommitted": "READ UNCOMMITTED",
        "read committed": "READ COMMITTED",
        "repeatable read": "REPEATABLE READ",
        serializable: "SERIALIZABLE",
      };
      const level = isolationMap[options.isolationLevel];
      if (level) {
        beginSql += ` ISOLATION LEVEL ${level}`;
      }
    }

    // Add read-only mode if specified
    if (options?.readOnly) {
      beginSql += " READ ONLY";
    }

    await client.query(beginSql);

    // Set statement timeout if specified
    if (options?.timeoutMs) {
      await client.query(`SET LOCAL statement_timeout = ${options.timeoutMs}`);
    }
  }

  /**
   * Creates a TransactionContext for the given client.
   */
  private createTransactionContext(client: PoolClient): TransactionContext {
    return {
      execute: async <T = unknown>(
        sql: string,
        params: SqlParam[] = []
      ): Promise<T[]> => {
        const result = await client.query(sql, params as unknown[]);
        return result.rows as T[];
      },

      insert: async <T = unknown>(
        table: string,
        data: Record<string, unknown>,
        options?: InsertOptions
      ): Promise<T> => {
        const columns = Object.keys(data);
        const values = Object.values(data);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");

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

        const result = await client.query(sql, values);
        return result.rows[0] as T;
      },

      insertMany: async <T = unknown>(
        table: string,
        data: Record<string, unknown>[],
        options?: InsertOptions
      ): Promise<T[]> => {
        if (data.length === 0) return [];

        const columns = Object.keys(data[0]);
        const params: unknown[] = [];
        const valuesClauses: string[] = [];

        for (const record of data) {
          const placeholders: string[] = [];
          for (const col of columns) {
            params.push(record[col]);
            placeholders.push(`$${params.length}`);
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

        const result = await client.query(sql, params);
        return result.rows as T[];
      },

      // TransactionContext CRUD methods delegate to the adapter's CRUD
      // which uses Drizzle query API via the TableResolver.
      // The Drizzle transaction is handled at a higher level.
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
        await client.query(`SAVEPOINT ${this.escapeIdentifier(name)}`);
      },

      rollbackToSavepoint: async (name: string): Promise<void> => {
        await client.query(
          `ROLLBACK TO SAVEPOINT ${this.escapeIdentifier(name)}`
        );
      },

      releaseSavepoint: async (name: string): Promise<void> => {
        await client.query(`RELEASE SAVEPOINT ${this.escapeIdentifier(name)}`);
      },
    };
  }

  /**
   * Classifies a PostgreSQL error into a DatabaseError.
   *
   * @param error - Original error from pg
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

    const pgError = error as {
      code?: string;
      message?: string;
      constraint?: string;
      table?: string;
      column?: string;
      detail?: string;
      hint?: string;
      severity?: string;
    };

    // Determine error kind from PostgreSQL error code
    const kind: DatabaseErrorKind =
      (pgError.code && PG_ERROR_CODES[pgError.code]) || "unknown";

    // Build error message
    let message = pgError.message ?? String(error);
    if (sql && kind === "query") {
      message = `Query failed: ${message}`;
    }

    return createDatabaseError({
      kind,
      message,
      code: pgError.code,
      constraint: pgError.constraint,
      table: pgError.table,
      column: pgError.column,
      detail: pgError.detail,
      hint: pgError.hint,
      cause: error instanceof Error ? error : undefined,
    });
  }

  /**
   * Override handleQueryError to use PostgreSQL-specific classification.
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
 * Creates a PostgreSQL database adapter instance.
 *
 * @remarks
 * This is the recommended way to create a PostgreSQL adapter.
 * The adapter is not connected after creation - call `connect()` to
 * establish the database connection.
 *
 * @param config - Adapter configuration
 * @returns A new PostgresAdapter instance
 *
 * @example
 * Simple usage:
 * ```typescript
 * import { createPostgresAdapter } from '@revnixhq/adapter-postgres';
 *
 * const adapter = createPostgresAdapter({
 *   url: process.env.DATABASE_URL!,
 * });
 *
 * await adapter.connect();
 * ```
 *
 * @example
 * With full configuration:
 * ```typescript
 * const adapter = createPostgresAdapter({
 *   url: process.env.DATABASE_URL!,
 *   pool: {
 *     min: 5,
 *     max: 20,
 *     idleTimeoutMs: 30000,
 *     connectionTimeoutMs: 10000,
 *   },
 *   ssl: {
 *     rejectUnauthorized: true,
 *     ca: process.env.CA_CERT,
 *   },
 *   applicationName: 'my-app',
 *   statementTimeout: 30000,
 * });
 * ```
 *
 * @public
 */
export function createPostgresAdapter(
  config: PostgresAdapterConfig
): PostgresAdapter {
  return new PostgresAdapter(config);
}

/**
 * Type guard to check if a value is a PostgresAdapter instance.
 *
 * @param value - Value to check
 * @returns True if value is a PostgresAdapter
 *
 * @example
 * ```typescript
 * import { isPostgresAdapter } from '@revnixhq/adapter-postgres';
 *
 * if (isPostgresAdapter(adapter)) {
 *   // TypeScript knows adapter is PostgresAdapter
 *   console.log(adapter.dialect); // 'postgresql'
 * }
 * ```
 *
 * @public
 */
export function isPostgresAdapter(value: unknown): value is PostgresAdapter {
  return value instanceof PostgresAdapter;
}
