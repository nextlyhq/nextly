/**
 * PostgreSQL Schema for Email Templates
 *
 * Defines the `email_templates` table schema for PostgreSQL databases
 * using Drizzle ORM. This schema stores email templates with variable
 * interpolation support, managed via the Admin Settings UI.
 *
 * @module schemas/email-templates/postgres
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   emailTemplatesPg,
 *   type EmailTemplatePg,
 *   type EmailTemplateInsertPg,
 * } from '../schemas/email-templates/postgres';
 *
 * // Insert a new template
 * await db.insert(emailTemplatesPg).values({
 *   name: 'Welcome Email',
 *   slug: 'welcome',
 *   subject: 'Welcome to {{appName}}, {{userName}}!',
 *   htmlContent: '<h1>Welcome, {{userName}}!</h1>',
 * });
 * ```
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

import type { EmailAttachmentInput } from "../../domains/email/types";

import type { EmailTemplateVariable } from "./types";

// ============================================================
// Email Templates Table (PostgreSQL)
// ============================================================

/**
 * PostgreSQL schema for the `email_templates` table.
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
 *   .from(emailTemplatesPg)
 *   .where(eq(emailTemplatesPg.slug, 'password-reset'))
 *   .limit(1);
 *
 * // Query all active templates
 * const activeTemplates = await db
 *   .select()
 *   .from(emailTemplatesPg)
 *   .where(eq(emailTemplatesPg.isActive, true));
 * ```
 */
export const emailTemplatesPg = pgTable(
  "email_templates",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /** Unique identifier (UUID v4, auto-generated) */
    id: uuid("id").primaryKey().defaultRandom(),

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
    variables: jsonb("variables").$type<EmailTemplateVariable[]>(),

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
    providerId: uuid("provider_id"),

    /**
     * Default attachments for this template. Merged with per-send
     * attachments at send time (dedupe by mediaId, per-send wins).
     * When null, no default attachments are applied.
     */
    attachments: jsonb("attachments").$type<EmailAttachmentInput[]>(),

    // --------------------------------------------------------
    // Metadata
    // --------------------------------------------------------

    /** When the template was created */
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),

    /** When the template was last updated */
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
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
 * PostgreSQL-specific select type for email templates.
 * Represents a full row from the `email_templates` table.
 */
export type EmailTemplatePg = typeof emailTemplatesPg.$inferSelect;

/**
 * PostgreSQL-specific insert type for email templates.
 * Fields with defaults (id, useLayout, isActive, timestamps) are optional.
 */
export type EmailTemplateInsertPg = typeof emailTemplatesPg.$inferInsert;
