/**
 * Replay archived translations out of `nextly_i18n_archive` and back into a companion
 * `_locales` table.
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

import { and, eq, lte } from "drizzle-orm";

import { nextlyI18nArchiveTables } from "../../../schemas/nextly-i18n-archive";
import { COMPANION_UPDATED_AT_COLUMN } from "../companion-columns";
import type { CompanionIntrospectAdapter } from "../runtime/companion-io";
import {
  companionHasColumn,
  upsertCompanionRow,
} from "../runtime/companion-io";

/**
 * The slice of Drizzle this helper drives: one scoped SELECT and one scoped DELETE. Declaring
 * only what is used keeps the dialect-specific database type out of the port, so no `any` is
 * needed — the same shape `teardown-entity-i18n` declares for its own single statement.
 */
interface ArchiveReadWriteDb {
  select(columns: Record<string, unknown>): {
    from(table: unknown): { where(condition: unknown): Promise<unknown> };
  };
  delete(table: unknown): { where(condition: unknown): Promise<unknown> };
}

export interface RestoreArchiveArgs {
  /**
   * The connection to replay through. This helper both writes companion rows and asks the
   * database for the companion's physical shape, which is the introspecting surface rather than
   * the narrower write-only one.
   */
  adapter: CompanionIntrospectAdapter;
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
  /** Autoincrement PK — used to bound the purge to only the rows read here. */
  id: number;
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
  const db = adapter.getDrizzle<ArchiveReadWriteDb>();
  const { nextlyI18nArchive } = nextlyI18nArchiveTables(adapter.dialect);

  const where = locale
    ? and(
        eq(nextlyI18nArchive.collection, collection),
        eq(nextlyI18nArchive.locale, locale)
      )
    : eq(nextlyI18nArchive.collection, collection);

  const rows = (await db
    .select({
      id: nextlyI18nArchive.id,
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

  // 🔴 Probed ONCE before the loop, because `"clear"` NAMES the column and a companion that
  // predates it would fail the whole restore before a single archived value landed. That is a
  // regression the chronology fix introduced: the previous mode omitted the column, so it
  // tolerated a legacy companion by accident. Registry-owned companions have no transition that
  // adds the column, so this state is reachable rather than theoretical.
  //
  // A probe rather than a catch-and-retry: a failed statement marks a PostgreSQL transaction
  // aborted, and asking once outside the loop costs one plan-only query instead of one failure
  // per locale.
  const canClearStamp = await companionHasColumn(
    adapter,
    companionTableName,
    COMPANION_UPDATED_AT_COLUMN
  );

  for (const g of grouped.values()) {
    await upsertCompanionRow(
      adapter,
      companionTableName,
      g.entryId,
      g.locale,
      g.data,
      undefined,
      // 🔴 Replay must not date these translations to the moment they were restored (i18n B2).
      // The archive stores per-FIELD rows -- `field` and `value` -- so it never held the original
      // `_updated_at` and there is nothing to put back. Stamping would fabricate a chronology:
      // source content edited after re-enabling but before the replay would look OLDER than the
      // archived translation, and a genuinely stale target would be reported current.
      //
      // "clear" rather than "omit", and the difference is the whole correctness of this line. A
      // locale may ALREADY have a row -- someone translates it after localization is re-enabled
      // but before `i18n:restore` runs -- and the conflict clause updates only the columns named.
      // Omitting the stamp would leave that recent value standing while this statement replaces
      // the content beneath it with older archived text, so the restored translation would read
      // as current. Writing NULL says what is true: unknown.
      { updatedAt: canClearStamp ? "clear" : "omit" }
    );
  }

  if (args.purge) {
    // Purge exactly the rows that were just read and restored, and no others.
    // Bound the delete to `id <= maxId` (the largest PK seen in the read): the
    // autoincrement PK means any archive row inserted concurrently AFTER this read
    // gets a higher id, so it is excluded and survives the purge — closing the
    // read-then-delete race where a fresh archive write could be deleted without
    // ever being restored. `where` still scopes to this collection (and locale when
    // given). Bounding by a single scalar also avoids the SQL bind-parameter cap
    // (SQLite defaults to 999) that an `inArray` over every entry id would risk.
    const maxId = rows.reduce(
      (max, r) => (r.id > max ? r.id : max),
      rows[0].id
    );
    await db
      .delete(nextlyI18nArchive)
      .where(and(where, lte(nextlyI18nArchive.id, maxId)));
  }

  return {
    rowsRead: rows.length,
    rowsRestored: grouped.size,
    locales: [...new Set(rows.map(r => r.locale))].sort(),
  };
}
