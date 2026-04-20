/**
 * Email Templates Schema Module
 *
 * Provides dialect-agnostic types and dialect-specific schemas for the
 * `email_templates` table used to manage email templates with variable
 * interpolation.
 *
 * @module schemas/email-templates
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import type {
 *   EmailTemplateVariable,
 *   EmailTemplateInsert,
 *   EmailTemplateRecord,
 * } from '../schemas/email-templates';
 * ```
 */

// ============================================================
// Type Exports
// ============================================================

export type {
  EmailTemplateVariable,
  EmailTemplateInsert,
  EmailTemplateRecord,
} from "./types";

// ============================================================
// PostgreSQL Schema Exports
// ============================================================

export {
  emailTemplatesPg,
  type EmailTemplatePg,
  type EmailTemplateInsertPg,
} from "./postgres";

// ============================================================
// MySQL Schema Exports
// ============================================================

export {
  emailTemplatesMysql,
  type EmailTemplateMysql,
  type EmailTemplateInsertMysql,
} from "./mysql";

// ============================================================
// SQLite Schema Exports
// ============================================================

export {
  emailTemplatesSqlite,
  type EmailTemplateSqlite,
  type EmailTemplateInsertSqlite,
} from "./sqlite";
