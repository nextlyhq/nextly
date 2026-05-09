/**
 * MySQL Schema for Email Templates
 *
 * Defines the `email_templates` table schema for MySQL databases
 * using Drizzle ORM. This schema stores email templates with variable
 * interpolation support, managed via the Admin Settings UI.
 *
 * @module schemas/email-templates/mysql
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   emailTemplatesMysql,
 *   type EmailTemplateMysql,
 *   type EmailTemplateInsertMysql,
 * } from '../schemas/email-templates/mysql';
 *
 * // Insert a new template
 * await db.insert(emailTemplatesMysql).values({
 *   name: 'Welcome Email',
 *   slug: 'welcome',
 *   subject: 'Welcome to {{appName}}, {{userName}}!',
 *   htmlContent: '<h1>Welcome, {{userName}}!</h1>',
 * });
 * ```
 */

import {
  mysqlTable,
  varchar,
  text,
  boolean,
  datetime,
  json,
  index,
} from "drizzle-orm/mysql-core";

import type { EmailAttachmentInput } from "../../domains/email/types";

import type { EmailTemplateVariable } from "./types";

// ============================================================
// Email Templates Table (MySQL)
// ============================================================

/**
 * MySQL schema for the `email_templates` table.
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
 *   .from(emailTemplatesMysql)
 *   .where(eq(emailTemplatesMysql.slug, 'password-reset'))
 *   .limit(1);
 *
 * // Query all active templates
 * const activeTemplates = await db
 *   .select()
 *   .from(emailTemplatesMysql)
 *   .where(eq(emailTemplatesMysql.isActive, true));
 * ```
 */
export const emailTemplatesMysql = mysqlTable(
  "email_templates",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /** Unique identifier (UUID v4, auto-generated) */
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // --------------------------------------------------------
    // Template Identity
    // --------------------------------------------------------

    /**
     * Display name for this template.
     * @example 'Welcome Email', 'Password Reset'
     */
    name: varchar("name", { length: 255 }).notNull(),

    /**
     * Unique identifier slug for programmatic access.
     * @example 'welcome', 'password-reset', '_email-header'
     */
    slug: varchar("slug", { length: 255 }).unique().notNull(),

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
    variables: json("variables").$type<EmailTemplateVariable[]>(),

    /**
     * Whether to wrap `htmlContent` with the shared email
     * header/footer layout at send time.
     */
    useLayout: boolean("use_layout").default(true).notNull(),

    /**
     * Whether this template is currently active.
     * Inactive templates are stored but cannot be used for sending.
     */
    isActive: boolean("is_active").default(true).notNull(),

    /**
     * Optional provider ID to override the default email provider
     * for this specific template. When null, the system default is used.
     */
    providerId: varchar("provider_id", { length: 36 }),

    /**
     * Default attachments for this template. Merged with per-send
     * attachments at send time (dedupe by mediaId, per-send wins).
     * When null, no default attachments are applied.
     */
    attachments: json("attachments").$type<EmailAttachmentInput[]>(),

    // --------------------------------------------------------
    // Metadata
    // --------------------------------------------------------

    /** When the template was created */
    createdAt: datetime("created_at")
      .notNull()
      .$defaultFn(() => new Date()),

    /** When the template was last updated */
    updatedAt: datetime("updated_at")
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
 * MySQL-specific select type for email templates.
 * Represents a full row from the `email_templates` table.
 */
export type EmailTemplateMysql = typeof emailTemplatesMysql.$inferSelect;

/**
 * MySQL-specific insert type for email templates.
 * Fields with defaults (id, useLayout, isActive, timestamps) are optional.
 */
export type EmailTemplateInsertMysql = typeof emailTemplatesMysql.$inferInsert;
