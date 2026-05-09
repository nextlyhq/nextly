/**
 * Dynamic Components Schema Module
 *
 * Provides dialect-agnostic types and dialect-specific schemas for the
 * `dynamic_components` metadata table.
 *
 * @module schemas/dynamic-components
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   type DynamicComponentRecord,
 *   type DynamicComponentInsert,
 *   type ComponentSource,
 *   type ComponentMigrationStatus,
 * } from '@nextly/schemas/dynamic-components';
 * ```
 */

// ============================================================
// Type Exports
// ============================================================

export type {
  // Source and status types
  ComponentSource,
  ComponentMigrationStatus,

  // Dynamic component types
  DynamicComponentInsert,
  DynamicComponentRecord,
} from "./types";

export { COMPONENT_SOURCE_TYPES, COMPONENT_MIGRATION_STATUSES } from "./types";

// ============================================================
// PostgreSQL Schema Exports
// ============================================================

export {
  dynamicComponentsPg,
  type DynamicComponentPg,
  type DynamicComponentInsertPg,
} from "./postgres";

// ============================================================
// MySQL Schema Exports
// ============================================================

export {
  dynamicComponentsMysql,
  type DynamicComponentMysql,
  type DynamicComponentInsertMysql,
} from "./mysql";

// ============================================================
// SQLite Schema Exports
// ============================================================

export {
  dynamicComponentsSqlite,
  type DynamicComponentSqlite,
  type DynamicComponentInsertSqlite,
} from "./sqlite";
