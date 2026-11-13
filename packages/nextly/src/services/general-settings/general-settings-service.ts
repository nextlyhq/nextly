/**
 * General Settings Service
 *
 * Manages the `site_settings` singleton row — a single record
 * (id = 'default') that stores application-level configuration:
 * application name, site URL, admin email, timezone, and display formats.
 *
 * The row is followed rather than read on every use
 * (`shared/lib/followed-value`): one admin screen asks for it a dozen times or
 * more (every JSON answer reads the timezone, the admin's branding reads the
 * name and logo), and it is the same row for every reader. So this process
 * reads it at most once per {@link GENERAL_SETTINGS_READ_INTERVAL_MS}, shares
 * a read under way with every caller that arrives meanwhile, and reads it
 * again at once after a write made here. A change saved through another
 * instance is seen here within the interval.
 *
 * A decision that guards access reads the row itself instead
 * (`getSettings({ fresh: true })`): preview-link revocation and where a
 * preview link sends its holder must reflect a change made elsewhere a moment
 * ago, so those reads never answer with a kept copy.
 *
 * @module services/general-settings/general-settings-service
 * @since 1.0.0
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { eq, sql } from "drizzle-orm";

import { loadedDialect } from "../../database/dialect-tables";
import { flushContentChange } from "../../domains/flush-content-change";
import { nextlySiteSettingsTags } from "../../runtime/cache/nextly-tags";
import type {
  GeneralSettingsRecord,
  GeneralSettingsUpdate,
} from "../../schemas/site-settings/types";
import {
  followedState,
  followValue,
  markFollowedChanged,
  type FollowedState,
} from "../../shared/lib/followed-value";
import { BaseService } from "../base-service";
import type { Logger } from "../shared";

const SETTINGS_ID = "default";

/**
 * How long one read of the settings row is reused by this process: the bound
 * on how long a change saved through another instance goes unseen here. The
 * same bound the registry follows (`SCHEMA_VERSION_READ_INTERVAL_MS`).
 */
export const GENERAL_SETTINGS_READ_INTERVAL_MS = 2000;

/** This process's reads of each database's settings row. */
function settingsState(): FollowedState<GeneralSettingsRecord> {
  return followedState<GeneralSettingsRecord>("__nextly_generalSettings");
}

/**
 * A copy of a kept record for one caller, so a caller that changes what it
 * was handed changes nothing another caller is handed.
 */
function copyOf(record: GeneralSettingsRecord): GeneralSettingsRecord {
  return { ...record, updatedAt: new Date(record.updatedAt.getTime()) };
}

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
      case "mysql":
      case "sqlite":
        // The loaded dialect's own table, so only that dialect's file is
        // imported; `createAdapter` loads it.
        this.siteSettings = loadedDialect(this.dialect).tables.siteSettings;
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
   *
   * As this process last read them, within
   * {@link GENERAL_SETTINGS_READ_INTERVAL_MS}, and at once after a write
   * made here. `fresh` reads the row now, sharing no read begun before this
   * call: for a decision that guards access, which must reflect a change
   * another instance made a moment ago. What a fresh read finds is kept for
   * every later caller too.
   *
   * A read that fails rejects every caller that shared it and is not kept,
   * so the next caller reads again.
   */
  async getSettings(
    options: { fresh?: boolean } = {}
  ): Promise<GeneralSettingsRecord> {
    const record = await followValue(
      settingsState(),
      this.adapter,
      () => this.readSettings(),
      {
        intervalMs: GENERAL_SETTINGS_READ_INTERVAL_MS,
        ...(options.fresh === true ? { alone: true } : {}),
      }
    );
    return copyOf(record ?? emptyRecord());
  }

  /** One read of the singleton row. */
  private async readSettings(): Promise<GeneralSettingsRecord> {
    const rows = await this.db.select().from(this.siteSettings).limit(1);

    if (!rows || rows.length === 0) {
      return emptyRecord();
    }

    return this.toRecord(rows[0]);
  }

  /**
   * Get the configured IANA timezone identifier, as {@link getSettings}
   * last read it: a timezone saved through another instance renders here
   * within {@link GENERAL_SETTINGS_READ_INTERVAL_MS}.
   */
  async getTimezone(): Promise<string | null> {
    const settings = await this.getSettings();
    return settings.timezone;
  }

  /**
   * The current preview-link revocation generation.
   *
   * Read from the row on every mint and every verification, never from a
   * kept copy, so a revoke made through any instance reaches sessions already
   * in flight at once rather than only new links.
   */
  async getPreviewTokenGeneration(): Promise<number> {
    const settings = await this.getSettings({ fresh: true });
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
    try {
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
    } finally {
      // Whatever the write did, the copy read before it is not trusted.
      markFollowedChanged(settingsState());
    }

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

    try {
      await this.writeSettings(data, now);
    } finally {
      // Read again by the next caller here, so it answers with this write.
      markFollowedChanged(settingsState());
    }

    // Pages that show the site's name, address, logo or time zone are cached
    // under the settings tag, so every saved change expires it. Best-effort:
    // the write is committed, so a cache failure is logged, never thrown.
    await flushContentChange(
      { tags: nextlySiteSettingsTags() },
      this.logger,
      "a site settings write"
    );

    return this.getSettings();
  }

  /** The update or insert {@link updateSettings} makes. */
  private async writeSettings(
    data: Partial<GeneralSettingsUpdate>,
    now: Date
  ): Promise<void> {
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
