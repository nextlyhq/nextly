/**
 * General Settings Service
 *
 * Manages the `site_settings` singleton row — a single record
 * (id = 'default') that stores application-level configuration:
 * application name, site URL, admin email, timezone, and display formats.
 *
 * @module services/general-settings/general-settings-service
 * @since 1.0.0
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { eq, sql } from "drizzle-orm";

import { siteSettingsMysql } from "../../schemas/site-settings/mysql";
import { siteSettingsPg } from "../../schemas/site-settings/postgres";
import { siteSettingsSqlite } from "../../schemas/site-settings/sqlite";
import type {
  GeneralSettingsRecord,
  GeneralSettingsUpdate,
} from "../../schemas/site-settings/types";
import { BaseService } from "../base-service";
import type { Logger } from "../shared";

const SETTINGS_ID = "default";

function emptyRecord(): GeneralSettingsRecord {
  return {
    id: SETTINGS_ID,
    applicationName: null,
    siteUrl: null,
    adminEmail: null,
    timezone: null,
    dateFormat: null,
    timeFormat: null,
    logoUrl: null,
    customSidebarGroups: null,
    pluginPlacements: null,
    previewTokenGeneration: 0,
    updatedAt: new Date(),
  };
}

export interface CustomSidebarGroup {
  slug: string;
  name: string;
  icon?: string;
}

export class GeneralSettingsService extends BaseService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private siteSettings: any;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);

    switch (this.dialect) {
      case "postgresql":
        this.siteSettings = siteSettingsPg;
        break;
      case "mysql":
        this.siteSettings = siteSettingsMysql;
        break;
      case "sqlite":
        this.siteSettings = siteSettingsSqlite;
        break;
      default:
        throw new Error(`Unsupported dialect: ${String(this.dialect)}`);
    }
  }

  private toRecord(row: Record<string, unknown>): GeneralSettingsRecord {
    return {
      id: row.id as string,
      applicationName: (row.applicationName as string) ?? null,
      siteUrl: (row.siteUrl as string) ?? null,
      adminEmail: (row.adminEmail as string) ?? null,
      timezone: (row.timezone as string) ?? null,
      dateFormat: (row.dateFormat as string) ?? null,
      timeFormat: (row.timeFormat as string) ?? null,
      logoUrl: (row.logoUrl as string) ?? null,
      customSidebarGroups: (row.customSidebarGroups as string) ?? null,
      pluginPlacements: (row.pluginPlacements as string) ?? null,
      // A database that predates the column reads back `undefined` until the
      // reconcile adds it, and generation 0 is what every token minted before
      // any revoke carries — so the default keeps those links working rather
      // than refusing them all until the next migrate.
      previewTokenGeneration:
        typeof row.previewTokenGeneration === "number"
          ? row.previewTokenGeneration
          : 0,
      updatedAt:
        row.updatedAt instanceof Date
          ? row.updatedAt
          : new Date(row.updatedAt as string | number),
    };
  }

  /**
   * Retrieve the current general settings.
   * Returns an all-null record if the singleton row has not been saved yet.
   */
  async getSettings(): Promise<GeneralSettingsRecord> {
    const rows = await this.db.select().from(this.siteSettings).limit(1);

    if (!rows || rows.length === 0) {
      return emptyRecord();
    }

    return this.toRecord(rows[0]);
  }

  /**
   * Get the configured IANA timezone identifier.
   * Reads from the singleton row each call so updates are reflected
   * consistently across long-lived runtime instances.
   */
  async getTimezone(): Promise<string | null> {
    const settings = await this.getSettings();
    return settings.timezone;
  }

  /**
   * The current preview-link revocation generation.
   *
   * Read on every mint and every verification, so a revoke reaches sessions
   * already in flight rather than only new links.
   */
  async getPreviewTokenGeneration(): Promise<number> {
    const settings = await this.getSettings();
    return settings.previewTokenGeneration;
  }

  /**
   * Invalidate every preview link ever issued, and return the new generation.
   *
   * The increment is computed by the DATABASE rather than read-then-written,
   * so two administrators revoking at once cannot both write the same value
   * and leave one of the two revocations undone.
   *
   * Creates the singleton row when it does not exist yet: an installation that
   * has never opened the settings form still has to be able to revoke, and
   * generation 1 correctly refuses tokens minted at the implicit 0.
   */
  async revokeAllPreviewTokens(): Promise<number> {
    const existing = await this.db.select().from(this.siteSettings).limit(1);

    if (!existing || existing.length === 0) {
      await this.db.insert(this.siteSettings).values({
        id: SETTINGS_ID,
        previewTokenGeneration: 1,
        updatedAt: new Date(),
      });
      return 1;
    }

    await this.db
      .update(this.siteSettings)
      .set({
        previewTokenGeneration: sql`${this.siteSettings.previewTokenGeneration} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(this.siteSettings.id, SETTINGS_ID));

    return this.getPreviewTokenGeneration();
  }

  /**
   * Upsert the general settings singleton row.
   * Only the provided fields are updated; omitted fields are left unchanged.
   * If the row doesn't exist yet, it is created with the provided values.
   */
  async updateSettings(
    data: Partial<GeneralSettingsUpdate>
  ): Promise<GeneralSettingsRecord> {
    const now = new Date();

    const existing = await this.db.select().from(this.siteSettings).limit(1);

    const hasRow = existing && existing.length > 0;

    if (hasRow) {
      // Build update payload — only include keys that were explicitly provided
      const updateData: Record<string, unknown> = { updatedAt: now };
      if ("applicationName" in data)
        updateData.applicationName = data.applicationName ?? null;
      if ("siteUrl" in data) updateData.siteUrl = data.siteUrl ?? null;
      if ("adminEmail" in data) updateData.adminEmail = data.adminEmail ?? null;
      if ("timezone" in data) updateData.timezone = data.timezone ?? null;
      if ("dateFormat" in data) updateData.dateFormat = data.dateFormat ?? null;
      if ("timeFormat" in data) updateData.timeFormat = data.timeFormat ?? null;
      if ("logoUrl" in data) updateData.logoUrl = data.logoUrl ?? null;
      if ("customSidebarGroups" in data)
        updateData.customSidebarGroups = data.customSidebarGroups ?? null;
      if ("pluginPlacements" in data)
        updateData.pluginPlacements = data.pluginPlacements ?? null;

      await this.db
        .update(this.siteSettings)
        .set(updateData)
        .where(eq(this.siteSettings.id, SETTINGS_ID));
    } else {
      await this.db.insert(this.siteSettings).values({
        id: SETTINGS_ID,
        applicationName: data.applicationName ?? null,
        siteUrl: data.siteUrl ?? null,
        adminEmail: data.adminEmail ?? null,
        timezone: data.timezone ?? null,
        dateFormat: data.dateFormat ?? null,
        timeFormat: data.timeFormat ?? null,
        logoUrl: data.logoUrl ?? null,
        customSidebarGroups: data.customSidebarGroups ?? null,
        pluginPlacements: data.pluginPlacements ?? null,
        updatedAt: now,
      });
    }

    return this.getSettings();
  }

  /**
   * Parse the stored JSON string into an array of custom sidebar groups.
   * Returns an empty array if no groups are stored or JSON is invalid.
   */
  getCustomSidebarGroups(
    settings: GeneralSettingsRecord
  ): CustomSidebarGroup[] {
    if (!settings.customSidebarGroups) return [];
    try {
      const parsed = JSON.parse(settings.customSidebarGroups);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Replace all custom sidebar groups with the provided array.
   * Persists as a JSON string in the `custom_sidebar_groups` column.
   */
  async updateCustomSidebarGroups(
    groups: CustomSidebarGroup[]
  ): Promise<CustomSidebarGroup[]> {
    const json = JSON.stringify(groups);
    await this.updateSettings({ customSidebarGroups: json });
    return groups;
  }
}
