/**
 * Tear down the localization artifacts an entity leaves behind when it is DELETED.
 *
 * Companion `_locales` tables are deliberately invisible to the schema pipeline: they match
 * the managed prefix but are excluded via `isCompanionTable`, and `filter-unsafe-statements`
 * discards their DROP silently, because the localization migration layer owns their
 * lifecycle. This helper is that layer's delete-path entry point, alongside
 * `buildLocalizationDownStatements` for the enable/disable transition.
 *
 * Two artifacts, two different disposal rules:
 *   - `<main>_locales` is per-entity, so it is DROPPED. It must go BEFORE the main table:
 *     it holds `FOREIGN KEY (_parent) REFERENCES <main>(id)`, and that FK blocks (MySQL) or
 *     silently orphans (Postgres CASCADE) a main-table drop attempted first.
 *   - `nextly_i18n_archive` is a SINGLE shared table scoped by a `collection` column holding
 *     the entity slug, so only the deleted entity's ROWS are removed. Dropping the table
 *     would destroy every other entity's restore trail.
 *
 * Both steps are existence-guarded. The archive is created lazily — only immediately before
 * a localization disable (`getI18nArchiveDdl` in the dispatchers) — so a database where
 * localization was never disabled legitimately has no archive table, and an unguarded
 * DELETE there would turn every entity delete into a hard failure.
 *
 * @module domains/i18n/migration/teardown-entity-i18n
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { eq } from "drizzle-orm";

import { nextlyI18nArchiveTables } from "../../../schemas/nextly-i18n-archive";

import { q } from "./ddl-types";

/** The shared archive table, scoped per entity by its `collection` column. */
const ARCHIVE_TABLE = "nextly_i18n_archive";

/** Minimal adapter surface this helper needs — matches DrizzleAdapter. */
export interface TeardownI18nAdapter {
  dialect: SupportedDialect;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  tableExists(tableName: string): Promise<boolean>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle's db type is dialect-specific
  getDrizzle(): any;
}

export interface TeardownEntityI18nArgs {
  adapter: TeardownI18nAdapter;
  /**
   * Entity slug exactly as the disable migration records it in `archive.collection`.
   *
   * `null` when the caller cannot establish the slug — a catalog sweep finds companion
   * tables whose registry row is already gone, and a slug cannot be recovered from the
   * table name because entities may declare a custom `tableName`. The companion is still
   * dropped; the archive purge is skipped, since guessing here would delete another
   * entity's translations and leave this one's behind.
   */
  slug: string | null;
  /**
   * Physical MAIN table of the entity being deleted, e.g. `dc_pages`, `comp_seo`,
   * `single_home`. The companion name is derived as `<tableName>_locales`, matching
   * `deriveCompanionSpec`.
   */
  tableName: string;
}

export interface TeardownEntityI18nResult {
  /** True when a companion table was found and dropped (false when the entity had none). */
  companionDropped: boolean;
  /** Archive rows removed for this slug (0 when the archive table does not exist). */
  archiveRowsPurged: number;
}

/**
 * Drops `<tableName>_locales` and purges the entity's `nextly_i18n_archive` rows.
 *
 * Call this BEFORE dropping the entity's main table. Errors propagate: callers drop the
 * main table and delete the registry row only after this resolves, so a failure here
 * surfaces with the entity still fully intact rather than half-deleted.
 */
export async function teardownEntityI18n(
  args: TeardownEntityI18nArgs
): Promise<TeardownEntityI18nResult> {
  const { adapter, slug, tableName } = args;
  const companionTable = `${tableName}_locales`;

  // Guarded so a non-localized entity (no companion was ever created) is a no-op rather
  // than relying on IF EXISTS semantics that differ across dialects.
  let companionDropped = false;
  if (await adapter.tableExists(companionTable)) {
    const quoted = q(companionTable, adapter.dialect);
    // Postgres needs CASCADE to also remove the FK constraint the companion owns; MySQL and
    // SQLite reject the keyword. IF EXISTS keeps the statement safe against a concurrent drop.
    const dropSql =
      adapter.dialect === "postgresql"
        ? `DROP TABLE IF EXISTS ${quoted} CASCADE`
        : `DROP TABLE IF EXISTS ${quoted}`;
    await adapter.executeQuery(dropSql);
    companionDropped = true;
  }

  // The archive table is created lazily on the first localization disable, so its absence is
  // the normal state for many databases and must not fail the delete. A null slug means the
  // caller could not identify the entity, and the archive is keyed by slug, so there is no
  // safe row set to delete.
  let archiveRowsPurged = 0;
  if (slug !== null && (await adapter.tableExists(ARCHIVE_TABLE))) {
    const db = adapter.getDrizzle();
    const { nextlyI18nArchive } = nextlyI18nArchiveTables(adapter.dialect);
    // Scoped to this slug only — the archive is shared, so an unscoped delete would wipe
    // every other entity's recoverable translations.
    const result = await db
      .delete(nextlyI18nArchive)
      .where(eq(nextlyI18nArchive.collection, slug));
    // Drivers disagree on the shape of a delete result; treat an unknown shape as 0 rather
    // than reporting a misleading count.
    archiveRowsPurged =
      typeof result?.rowsAffected === "number"
        ? result.rowsAffected
        : typeof result?.changes === "number"
          ? result.changes
          : typeof result?.rowCount === "number"
            ? result.rowCount
            : 0;
  }

  return { companionDropped, archiveRowsPurged };
}
