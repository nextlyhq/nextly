/**
 * Database capability type definitions.
 *
 * @packageDocumentation
 */

import type { SupportedDialect } from "./core";

/**
 * Database feature capabilities.
 *
 * @remarks
 * Describes what features are supported by a specific database adapter.
 * Services can check these capabilities to conditionally enable features
 * or implement fallback behavior.
 *
 * @example
 * ```typescript
 * const capabilities = adapter.getCapabilities();
 * if (capabilities.supportsJsonb) {
 *   // Use JSONB-specific features
 * } else if (capabilities.supportsJson) {
 *   // Fallback to JSON
 * }
 * ```
 *
 * @public
 */
export interface DatabaseCapabilities {
  /** Database dialect */
  dialect: SupportedDialect;

  /**
   * Native JSONB support (PostgreSQL only).
   *
   * @remarks
   * JSONB provides better performance and indexing than JSON.
   * Other databases will use JSON or emulated JSON.
   */
  supportsJsonb: boolean;

  /**
   * JSON column type support.
   *
   * @remarks
   * All supported databases have some form of JSON support:
   * - PostgreSQL: Native JSON and JSONB
   * - MySQL: Native JSON column type
   * - SQLite: JSON functions (json_extract, json_array, etc.)
   */
  supportsJson: boolean;

  /**
   * Array column type support (PostgreSQL only).
   *
   * @remarks
   * PostgreSQL has native array types. Other databases must use
   * JSON arrays or separate tables.
   */
  supportsArrays: boolean;

  /**
   * Generated/computed columns support.
   *
   * @remarks
   * Support for columns whose values are automatically computed from
   * other columns:
   * - PostgreSQL: GENERATED ALWAYS AS ... STORED
   * - MySQL: Generated columns
   * - SQLite: Generated columns (3.31.0+)
   */
  supportsGeneratedColumns: boolean;

  /**
   * Full-text search support.
   *
   * @remarks
   * Native full-text search capabilities:
   * - PostgreSQL: tsvector/tsquery
   * - MySQL: FULLTEXT indexes (limited)
   * - SQLite: FTS5 extension (not enabled by default)
   */
  supportsFts: boolean;

  /**
   * Case-insensitive ILIKE operator support (PostgreSQL only).
   *
   * @remarks
   * Other databases emulate it by folding both sides, then LIKE: `lower()` on MySQL, and
   * Nextly's own `nextly_fold_case` on SQLite, whose `lower()` folds ASCII only (see
   * `caseFolded` in text-match).
   */
  supportsIlike: boolean;

  /**
   * RETURNING clause support.
   *
   * @remarks
   * Support for returning data from INSERT/UPDATE/DELETE:
   * - PostgreSQL: Yes
   * - MySQL: No (requires separate SELECT)
   * - SQLite: Yes
   */
  supportsReturning: boolean;

  /**
   * Savepoint support for nested transactions.
   *
   * @remarks
   * - PostgreSQL: Yes
   * - MySQL: No (limited support, not recommended)
   * - SQLite: Yes
   */
  supportsSavepoints: boolean;

  /**
   * ON CONFLICT clause support for upserts.
   *
   * @remarks
   * - PostgreSQL: ON CONFLICT DO NOTHING/UPDATE
   * - MySQL: ON DUPLICATE KEY UPDATE (different syntax)
   * - SQLite: ON CONFLICT (similar to PostgreSQL)
   */
  supportsOnConflict: boolean;

  /**
   * Maximum number of parameters per query.
   *
   * @remarks
   * Database-specific limits:
   * - PostgreSQL: 65,535
   * - MySQL: 65,535
   * - SQLite: 999 (can be increased with SQLITE_MAX_VARIABLE_NUMBER)
   */
  maxParamsPerQuery: number;

  /**
   * Maximum length for table/column identifiers.
   *
   * @remarks
   * - PostgreSQL: 63 bytes
   * - MySQL: 64 characters
   * - SQLite: No limit (practically unlimited)
   */
  maxIdentifierLength: number;

  /**
   * Whether the server accepts `SELECT ... FOR SHARE`.
   *
   * @remarks
   * Reported by the MySQL adapter once it has connected and read the server's
   * version: MySQL 8, Aurora MySQL and Vitess/PlanetScale accept it, MariaDB
   * and TiDB reject it as a syntax error. PostgreSQL always accepts it and
   * SQLite has no row locks, so their adapters leave it unset. Unset means
   * not known; a caller then takes a lock every server accepts.
   *
   * @experimental
   */
  sharedRowLock?: boolean;

  /**
   * Whether the server can key a unique index on an expression, such as `NULLIF(col, '')`.
   *
   * @remarks
   * Reported by the MySQL adapter once it has connected and read the server's version: MySQL
   * 8.0.13 and later can (functional key parts), and the MySQL-compatible variants are reported
   * as unable. PostgreSQL and SQLite always can, so their adapters leave it unset. On MySQL, unset
   * means not known yet.
   *
   * @experimental
   */
  functionalIndexes?: boolean;
}

/**
 * Connection pool statistics.
 *
 * @remarks
 * Provides visibility into connection pool health. Not all adapters
 * provide pool statistics (e.g., SQLite is single-connection).
 *
 * @public
 */
export interface PoolStats {
  /** Total number of connections in the pool */
  total: number;

  /** Number of idle (available) connections */
  idle: number;

  /** Number of clients waiting for a connection */
  waiting: number;

  /** Number of connections currently in use */
  active: number;
}

/**
 * Whether a connection's traffic is encrypted.
 *
 * - `"encrypted"` / `"unencrypted"`: what the database session said about
 *   itself, or encrypted where this process's own socket negotiated TLS to a
 *   pooler whose session to the server is plain.
 * - `"unknown"`: the read failed, or the server would not say. Never a pass.
 * - `"not-applicable"`: there is no network connection to encrypt (a local file).
 *
 * @public
 */
export type ConnectionEncryption =
  | "encrypted"
  | "unencrypted"
  | "unknown"
  | "not-applicable";

/**
 * What an adapter can say about the connection it holds, for a health check.
 *
 * Holds no address: whether the database is on this machine is judged inside
 * the adapter, from its own configuration, and only the answer leaves it.
 *
 * @public
 */
export interface ConnectionInspection {
  /** Whether a session's connection is encrypted, read from the session itself. */
  encryption: ConnectionEncryption;
  /**
   * Whether the database runs on this machine: a loopback address, a local
   * socket or a file. `false` when the address could not be judged.
   */
  local: boolean;
  /** The database server's version, such as "17.2"; absent when it could not be read. */
  serverVersion?: string;
  /** How long one small query took, in whole milliseconds; absent when it failed. */
  roundTripMs?: number;
}
