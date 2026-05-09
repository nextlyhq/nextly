/**
 * Email Providers Schema Module
 *
 * Provides dialect-agnostic types and dialect-specific schemas for the
 * `email_providers` table used to manage email sending providers.
 *
 * @module schemas/email-providers
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import type {
 *   EmailProviderType,
 *   EmailProviderInsert,
 *   EmailProviderRecord,
 * } from '../schemas/email-providers';
 * ```
 */

// ============================================================
// Type Exports
// ============================================================

export type {
  EmailProviderType,
  EmailProviderInsert,
  EmailProviderRecord,
} from "./types";

// ============================================================
// PostgreSQL Schema Exports
// ============================================================

export {
  emailProvidersPg,
  type EmailProviderPg,
  type EmailProviderInsertPg,
} from "./postgres";

// ============================================================
// MySQL Schema Exports
// ============================================================

export {
  emailProvidersMysql,
  type EmailProviderMysql,
  type EmailProviderInsertMysql,
} from "./mysql";

// ============================================================
// SQLite Schema Exports
// ============================================================

export {
  emailProvidersSqlite,
  type EmailProviderSqlite,
  type EmailProviderInsertSqlite,
} from "./sqlite";
