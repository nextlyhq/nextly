/**
 * User Field Definitions Schema Module
 *
 * Provides dialect-agnostic types and dialect-specific schemas for the
 * `user_field_definitions` table used to manage custom user field metadata.
 *
 * @module schemas/user-field-definitions
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import type {
 *   UserFieldSource,
 *   UserFieldDefinitionInsert,
 *   UserFieldDefinitionRecord,
 * } from '../schemas/user-field-definitions';
 * ```
 */

// ============================================================
// Type Exports
// ============================================================

export type {
  UserFieldSource,
  UserFieldDefinitionInsert,
  UserFieldDefinitionRecord,
} from "./types";

// ============================================================
// PostgreSQL Schema Exports
// ============================================================

export {
  userFieldDefinitionsPg,
  type UserFieldDefinitionPg,
  type UserFieldDefinitionInsertPg,
} from "./postgres";

// ============================================================
// MySQL Schema Exports
// ============================================================

export {
  userFieldDefinitionsMysql,
  type UserFieldDefinitionMysql,
  type UserFieldDefinitionInsertMysql,
} from "./mysql";

// ============================================================
// SQLite Schema Exports
// ============================================================

export {
  userFieldDefinitionsSqlite,
  type UserFieldDefinitionSqlite,
  type UserFieldDefinitionInsertSqlite,
} from "./sqlite";
