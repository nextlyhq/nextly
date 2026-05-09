/**
 * MySQL Schema for General Settings
 *
 * Defines the `site_settings` singleton table for MySQL.
 * Only one row ever exists (id = 'default').
 *
 * @module schemas/general-settings/mysql
 * @since 1.0.0
 */

import { mysqlTable, varchar, datetime } from "drizzle-orm/mysql-core";

export const siteSettingsMysql = mysqlTable("site_settings", {
  /** Always 'default' — enforces singleton pattern. */
  id: varchar("id", { length: 50 }).primaryKey(),

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
  customSidebarGroups: varchar("custom_sidebar_groups", { length: 4096 }),

  /** JSON object mapping plugin slugs to sidebar group overrides, e.g. {"form-builder":"collections"} */
  pluginPlacements: varchar("plugin_placements", { length: 4096 }),

  /** When the settings were last updated. */
  updatedAt: datetime("updated_at").notNull(),
});

export type SiteSettingsMysql = typeof siteSettingsMysql.$inferSelect;
export type SiteSettingsInsertMysql = typeof siteSettingsMysql.$inferInsert;
