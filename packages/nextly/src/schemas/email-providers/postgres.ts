/**
 * PostgreSQL Schema for Email Providers
 *
 * Defines the `email_providers` table schema for PostgreSQL databases
 * using Drizzle ORM. This schema stores email provider configurations
 * (SMTP, Resend, SendLayer) managed via the Admin Settings UI.
 *
 * @module schemas/email-providers/postgres
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   emailProvidersPg,
 *   type EmailProviderPg,
 *   type EmailProviderInsertPg,
 * } from '../schemas/email-providers/postgres';
 *
 * // Insert a new provider
 * await db.insert(emailProvidersPg).values({
 *   name: 'Production SMTP',
 *   type: 'smtp',
 *   fromEmail: 'noreply@example.com',
 *   configuration: { host: 'smtp.example.com', port: 587 },
 * });
 * ```
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { EmailProviderType } from "./types";

// ============================================================
// Email Providers Table (PostgreSQL)
// ============================================================

/**
 * PostgreSQL schema for the `email_providers` table.
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
 *   .from(emailProvidersPg)
 *   .where(eq(emailProvidersPg.isDefault, true))
 *   .limit(1);
 *
 * // Query all active providers
 * const activeProviders = await db
 *   .select()
 *   .from(emailProvidersPg)
 *   .where(eq(emailProvidersPg.isActive, true));
 * ```
 */
export const emailProvidersPg = pgTable(
  "email_providers",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /** Unique identifier (UUID v4, auto-generated) */
    id: uuid("id").primaryKey().defaultRandom(),

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
     * Provider-specific configuration stored as JSONB.
     * Sensitive fields (passwords, API keys) are encrypted at rest.
     *
     * Shape depends on `type`:
     * - `smtp`: `{ host, port, secure, username, password }`
     * - `resend`: `{ apiKey }`
     * - `sendlayer`: `{ apiKey }`
     */
    configuration: jsonb("configuration")
      .$type<Record<string, unknown>>()
      .notNull(),

    // --------------------------------------------------------
    // Status
    // --------------------------------------------------------

    /**
     * Whether this is the default provider for sending emails.
     * Only one provider can be default at a time (enforced by
     * partial unique index and service layer).
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
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),

    /** When the provider was last updated */
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  table => [
    // --------------------------------------------------------
    // Indexes for Query Performance
    // --------------------------------------------------------

    /** Index for filtering providers by type */
    index("email_providers_type_idx").on(table.type),

    /**
     * Partial unique index ensuring only one default provider.
     * PostgreSQL-specific; service layer enforces this for other dialects.
     */
    uniqueIndex("email_providers_default_unique_idx")
      .on(table.isDefault)
      .where(sql`${table.isDefault} = true`),

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
 * PostgreSQL-specific select type for email providers.
 * Represents a full row from the `email_providers` table.
 */
export type EmailProviderPg = typeof emailProvidersPg.$inferSelect;

/**
 * PostgreSQL-specific insert type for email providers.
 * Fields with defaults (id, isDefault, isActive, timestamps) are optional.
 */
export type EmailProviderInsertPg = typeof emailProvidersPg.$inferInsert;
