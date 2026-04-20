/**
 * Shared type definitions for the General Settings schema.
 *
 * @module schemas/general-settings/types
 * @since 1.0.0
 */

// ============================================================
// General Settings Record
// ============================================================

/**
 * Full record type for the `site_settings` singleton row.
 * The `id` is always `'default'`.
 */
export interface GeneralSettingsRecord {
  /** Always 'default' — enforces singleton pattern. */
  id: string;
  /** Display name for the application (used in admin UI title, email templates). */
  applicationName: string | null;
  /** Primary URL where the site is hosted (used for email links). */
  siteUrl: string | null;
  /** Primary email address for administrative notifications / default sender. */
  adminEmail: string | null;
  /** IANA timezone identifier, e.g. 'America/New_York'. */
  timezone: string | null;
  /** Date display format string, e.g. 'MM/DD/YYYY'. */
  dateFormat: string | null;
  /** Time display format: '12h' or '24h'. */
  timeFormat: string | null;
  /** URL of the logo image shown in the admin sidebar and auth pages. */
  logoUrl: string | null;
  /** JSON array of custom sidebar groups for admin navigation. */
  customSidebarGroups: string | null;
  /** JSON object mapping plugin slugs to their sidebar placement group overrides. */
  pluginPlacements: string | null;
  /** When the settings were last updated. */
  updatedAt: Date;
}

/**
 * Fields that can be updated via the settings form.
 * Excludes immutable `id` and auto-managed `updatedAt`.
 */
export type GeneralSettingsUpdate = Omit<
  GeneralSettingsRecord,
  "id" | "updatedAt"
>;
