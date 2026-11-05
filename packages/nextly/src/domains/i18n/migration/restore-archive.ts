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

import {
  and,
  asc,
  count,
  eq,
  getTableName,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import {
  nextlyI18nArchiveTables,
  UNATTRIBUTED_ARCHIVE_KINDS,
} from "../../../schemas/nextly-i18n-archive";
import {
  UNKNOWN_ARCHIVE_KIND,
  UNRESOLVED_ARCHIVE_KIND,
} from "../../../schemas/nextly-i18n-archive/ddl";
import { toSnakeCase } from "../../schema/services/field-column-descriptor";
import { COMPANION_UPDATED_AT_COLUMN } from "../companion-columns";
import type { CompanionIntrospectAdapter } from "../runtime/companion-io";
import {
  companionHasColumn,
  upsertCompanionRow,
} from "../runtime/companion-io";

import { ensureI18nArchive } from "./ensure-archive";
import {
  labelLegacyArchiveRows,
  legacyLabelFor,
  ownedSince,
  type LabelArchiveAdapter,
} from "./label-legacy-archive-rows";
import type { I18nTransitionKind } from "./transition-state";

/**
 * The slice of Drizzle this helper drives: scoped SELECTs, an UPDATE and a DELETE. Declaring
 * only what is used keeps the dialect-specific database type out of the port, so no `any` is
 * needed — the same shape `teardown-entity-i18n` declares for its own single statement.
 */
interface ArchiveReadWriteDb {
  select(columns: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): Promise<unknown> & {
        orderBy(...columns: unknown[]): Promise<unknown>;
      };
    };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown>;
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
  adapter: CompanionIntrospectAdapter & LabelArchiveAdapter;
  /** Entity slug exactly as the disable migration recorded it in `archive.collection`. */
  collection: string;
  /**
   * Which kind of entity `collection` names. A field group's slug may equal a collection's or a
   * Single's, so only rows of this kind are read: another entity's values belong in another
   * companion.
   */
  kind: I18nTransitionKind;
  /**
   * Also restore this slug's rows whose owner is unknown, and record them as `kind`'s. Rows archived
   * before the archive recorded kinds are left unknown when the registries cannot say whose they
   * are, so only someone who names the kind can say; the command line passes it for `--kind`.
   */
  claimUnknown?: boolean;
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
  /**
   * `--dry-run`: read and check as a restore does, and write nothing: no
   * archive created or relabelled, no companion row, no claim and no purge.
   * The counts returned are what a restore would write.
   */
  dryRun?: boolean;
}

export interface RestoreArchiveResult {
  /** Archive rows matched (one per field/locale/entry). */
  rowsRead: number;
  /** Distinct `(entry, locale)` companion rows written. */
  rowsRestored: number;
  /** The languages actually restored, sorted. */
  locales: string[];
  /** Rows of unknown owner this restore took as its entity's (`claimUnknown`). */
  rowsClaimed: number;
  /**
   * Rows of this slug whose owner is still unknown afterwards. Kept, never deleted, so they are
   * reported for a restore that names the kind to claim them.
   */
  rowsUnattributed: number;
}

interface ArchiveRow {
  /** Autoincrement PK — used to bound the purge to only the rows read here. */
  id: number;
  entityKind: string;
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

/** A restore that found nothing archived. */
const NOTHING_RESTORED: RestoreArchiveResult = {
  rowsRead: 0,
  rowsRestored: 0,
  locales: [],
  rowsClaimed: 0,
  rowsUnattributed: 0,
};

/**
 * The rows of `collection` a restore reads, and how many of its rows are left without an owner,
 * as `ensureI18nArchive` and `labelLegacyArchiveRows` would leave the archive, read without
 * either: a row of unknown kind, or every row of an archive older than the kind, takes the kind
 * the labelling would give it (`legacyLabelFor`, `ownedSince`), and is unresolved otherwise.
 */
async function rowsAsLabelled(
  adapter: RestoreArchiveArgs["adapter"],
  db: ArchiveReadWriteDb,
  scope: {
    collection: string;
    kinds: readonly string[];
    locale?: string;
    field?: string;
  }
): Promise<{ rows: ArchiveRow[]; unattributed: number }> {
  const { nextlyI18nArchive: archive } = nextlyI18nArchiveTables(
    adapter.dialect
  );
  // An archive from before rows recorded their kind has no column for it yet.
  const hasKind = await companionHasColumn(
    adapter,
    getTableName(archive),
    archive.entityKind.name
  );
  const label = await legacyLabelFor(adapter, scope.collection);
  const owned =
    label === undefined
      ? sql<number>`0`
      : sql<number>`CASE WHEN ${ownedSince(adapter.dialect, archive.archivedAt, label.createdAt)} THEN 1 ELSE 0 END`;
  const read = (await db
    .select({
      id: archive.id,
      ...(hasKind ? { stored: archive.entityKind } : {}),
      entryId: archive.entryId,
      locale: archive.locale,
      field: archive.field,
      value: archive.value,
      owned,
    })
    .from(archive)
    .where(eq(archive.collection, scope.collection))
    .orderBy(asc(archive.id))) as (Omit<ArchiveRow, "entityKind"> & {
    stored?: string;
    owned: number | string | boolean;
  })[];

  // Each row's kind once labelled: the kind it has, unless it has none yet.
  const labelled: ArchiveRow[] = read.map(({ stored, owned: own, ...row }) => ({
    ...row,
    entityKind:
      stored !== undefined && stored !== UNKNOWN_ARCHIVE_KIND
        ? stored
        : label !== undefined && Number(own) === 1
          ? label.kind
          : UNRESOLVED_ARCHIVE_KIND,
  }));
  const isUnattributed = (row: ArchiveRow) =>
    (UNATTRIBUTED_ARCHIVE_KINDS as readonly string[]).includes(row.entityKind);
  return {
    rows: labelled.filter(
      row =>
        scope.kinds.includes(row.entityKind) &&
        (scope.locale === undefined || row.locale === scope.locale) &&
        (scope.field === undefined || row.field === scope.field)
    ),
    unattributed: labelled.filter(isUnattributed).length,
  };
}

/** Whether the archive table exists, asked without creating it. */
async function archiveExists(
  adapter: RestoreArchiveArgs["adapter"]
): Promise<boolean> {
  const { nextlyI18nArchive } = nextlyI18nArchiveTables(adapter.dialect);
  return (await adapter.listTables()).includes(getTableName(nextlyI18nArchive));
}

export async function restoreI18nArchive(
  args: RestoreArchiveArgs
): Promise<RestoreArchiveResult> {
  const { adapter, collection, kind, companionTableName, locale } = args;
  // The archive keeps a field's values under its column name. The conversion is the column
  // descriptor's, and a column name passes through it unchanged.
  const field = args.field !== undefined ? toSnakeCase(args.field) : undefined;
  // An archive from before rows recorded their kind is brought up to date first, and its rows
  // given their owner's kind where the registries can tell; one never written is created empty.
  // A dry run makes neither: an archive never written has nothing to restore.
  if (args.dryRun === true) {
    if (!(await archiveExists(adapter))) return NOTHING_RESTORED;
  } else {
    await ensureI18nArchive(adapter, adapter.dialect);
    await labelLegacyArchiveRows(adapter);
  }
  const db = adapter.getDrizzle<ArchiveReadWriteDb>();
  const { nextlyI18nArchive } = nextlyI18nArchiveTables(adapter.dialect);

  const scope = (kinds: readonly string[]) =>
    and(
      eq(nextlyI18nArchive.collection, collection),
      inArray(nextlyI18nArchive.entityKind, [...kinds]),
      ...(locale !== undefined ? [eq(nextlyI18nArchive.locale, locale)] : []),
      ...(field !== undefined ? [eq(nextlyI18nArchive.field, field)] : [])
    );
  const kinds = args.claimUnknown
    ? [kind, ...UNATTRIBUTED_ARCHIVE_KINDS]
    : [kind];
  const where = scope(kinds);
  const unattributed = async (): Promise<number> => {
    const [row] = (await db
      .select({ n: count() })
      .from(nextlyI18nArchive)
      .where(
        and(
          eq(nextlyI18nArchive.collection, collection),
          inArray(nextlyI18nArchive.entityKind, [...UNATTRIBUTED_ARCHIVE_KINDS])
        )
      )) as { n: number | string }[];
    return Number(row?.n ?? 0);
  };

  // A dry run reads the archive as the upgrade and labelling above would leave it, without
  // either: an older archive may have no kind column yet, and its rows no kind.
  const planned =
    args.dryRun === true
      ? await rowsAsLabelled(adapter, db, { collection, kinds, locale, field })
      : undefined;
  const rows =
    planned?.rows ??
    (await archivedRowsOldestFirst(db, nextlyI18nArchive, where));
  const unattributedNow = async () =>
    planned?.unattributed ?? (await unattributed());

  if (rows.length === 0) {
    return restoreCounts([], 0, 0, await unattributedNow());
  }

  await refuseFieldsNotTranslatedNow(
    adapter,
    collection,
    companionTableName,
    rows.map(r => r.field)
  );

  const grouped = byEntryAndLocale(rows);

  const rowsClaimed = rows.filter(r =>
    (UNATTRIBUTED_ARCHIVE_KINDS as readonly string[]).includes(r.entityKind)
  ).length;
  // What a restore writes, counted and not written.
  if (args.dryRun === true) {
    return restoreCounts(
      rows,
      grouped.size,
      rowsClaimed,
      await unattributedNow()
    );
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

  // Bounded to the rows read here, for the reason the purge below gives.
  const maxId = rows.reduce((max, r) => (r.id > max ? r.id : max), rows[0].id);
  if (rowsClaimed > 0) {
    // Recorded only once their values are back, so a restore refused above claims nothing.
    await db
      .update(nextlyI18nArchive)
      .set({ entityKind: kind })
      .where(
        and(scope(UNATTRIBUTED_ARCHIVE_KINDS), lte(nextlyI18nArchive.id, maxId))
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
    await db
      .delete(nextlyI18nArchive)
      .where(and(where, lte(nextlyI18nArchive.id, maxId)));
  }

  return restoreCounts(rows, grouped.size, rowsClaimed, await unattributed());
}

/** The archive table as its dialect's schema declares it. */
type ArchiveTable = ReturnType<
  typeof nextlyI18nArchiveTables
>["nextlyI18nArchive"];

/**
 * The archived rows `where` selects, oldest first, so that when a value was archived more than
 * once (a field made shared, translated again, then made shared again) the newest row is the one
 * assigned last when grouped and is what comes back. The id is the database's own insertion order
 * on every dialect.
 */
async function archivedRowsOldestFirst(
  db: ArchiveReadWriteDb,
  nextlyI18nArchive: ArchiveTable,
  where: SQL | undefined
): Promise<ArchiveRow[]> {
  return (await db
    .select({
      id: nextlyI18nArchive.id,
      entityKind: nextlyI18nArchive.entityKind,
      entryId: nextlyI18nArchive.entryId,
      locale: nextlyI18nArchive.locale,
      field: nextlyI18nArchive.field,
      value: nextlyI18nArchive.value,
    })
    .from(nextlyI18nArchive)
    .where(where)
    .orderBy(asc(nextlyI18nArchive.id))) as ArchiveRow[];
}

/**
 * The per-field archive rows collapsed back into one companion row per (entry, locale), so each
 * language is written in a single upsert rather than once per field. A later row's value for a
 * field replaces an earlier one's.
 */
function byEntryAndLocale(
  rows: readonly ArchiveRow[]
): Map<
  string,
  { entryId: string; locale: string; data: Record<string, unknown> }
> {
  const grouped = new Map<
    string,
    { entryId: string; locale: string; data: Record<string, unknown> }
  >();
  for (const r of rows) {
    const key = `${r.entryId}::${r.locale}`;
    const g = grouped.get(key) ?? {
      entryId: r.entryId,
      locale: r.locale,
      data: {},
    };
    grouped.set(key, g);
    g.data[r.field] = r.value;
  }
  return grouped;
}

/** What a restore reports: the rows it read, the companion rows they make, and the claims. */
function restoreCounts(
  rows: readonly ArchiveRow[],
  rowsRestored: number,
  rowsClaimed: number,
  rowsUnattributed: number
): RestoreArchiveResult {
  return {
    rowsRead: rows.length,
    rowsRestored,
    locales: [...new Set(rows.map(r => r.locale))].sort(),
    rowsClaimed,
    rowsUnattributed,
  };
}
