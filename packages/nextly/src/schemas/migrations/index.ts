/**
 * Migration Tracking Schema Module
 *
 * Provides dialect-specific schemas for the `nextly_migrations` table
 * which tracks all applied database migrations for collection schema
 * changes. Supports PostgreSQL, MySQL, and SQLite databases.
 *
 * @module schemas/migrations
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * // Import types (dialect-agnostic, from dynamic-collections)
 * import type {
 *   MigrationRecordStatus,
 *   MigrationRecordInsert,
 *   MigrationRecord,
 * } from '@nextly/schemas/migrations';
 *
 * // Import dialect-specific schema
 * import { nextlyMigrationsPg } from '@nextly/schemas/migrations';
 * // or
 * import { nextlyMigrationsMysql } from '@nextly/schemas/migrations';
 * // or
 * import { nextlyMigrationsSqlite } from '@nextly/schemas/migrations';
 * ```
 */

// ============================================================
// Type Exports (Re-exported from dynamic-collections/types)
// ============================================================

export type {
  MigrationRecordStatus,
  MigrationRecordInsert,
  MigrationRecord,
} from "../dynamic-collections/types";

// ============================================================
// PostgreSQL Schema Exports
// ============================================================

export {
  nextlyMigrationsPg,
  type NextlyMigrationPg,
  type NextlyMigrationInsertPg,
} from "./postgres";

// ============================================================
// MySQL Schema Exports
// ============================================================

export {
  nextlyMigrationsMysql,
  type NextlyMigrationMysql,
  type NextlyMigrationInsertMysql,
} from "./mysql";

// ============================================================
// SQLite Schema Exports
// ============================================================

export {
  nextlyMigrationsSqlite,
  type NextlyMigrationSqlite,
  type NextlyMigrationInsertSqlite,
} from "./sqlite";
