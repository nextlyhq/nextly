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
   * Other databases must emulate with LOWER(column) LIKE LOWER(value).
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
