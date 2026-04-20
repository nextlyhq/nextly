/**
 * SQLite Schema for Email Templates
 *
 * Defines the `email_templates` table schema for SQLite databases
 * using Drizzle ORM. This schema stores email templates with variable
 * interpolation support, managed via the Admin Settings UI.
 *
 * @module schemas/email-templates/sqlite
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   emailTemplatesSqlite,
 *   type EmailTemplateSqlite,
 *   type EmailTemplateInsertSqlite,
 * } from '../schemas/email-templates/sqlite';
 *
 * // Insert a new template
 * await db.insert(emailTemplatesSqlite).values({
 *   name: 'Welcome Email',
 *   slug: 'welcome',
 *   subject: 'Welcome to {{appName}}, {{userName}}!',
 *   htmlContent: '<h1>Welcome, {{userName}}!</h1>',
 * });
 * ```
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import type { EmailAttachmentInput } from "../../domains/email/types";

import type { EmailTemplateVariable } from "./types";

// ============================================================
// Email Templates Table (SQLite)
// ============================================================

/**
 * SQLite schema for the `email_templates` table.
 *
 * Stores email templates with `{{variable}}` interpolation support.
 * Templates can be managed via the admin Settings UI. Built-in
 * templates (welcome, password-reset, email-verification) and
 * layout templates (_email-header, _email-footer) are auto-created
 * by the service layer.
 *
 * @example
 * ```typescript
 * // Query template by slug
 * const template = await db
 *   .select()
 *   .from(emailTemplatesSqlite)
 *   .where(eq(emailTemplatesSqlite.slug, 'password-reset'))
 *   .limit(1);
 *
 * // Query all active templates
 * const activeTemplates = await db
 *   .select()
 *   .from(emailTemplatesSqlite)
 *   .where(eq(emailTemplatesSqlite.isActive, true));
 * ```
 */
export const emailTemplatesSqlite = sqliteTable(
  "email_templates",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /** Unique identifier (UUID v4, auto-generated) */
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // --------------------------------------------------------
    // Template Identity
    // --------------------------------------------------------

    /**
     * Display name for this template.
     * @example 'Welcome Email', 'Password Reset'
     */
    name: text("name").notNull(),

    /**
     * Unique identifier slug for programmatic access.
     * @example 'welcome', 'password-reset', '_email-header'
     */
    slug: text("slug").unique().notNull(),

    // --------------------------------------------------------
    // Content
    // --------------------------------------------------------

    /**
     * Email subject line. Supports `{{variable}}` interpolation.
     * @example 'Reset your {{appName}} password'
     */
    subject: text("subject").notNull(),

    /**
     * HTML body content. Supports `{{variable}}` interpolation.
     * When `useLayout` is true, this content is wrapped with the
     * shared header/footer layout at send time.
     */
    htmlContent: text("html_content").notNull(),

    /**
     * Optional plain text fallback content.
     * Supports `{{variable}}` interpolation.
     */
    plainTextContent: text("plain_text_content"),

    // --------------------------------------------------------
    // Template Metadata
    // --------------------------------------------------------

    /**
     * Available template variables with descriptions.
     * Displayed in the admin UI template editor for reference.
     */
    variables: text("variables", { mode: "json" }).$type<
      EmailTemplateVariable[]
    >(),

    /**
     * Whether to wrap `htmlContent` with the shared email
     * header/footer layout at send time.
     */
    useLayout: integer("use_layout", { mode: "boolean" })
      .default(true)
      .notNull(),

    /**
     * Whether this template is currently active.
     * Inactive templates are stored but cannot be used for sending.
     */
    isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),

    /**
     * Optional provider ID to override the default email provider
     * for this specific template. When null, the system default is used.
     */
    providerId: text("provider_id"),

    /**
     * Default attachments for this template. Merged with per-send
     * attachments at send time (dedupe by mediaId, per-send wins).
     * Stored as a JSON string; null when no default attachments apply.
     */
    attachments: text("attachments", { mode: "json" }).$type<
      EmailAttachmentInput[]
    >(),

    // --------------------------------------------------------
    // Metadata
    // --------------------------------------------------------

    /** When the template was created */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    /** When the template was last updated */
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    // --------------------------------------------------------
    // Indexes for Query Performance
    // --------------------------------------------------------

    /** Index for filtering active/inactive templates */
    index("email_templates_is_active_idx").on(table.isActive),

    /** Index for filtering templates by provider */
    index("email_templates_provider_id_idx").on(table.providerId),

    /** Index for sorting by creation date */
    index("email_templates_created_at_idx").on(table.createdAt),
  ]
);

// ============================================================
// Type Exports (Drizzle Inference)
// ============================================================

/**
 * SQLite-specific select type for email templates.
 * Represents a full row from the `email_templates` table.
 */
export type EmailTemplateSqlite = typeof emailTemplatesSqlite.$inferSelect;

/**
 * SQLite-specific insert type for email templates.
 * Fields with defaults (id, useLayout, isActive, timestamps) are optional.
 */
export type EmailTemplateInsertSqlite =
  typeof emailTemplatesSqlite.$inferInsert;
