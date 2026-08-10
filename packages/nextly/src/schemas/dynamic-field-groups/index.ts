/**
 * Dynamic Components Schema Module
 *
 * Provides dialect-agnostic types and dialect-specific schemas for the
 * `dynamic_components` metadata table.
 *
 * @module schemas/dynamic-field-groups
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   type DynamicFieldGroupRecord,
 *   type DynamicFieldGroupInsert,
 *   type FieldGroupSource,
 *   type FieldGroupMigrationStatus,
 * } from '@nextly/schemas/dynamic-field-groups';
 * ```
 */

// ============================================================
// Type Exports
// ============================================================

export type {
  // Source and status types
  FieldGroupSource,
  FieldGroupMigrationStatus,

  // Dynamic component types
  DynamicFieldGroupInsert,
  DynamicFieldGroupRecord,
} from "./types";

export {
  FIELD_GROUP_SOURCE_TYPES,
  FIELD_GROUP_MIGRATION_STATUSES,
} from "./types";

// ============================================================
// PostgreSQL Schema Exports
// ============================================================

export {
  buildDynamicFieldGroupsPg,
  dynamicFieldGroupsPg,
  type DynamicFieldGroupPg,
  type DynamicFieldGroupInsertPg,
} from "./postgres";

// ============================================================
// MySQL Schema Exports
// ============================================================

export {
  buildDynamicFieldGroupsMysql,
  dynamicFieldGroupsMysql,
  type DynamicFieldGroupMysql,
  type DynamicFieldGroupInsertMysql,
} from "./mysql";

// ============================================================
// SQLite Schema Exports
// ============================================================

export {
  buildDynamicFieldGroupsSqlite,
  dynamicFieldGroupsSqlite,
  type DynamicFieldGroupSqlite,
  type DynamicFieldGroupInsertSqlite,
} from "./sqlite";
