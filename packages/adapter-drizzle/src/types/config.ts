/**
 * Database adapter configuration type definitions.
 *
 * @packageDocumentation
 */

import type { SqlParam } from "./core";

/**
 * Logger interface for adapter operations.
 *
 * @remarks
 * Adapters use this interface to log queries, errors, and performance metrics.
 *
 * @public
 */
export interface AdapterLogger {
  /**
   * Log a query execution.
   *
   * @param sql - SQL statement
   * @param params - Query parameters
   * @param durationMs - Query execution time in milliseconds
   */
  query?: (sql: string, params?: SqlParam[], durationMs?: number) => void;

  /**
   * Log an error.
   *
   * @param error - Error object
   * @param context - Additional context about the error
   */
  error?: (error: Error, context?: Record<string, unknown>) => void;

  /**
   * Log a debug message.
   *
   * @param message - Debug message
   * @param context - Additional context
   */
  debug?: (message: string, context?: Record<string, unknown>) => void;

  /**
   * Log a warning.
   *
   * @param message - Warning message
   * @param context - Additional context
   */
  warn?: (message: string, context?: Record<string, unknown>) => void;

  /**
   * Log an info message.
   *
   * @param message - Info message
   * @param context - Additional context
   */
  info?: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Connection pool configuration.
 *
 * @remarks
 * Controls connection pooling behavior. SQLite adapters ignore these
 * settings as SQLite uses a single connection.
 *
 * @public
 */
export interface PoolConfig {
  /** Minimum number of connections in the pool */
  min?: number;

  /** Maximum number of connections in the pool */
  max?: number;

  /** Time (ms) before an idle connection is closed */
  idleTimeoutMs?: number;

  /** Time (ms) to wait for a connection before timing out */
  connectionTimeoutMs?: number;

  /** Time (ms) before considering an unused connection stale */
  maxLifetimeMs?: number;
}

/**
 * SSL/TLS configuration for database connections.
 *
 * @remarks
 * Relevant for PostgreSQL and MySQL. SQLite doesn't use network connections.
 *
 * @public
 */
export interface SslConfig {
  /** Reject unauthorized certificates (default: true for production) */
  rejectUnauthorized?: boolean;

  /** Path to CA certificate file */
  ca?: string;

  /** Path to client certificate file */
  cert?: string;

  /** Path to client private key file */
  key?: string;
}

/**
 * Base adapter configuration.
 *
 * @remarks
 * Common configuration options for all database adapters. Dialect-specific
 * adapters may extend this interface with additional options.
 *
 * @public
 */
export interface BaseAdapterConfig {
  /**
   * Database connection URL.
   *
   * @remarks
   * Examples:
   * - PostgreSQL: `postgres://user:pass@localhost:5432/dbname`
   * - MySQL: `mysql://user:pass@localhost:3306/dbname`
   * - SQLite: `file:./data/app.db` or `file::memory:`
   */
  url?: string;

  /** Database host (alternative to URL) */
  host?: string;

  /** Database port (alternative to URL) */
  port?: number;

  /** Database name (alternative to URL) */
  database?: string;

  /** Database user (alternative to URL) */
  user?: string;

  /** Database password (alternative to URL) */
  password?: string;

  /** Connection pool configuration */
  pool?: PoolConfig;

  /** Logger instance for queries and errors */
  logger?: AdapterLogger;

  /** Schema name (PostgreSQL) */
  schema?: string;

  /** SSL/TLS configuration */
  ssl?: SslConfig | boolean;

  /**
   * Default query timeout in milliseconds.
   *
   * @remarks
   * Queries exceeding this limit will be aborted and throw a DatabaseError
   * with kind 'timeout'. This prevents runaway queries from blocking the
   * system indefinitely.
   *
   * Can be overridden per-transaction via TransactionOptions.timeoutMs.
   *
   * Set to 0 or undefined to disable timeout (not recommended for production).
   *
   * @default 15000 (15 seconds)
   *
   * @example
   * ```typescript
   * const adapter = createPostgresAdapter({
   *   url: 'postgres://localhost/mydb',
   *   queryTimeoutMs: 30000, // 30 seconds
   * });
   * ```
   */
  queryTimeoutMs?: number;

  /** Additional connection options (driver-specific) */
  options?: Record<string, unknown>;
}

/**
 * PostgreSQL-specific adapter configuration.
 *
 * @public
 */
export interface PostgresAdapterConfig extends BaseAdapterConfig {
  /** Application name for connection tracking */
  applicationName?: string;

  /** Statement timeout in milliseconds */
  statementTimeout?: number;

  /** Query timeout in milliseconds */
  queryTimeout?: number;

  /** Enable prepared statements (default: true) */
  preparedStatements?: boolean;
}

/**
 * MySQL-specific adapter configuration.
 *
 * @public
 */
export interface MySqlAdapterConfig extends BaseAdapterConfig {
  /** Character set (default: utf8mb4) */
  charset?: string;

  /** Timezone (default: 'local') */
  timezone?: string;

  /** Enable multiple statements per query (default: false, security risk) */
  multipleStatements?: boolean;

  /** Date strings instead of Date objects (default: false) */
  dateStrings?: boolean;
}

/**
 * SQLite-specific adapter configuration.
 *
 * @public
 */
export interface SqliteAdapterConfig extends BaseAdapterConfig {
  /** Enable WAL mode (default: true) */
  wal?: boolean;

  /** Busy timeout in milliseconds (default: 5000) */
  busyTimeout?: number;

  /** Enable foreign keys (default: true) */
  foreignKeys?: boolean;

  /** Memory-only database (overrides url) */
  memory?: boolean;

  /** Read-only mode (default: false) */
  readonly?: boolean;
}
