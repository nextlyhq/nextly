/**
 * MySQL Schema for Email Providers
 *
 * Defines the `email_providers` table schema for MySQL databases
 * using Drizzle ORM. This schema stores email provider configurations
 * (SMTP, Resend, SendLayer) managed via the Admin Settings UI.
 *
 * @module schemas/email-providers/mysql
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   emailProvidersMysql,
 *   type EmailProviderMysql,
 *   type EmailProviderInsertMysql,
 * } from '../schemas/email-providers/mysql';
 *
 * // Insert a new provider
 * await db.insert(emailProvidersMysql).values({
 *   name: 'Production SMTP',
 *   type: 'smtp',
 *   fromEmail: 'noreply@example.com',
 *   configuration: { host: 'smtp.example.com', port: 587 },
 * });
 * ```
 */

import {
  mysqlTable,
  varchar,
  boolean,
  datetime,
  json,
  index,
} from "drizzle-orm/mysql-core";

import type { EmailProviderType } from "./types";

// ============================================================
// Email Providers Table (MySQL)
// ============================================================

/**
 * MySQL schema for the `email_providers` table.
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
 *   .from(emailProvidersMysql)
 *   .where(eq(emailProvidersMysql.isDefault, true))
 *   .limit(1);
 *
 * // Query all active providers
 * const activeProviders = await db
 *   .select()
 *   .from(emailProvidersMysql)
 *   .where(eq(emailProvidersMysql.isActive, true));
 * ```
 */
export const emailProvidersMysql = mysqlTable(
  "email_providers",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /** Unique identifier (UUID v4, auto-generated) */
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // --------------------------------------------------------
    // Provider Identity
    // --------------------------------------------------------

    /**
     * Display name for this provider.
     * @example 'Production SMTP', 'Resend API'
     */
    name: varchar("name", { length: 255 }).notNull(),

    /**
     * Provider type determining which adapter is used for sending.
     * One of: 'smtp', 'resend', 'sendlayer'.
     */
    type: varchar("type", { length: 50 }).$type<EmailProviderType>().notNull(),

    /**
     * Default sender email address.
     * @example 'noreply@example.com'
     */
    fromEmail: varchar("from_email", { length: 255 }).notNull(),

    /**
     * Default sender display name (optional).
     * @example 'My App'
     */
    fromName: varchar("from_name", { length: 255 }),

    // --------------------------------------------------------
    // Configuration
    // --------------------------------------------------------

    /**
     * Provider-specific configuration stored as JSON.
     * Sensitive fields (passwords, API keys) are encrypted at rest.
     *
     * Shape depends on `type`:
     * - `smtp`: `{ host, port, secure, username, password }`
     * - `resend`: `{ apiKey }`
     * - `sendlayer`: `{ apiKey }`
     */
    configuration: json("configuration")
      .$type<Record<string, unknown>>()
      .notNull(),

    // --------------------------------------------------------
    // Status
    // --------------------------------------------------------

    /**
     * Whether this is the default provider for sending emails.
     * Only one provider can be default at a time (enforced by service layer).
     */
    isDefault: boolean("is_default").default(false).notNull(),

    /**
     * Whether this provider is currently active.
     * Inactive providers are stored but not used for sending.
     */
    isActive: boolean("is_active").default(true).notNull(),

    // --------------------------------------------------------
    // Metadata
    // --------------------------------------------------------

    /** When the provider was created */
    createdAt: datetime("created_at")
      .notNull()
      .$defaultFn(() => new Date()),

    /** When the provider was last updated */
    updatedAt: datetime("updated_at")
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
 * MySQL-specific select type for email providers.
 * Represents a full row from the `email_providers` table.
 */
export type EmailProviderMysql = typeof emailProvidersMysql.$inferSelect;

/**
 * MySQL-specific insert type for email providers.
 * Fields with defaults (id, isDefault, isActive, timestamps) are optional.
 */
export type EmailProviderInsertMysql = typeof emailProvidersMysql.$inferInsert;
