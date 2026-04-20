/**
 * SQLite Schema for General Settings
 *
 * Defines the `site_settings` singleton table for SQLite.
 * Only one row ever exists (id = 'default').
 *
 * @module schemas/general-settings/sqlite
 * @since 1.0.0
 */

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const siteSettingsSqlite = sqliteTable("site_settings", {
  /** Always 'default' — enforces singleton pattern. */
  id: text("id").primaryKey(),

  /** Display name for the application. */
  applicationName: text("application_name"),

  /** Primary URL where the site is hosted. */
  siteUrl: text("site_url"),

  /** Primary email for administrative notifications. */
  adminEmail: text("admin_email"),

  /** IANA timezone identifier, e.g. 'America/New_York'. */
  timezone: text("timezone"),

  /** Date display format string, e.g. 'MM/DD/YYYY'. */
  dateFormat: text("date_format"),

  /** Time display format: '12h' or '24h'. */
  timeFormat: text("time_format"),

  /** URL of the logo image shown in the admin sidebar and auth pages. */
  logoUrl: text("logo_url"),

  /** URL of the logo image shown when the admin panel is in dark mode. */
  logoUrlDark: text("logo_url_dark"),

  /** JSON array of custom sidebar groups, e.g. [{"slug":"analytics","name":"Analytics","icon":"BarChart"}] */
  customSidebarGroups: text("custom_sidebar_groups"),

  /** JSON object mapping plugin slugs to sidebar group overrides, e.g. {"form-builder":"collections"} */
  pluginPlacements: text("plugin_placements"),

  /** When the settings were last updated (Unix timestamp ms). */
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type SiteSettingsSqlite = typeof siteSettingsSqlite.$inferSelect;
export type SiteSettingsInsertSqlite = typeof siteSettingsSqlite.$inferInsert;
