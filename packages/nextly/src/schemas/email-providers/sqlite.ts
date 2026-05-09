/**
 * SQLite Schema for Email Providers
 *
 * Defines the `email_providers` table schema for SQLite databases
 * using Drizzle ORM. This schema stores email provider configurations
 * (SMTP, Resend, SendLayer) managed via the Admin Settings UI.
 *
 * @module schemas/email-providers/sqlite
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   emailProvidersSqlite,
 *   type EmailProviderSqlite,
 *   type EmailProviderInsertSqlite,
 * } from '../schemas/email-providers/sqlite';
 *
 * // Insert a new provider
 * await db.insert(emailProvidersSqlite).values({
 *   name: 'Production SMTP',
 *   type: 'smtp',
 *   fromEmail: 'noreply@example.com',
 *   configuration: { host: 'smtp.example.com', port: 587 },
 * });
 * ```
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import type { EmailProviderType } from "./types";

// ============================================================
// Email Providers Table (SQLite)
// ============================================================

/**
 * SQLite schema for the `email_providers` table.
 *
 * Stores email provider configurations managed through the admin
 * Settings UI. Supports SMTP, Resend, and SendLayer providers.
 * Sensitive fields in `configuration` (passwords, API keys) are
 * encrypted at rest by the service layer.
 *
 * @example
 * ```typescript
 * // Query the default provider
 * const defaultProvider = await db
 *   .select()
 *   .from(emailProvidersSqlite)
 *   .where(eq(emailProvidersSqlite.isDefault, true))
 *   .limit(1);
 *
 * // Query all active providers
 * const activeProviders = await db
 *   .select()
 *   .from(emailProvidersSqlite)
 *   .where(eq(emailProvidersSqlite.isActive, true));
 * ```
 */
export const emailProvidersSqlite = sqliteTable(
  "email_providers",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /** Unique identifier (UUID v4, auto-generated) */
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // --------------------------------------------------------
    // Provider Identity
    // --------------------------------------------------------

    /**
     * Display name for this provider.
     * @example 'Production SMTP', 'Resend API'
     */
    name: text("name").notNull(),

    /**
     * Provider type determining which adapter is used for sending.
     * One of: 'smtp', 'resend', 'sendlayer'.
     */
    type: text("type").$type<EmailProviderType>().notNull(),

    /**
     * Default sender email address.
     * @example 'noreply@example.com'
     */
    fromEmail: text("from_email").notNull(),

    /**
     * Default sender display name (optional).
     * @example 'My App'
     */
    fromName: text("from_name"),

    // --------------------------------------------------------
    // Configuration
    // --------------------------------------------------------

    /**
     * Provider-specific configuration stored as JSON text.
     * Sensitive fields (passwords, API keys) are encrypted at rest.
     *
     * Shape depends on `type`:
     * - `smtp`: `{ host, port, secure, username, password }`
     * - `resend`: `{ apiKey }`
     * - `sendlayer`: `{ apiKey }`
     */
    configuration: text("configuration", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),

    // --------------------------------------------------------
    // Status
    // --------------------------------------------------------

    /**
     * Whether this is the default provider for sending emails.
     * Only one provider can be default at a time (enforced by service layer).
     */
    isDefault: integer("is_default", { mode: "boolean" })
      .default(false)
      .notNull(),

    /**
     * Whether this provider is currently active.
     * Inactive providers are stored but not used for sending.
     */
    isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),

    // --------------------------------------------------------
    // Metadata
    // --------------------------------------------------------

    /** When the provider was created */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    /** When the provider was last updated */
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    // --------------------------------------------------------
    // Indexes for Query Performance
    // --------------------------------------------------------

    /** Index for filtering providers by type */
    index("email_providers_type_idx").on(table.type),

    /** Index for filtering by default status */
    index("email_providers_is_default_idx").on(table.isDefault),

    /** Index for filtering active/inactive providers */
    index("email_providers_is_active_idx").on(table.isActive),

    /** Index for sorting by creation date */
    index("email_providers_created_at_idx").on(table.createdAt),
  ]
);

// ============================================================
// Type Exports (Drizzle Inference)
// ============================================================

/**
 * SQLite-specific select type for email providers.
 * Represents a full row from the `email_providers` table.
 */
export type EmailProviderSqlite = typeof emailProvidersSqlite.$inferSelect;

/**
 * SQLite-specific insert type for email providers.
 * Fields with defaults (id, isDefault, isActive, timestamps) are optional.
 */
export type EmailProviderInsertSqlite =
  typeof emailProvidersSqlite.$inferInsert;
