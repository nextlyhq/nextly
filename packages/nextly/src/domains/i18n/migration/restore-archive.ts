/**
 * Replay archived translations out of `nextly_i18n_archive` and back into a companion
 * `_locales` table (design §5.3 / roadmap M1: "a restore command/helper that replays archive
 * rows").
 *
 * Disabling localization is the one data-losing transition, so its migration restores the
 * default locale onto the main table and archives every OTHER language into
 * `nextly_i18n_archive` before dropping the companion. That makes a mistaken disable
 * recoverable — but only if something can replay the archive. This is that half.
 *
 * Intended flow when a disable was a mistake:
 *   1. Re-enable localization on the entity and run `migrate` — the enable migration recreates
 *      the companion and seeds the DEFAULT locale from the main table.
 *   2. Call this helper — it replays the archived NON-default translations back onto the
 *      companion rows, restoring the languages the disable removed.
 *
 * Idempotent: replaying twice upserts the same `(parent, locale)` rows to the same values.
 *
 * @module domains/i18n/migration/restore-archive
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq } from "drizzle-orm";

import { nextlyI18nArchiveTables } from "../../../schemas/nextly-i18n-archive";
import { upsertCompanionRow } from "../runtime/companion-io";

/** Minimal adapter surface this helper needs — matches DrizzleAdapter. */
export interface RestoreArchiveAdapter {
  dialect: SupportedDialect;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle's db type is dialect-specific
  getDrizzle(): any;
}

export interface RestoreArchiveArgs {
  adapter: RestoreArchiveAdapter;
  /** Entity slug exactly as the disable migration recorded it in `archive.collection`. */
  collection: string;
  /** Physical companion table to replay into, e.g. `dc_pages_locales`. */
  companionTableName: string;
  /** Restrict the replay to one language. Omit to restore every archived language. */
  locale?: string;
  /**
   * Delete the replayed rows from the archive once they are written. Default `false` — the
   * archive is kept so a restore can be re-run and so the audit trail survives. Callers that
   * want the spec's retention behavior opt in.
   */
  purge?: boolean;
}

export interface RestoreArchiveResult {
  /** Archive rows matched (one per field/locale/entry). */
  rowsRead: number;
  /** Distinct `(entry, locale)` companion rows written. */
  rowsRestored: number;
  /** The languages actually restored, sorted. */
  locales: string[];
}

interface ArchiveRow {
  entryId: string;
  locale: string;
  field: string;
  value: string | null;
}

/**
 * Replay `nextly_i18n_archive` rows for `collection` back into its companion table.
 *
 * Reads through Drizzle and writes through the shared {@link upsertCompanionRow} seam, so the
 * per-locale row shape (composite `(_parent, _locale)` PK, partial column writes) matches
 * exactly what the normal write path produces.
 *
 * Note: the archive stores every value as TEXT (the disable migration casts on the way in). For
 * the text-like fields that localize by default this round-trips exactly; a non-text localized
 * column is handed back to the driver as a string and relies on the parameter being coerced to
 * the target column type.
 */
export async function restoreI18nArchive(
  args: RestoreArchiveArgs
): Promise<RestoreArchiveResult> {
  const { adapter, collection, companionTableName, locale } = args;
  const db = adapter.getDrizzle();
  const { nextlyI18nArchive } = nextlyI18nArchiveTables(adapter.dialect);

  const where = locale
    ? and(
        eq(nextlyI18nArchive.collection, collection),
        eq(nextlyI18nArchive.locale, locale)
      )
    : eq(nextlyI18nArchive.collection, collection);

  const rows = (await db
    .select({
      entryId: nextlyI18nArchive.entryId,
      locale: nextlyI18nArchive.locale,
      field: nextlyI18nArchive.field,
      value: nextlyI18nArchive.value,
    })
    .from(nextlyI18nArchive)
    .where(where)) as ArchiveRow[];

  if (rows.length === 0) {
    return { rowsRead: 0, rowsRestored: 0, locales: [] };
  }

  // Collapse the per-field archive rows back into one companion row per (entry, locale) so each
  // language is written in a single upsert rather than once per field.
  const grouped = new Map<
    string,
    { entryId: string; locale: string; data: Record<string, unknown> }
  >();
  for (const r of rows) {
    const key = `${r.entryId}::${r.locale}`;
    let g = grouped.get(key);
    if (!g) {
      g = { entryId: r.entryId, locale: r.locale, data: {} };
      grouped.set(key, g);
    }
    g.data[r.field] = r.value;
  }

  for (const g of grouped.values()) {
    await upsertCompanionRow(
      adapter,
      companionTableName,
      g.entryId,
      g.locale,
      g.data
    );
  }

  if (args.purge) {
    // Purge exactly the rows that were just read and restored. `where` already scopes to
    // this collection (and locale when given), so every archived row it matched has been
    // replayed — reuse it directly. An `inArray` over every entry id would instead risk the
    // SQL bind-parameter cap (SQLite defaults to 999) on a large collection.
    await db.delete(nextlyI18nArchive).where(where);
  }

  return {
    rowsRead: rows.length,
    rowsRestored: grouped.size,
    locales: [...new Set(rows.map(r => r.locale))].sort(),
  };
}
