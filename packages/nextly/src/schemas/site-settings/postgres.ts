/**
 * PostgreSQL Schema for General Settings
 *
 * Defines the `site_settings` singleton table for PostgreSQL.
 * Only one row ever exists (id = 'default').
 *
 * @module schemas/site-settings/postgres
 * @since 1.0.0
 */

import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";

export const siteSettingsPg = pgTable("site_settings", {
  /** Always 'default' — enforces singleton pattern. */
  id: text("id").primaryKey(),

  /** Display name for the application. */
  applicationName: varchar("application_name", { length: 255 }),

  /** Primary URL where the site is hosted. */
  siteUrl: varchar("site_url", { length: 2048 }),

  /** Primary email for administrative notifications. */
  adminEmail: varchar("admin_email", { length: 255 }),

  /** IANA timezone identifier, e.g. 'America/New_York'. */
  timezone: varchar("timezone", { length: 100 }),

  /** Date display format string, e.g. 'MM/DD/YYYY'. */
  dateFormat: varchar("date_format", { length: 50 }),

  /** Time display format: '12h' or '24h'. */
  timeFormat: varchar("time_format", { length: 50 }),

  /** URL of the logo image shown in the admin sidebar and auth pages. */
  logoUrl: varchar("logo_url", { length: 2048 }),

  /** URL of the logo image shown when the admin panel is in dark mode. */
  logoUrlDark: varchar("logo_url_dark", { length: 2048 }),

  /** JSON array of custom sidebar groups, e.g. [{"slug":"analytics","name":"Analytics","icon":"BarChart"}] */
  customSidebarGroups: text("custom_sidebar_groups"),

  /** JSON object mapping plugin slugs to sidebar group overrides, e.g. {"form-builder":"collections"} */
  pluginPlacements: text("plugin_placements"),

  /**
   * Revocation generation for preview links. Every preview token records the
   * generation it was minted under, and verification refuses a token whose
   * generation is not the current one — so incrementing this invalidates every
   * link ever issued, including sessions already in flight, with nothing to
   * store, sweep or replicate per token.
   *
   * Monotonic by contract: it only ever moves forward. Lowering it would
   * re-validate tokens that were already revoked, which is why the settings
   * form cannot write it.
   */
  previewTokenGeneration: integer("preview_token_generation")
    .notNull()
    .default(0),

  /** When the settings were last updated. */
  updatedAt: timestamp("updated_at", { withTimezone: false })
    .defaultNow()
    .notNull(),
});

export type SiteSettingsPg = typeof siteSettingsPg.$inferSelect;
export type SiteSettingsInsertPg = typeof siteSettingsPg.$inferInsert;
