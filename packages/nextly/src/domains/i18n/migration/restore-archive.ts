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

import { and, asc, eq, lte } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import { nextlyI18nArchiveTables } from "../../../schemas/nextly-i18n-archive";
import { toSnakeCase } from "../../schema/services/field-column-descriptor";
import { COMPANION_UPDATED_AT_COLUMN } from "../companion-columns";
import type { CompanionIntrospectAdapter } from "../runtime/companion-io";
import {
  companionHasColumn,
  upsertCompanionRow,
} from "../runtime/companion-io";

import { ensureI18nArchive } from "./ensure-archive";
import type { I18nTransitionKind } from "./transition-state";

/**
 * The slice of Drizzle this helper drives: one scoped SELECT and one scoped DELETE. Declaring
 * only what is used keeps the dialect-specific database type out of the port, so no `any` is
 * needed — the same shape `teardown-entity-i18n` declares for its own single statement.
 */
interface ArchiveReadWriteDb {
  select(columns: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        orderBy(...columns: unknown[]): Promise<unknown>;
      };
    };
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
  /**
   * Which kind of entity `collection` names. A field group's slug may equal a collection's or a
   * Single's, so only rows of this kind are read: another entity's values belong in another
   * companion.
   */
  kind: I18nTransitionKind;
  /** Physical companion table to replay into, e.g. `dc_pages_locales`. */
  companionTableName: string;
  /** Restrict the replay to one language. Omit to restore every archived language. */
  locale?: string;
  /**
   * Restrict the replay to one field's archived values, by its name (`subTitle`) or its column
   * name (`sub_title`). A field archived when it stopped being translated is restored this way
   * once it is translated again.
   */
  field?: string;
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
/**
 * Every archived field needs a translated column to come back to. One the entity no longer
 * translates has none, and replaying it would fail part-way, after other languages had already
 * been written; so the replay is refused before it starts, naming the fields.
 */
async function refuseFieldsNotTranslatedNow(
  adapter: RestoreArchiveArgs["adapter"],
  collection: string,
  companionTableName: string,
  archivedFields: readonly string[]
): Promise<void> {
  const missing: string[] = [];
  for (const name of new Set(archivedFields)) {
    if (!(await companionHasColumn(adapter, companionTableName, name))) {
      missing.push(name);
    }
  }
  if (missing.length === 0) return;
  const one = missing.length === 1;
  throw NextlyError.conflict({
    reason: "state",
    message:
      `${missing.map(name => `"${name}"`).join(", ")} ${one ? "is" : "are"} not translated now, ` +
      `so the archived values have nowhere to go. Make ${one ? "it" : "them"} translated again, then restore.`,
    logContext: { collection, companionTableName, missing },
  });
}

export async function restoreI18nArchive(
  args: RestoreArchiveArgs
): Promise<RestoreArchiveResult> {
  const { adapter, collection, kind, companionTableName, locale } = args;
  // The archive keeps a field's values under its column name. The conversion is the column
  // descriptor's, and a column name passes through it unchanged.
  const field = args.field !== undefined ? toSnakeCase(args.field) : undefined;
  // An archive from before rows recorded their kind is brought up to date first, which reads its
  // rows as the collections they were; one that was never written is created empty.
  await ensureI18nArchive(adapter, adapter.dialect);
  const db = adapter.getDrizzle<ArchiveReadWriteDb>();
  const { nextlyI18nArchive } = nextlyI18nArchiveTables(adapter.dialect);

  const where = and(
    eq(nextlyI18nArchive.collection, collection),
    eq(nextlyI18nArchive.entityKind, kind),
    ...(locale !== undefined ? [eq(nextlyI18nArchive.locale, locale)] : []),
    ...(field !== undefined ? [eq(nextlyI18nArchive.field, field)] : [])
  );

  const rows = (await db
    .select({
      id: nextlyI18nArchive.id,
      entryId: nextlyI18nArchive.entryId,
      locale: nextlyI18nArchive.locale,
      field: nextlyI18nArchive.field,
      value: nextlyI18nArchive.value,
    })
    .from(nextlyI18nArchive)
    .where(where)
    // Oldest first, so that when a value was archived more than once (a field made shared,
    // translated again, then made shared again) the newest row is the one assigned last below
    // and is what comes back. The id is the database's own insertion order on every dialect.
    .orderBy(asc(nextlyI18nArchive.id))) as ArchiveRow[];

  if (rows.length === 0) {
    return { rowsRead: 0, rowsRestored: 0, locales: [] };
  }

  await refuseFieldsNotTranslatedNow(
    adapter,
    collection,
    companionTableName,
    rows.map(r => r.field)
  );

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
      // 🔴 Replay must not date these translations to the moment they were restored.
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
