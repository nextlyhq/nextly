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

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { eq } from "drizzle-orm";

import { siteSettingsMysql } from "../../schemas/general-settings/mysql";
import { siteSettingsPg } from "../../schemas/general-settings/postgres";
import { siteSettingsSqlite } from "../../schemas/general-settings/sqlite";
import type {
  GeneralSettingsRecord,
  GeneralSettingsUpdate,
} from "../../schemas/general-settings/types";
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
        throw new Error(`Unsupported dialect: ${this.dialect}`);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (this.db as any)
      .select()
      .from(this.siteSettings)
      .limit(1);

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
   * Upsert the general settings singleton row.
   * Only the provided fields are updated; omitted fields are left unchanged.
   * If the row doesn't exist yet, it is created with the provided values.
   */
  async updateSettings(
    data: Partial<GeneralSettingsUpdate>
  ): Promise<GeneralSettingsRecord> {
    const now = new Date();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (this.db as any)
      .select()
      .from(this.siteSettings)
      .limit(1);

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db as any)
        .update(this.siteSettings)
        .set(updateData)
        .where(eq(this.siteSettings.id, SETTINGS_ID));
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db as any).insert(this.siteSettings).values({
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
