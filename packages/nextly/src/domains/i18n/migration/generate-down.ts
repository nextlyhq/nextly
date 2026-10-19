import { NextlyError } from "../../../errors/nextly-error";

import {
  castText,
  ddlType,
  exactText,
  lit,
  nullSafeDiffers,
  q,
} from "./ddl-types";
import type {
  ArchiveOwner,
  CompanionCopyRef,
  CompanionMigrationSpec,
} from "./types";

const ARCHIVE = "nextly_i18n_archive";

/**
 * DOWN migration for DISABLING localization (guarded, recoverable):
 *   1. Re-add the columns to the main table (nullable)
 *   2. Restore the default-locale value back onto the main table
 *   3. Archive every NON-default-locale value into `nextly_i18n_archive`
 *      (id is DB-generated, so the INSERT ... SELECT omits it)
 *   4. DROP the companion table
 */
export function buildLocalizationDownSql(spec: CompanionMigrationSpec): string {
  return buildLocalizationDownStatements(spec)
    .map(s => `${s};`)
    .join("\n\n");
}

/**
 * Statement-array form of {@link buildLocalizationDownSql} (no trailing `;` per element). The
 * runtime disable path (a Builder-entity localization toggle, which has no migration file) runs
 * these individually via the adapter after ensuring `nextly_i18n_archive` exists.
 */
/** Options for {@link buildLocalizationDownStatements}. */
export interface LocalizationDownOptions {
  /**
   * Localized columns the main table ALREADY carries, which must not be re-added.
   *
   * Unattended provisioning can seed a companion without dropping the columns it copied from, so
   * disabling later meets a main table that still has them. `ALTER TABLE ADD COLUMN` is not
   * idempotent on any supported dialect, so re-adding one fails the whole disable.
   *
   * They are still RESTORED. Their presence says only that a column exists, never that its value
   * is current: every localized write since the transition went to the companion alone, so a
   * retained column holds whatever it held before the entity was localized. Treating it as an
   * already-completed restore is what silently reverts content to its pre-localization state.
   */
  existingMainColumns?: readonly string[];
  /**
   * Whether to carry the restored row's publishing state back onto main.
   *
   * A verdict about the PHYSICAL tables, supplied by the caller, never derived from the spec.
   * `spec.status` describes the shape the collection is being saved as, and a save that disables
   * localization while turning Draft/Published on would have this read a `_status` the old
   * companion never had — into a `status` the main table has not been given yet, because a disable
   * deliberately runs the companion transition before the shared ALTER that adds it.
   *
   * When it IS there on both sides it has to travel: publishing is per locale while an entity is
   * localized, and this path drops the companion straight after restoring, so content moved
   * without the state it was published under cannot be corrected afterwards.
   */
  restoreStatus?: boolean;
}

/**
 * Copy the default locale's companion values back onto the main row — one correlated UPDATE
 * covering every column in `columnNames`.
 *
 * Shared rather than inlined because two paths owe the same copy for different reasons. A disable
 * migration restores before it drops the companion. Unattended provisioning restores when an
 * entity's config stops being localized, and must not drop anything — but the values it moves and
 * the direction it moves them in are identical, and two builders would drift.
 *
 * The default locale is a PREFERENCE, not a filter, and here that matters more than it does at
 * runtime. This statement runs inside a disable migration that archives the other languages and
 * then DROPS the companion, so a parent skipped by a default-only restore keeps whatever main held
 * before it was ever localized while its actual content leaves with the table. Ranking the parent's
 * rows — the default first, then deterministically by locale — brings every entry back from the row
 * it has.
 *
 * `WHERE EXISTS` still matters, now on the parent rather than the locale. Without it a row with no
 * companion row at all — one created after the transition, say — assigns SQL NULL, so restoring
 * would blank a main column nothing ever translated. There is nothing to restore for such a row,
 * and nothing is what it should get.
 *
 * ONE statement covering every column, not one per column. An entity with several translatable
 * fields would otherwise be restorable half-way: an `UPDATE` failing after earlier ones committed
 * leaves main carrying some restored values and some pre-localization ones, with no record that a
 * restore was even attempted. The application then serves that mixture and accepts edits on it, and
 * the next pass repeats every column from the now-stale companion, overwriting them. A single
 * statement cannot land partially, so the restore either happened or it did not.
 *
 * Returned as an array with at most one element, because the callers run a statement list and the
 * empty case (nothing to restore) has to stay expressible.
 */
export function buildDefaultLocaleRestoreStatements(
  spec: CompanionCopyRef,
  columnNames: readonly string[],
  options: { restoreStatus?: boolean } = {}
): string[] {
  if (columnNames.length === 0 && options.restoreStatus !== true) return [];
  const { dialect, mainTable, companionTable } = spec;
  const comp = q(companionTable, dialect);
  const main = q(mainTable, dialect);
  const parent = `${comp}.${q("_parent", dialect)} = ${main}.${q("id", dialect)}`;
  const fromChosenRow = (target: string, source: string) =>
    `${target} = ${restoredValue(spec, source)}`;
  const assignments = [
    ...columnNames.map(name => {
      const col = q(name, dialect);
      return fromChosenRow(col, col);
    }),
    // The publishing state of the row the values came from, carried across with them. While an
    // entity is localized, publishing is per locale: a publish under a non-default locale updates
    // that companion row and deliberately leaves main alone. Restoring the content without the
    // state it was published under makes a draft public or makes live content vanish — and on this
    // path the companion is dropped immediately afterwards, so nothing is left to correct it from.
    ...(options.restoreStatus === true
      ? [fromChosenRow(q("status", dialect), q("_status", dialect))]
      : []),
  ].join(", ");
  return [
    `UPDATE ${main} SET ${assignments} ` +
      `WHERE EXISTS (SELECT 1 FROM ${comp} WHERE ${parent})`,
  ];
}

/**
 * The value a main row takes from the companion's `source` expression when it is restored: from
 * the row in the default language, else the parent's first row by language code. One row per
 * parent, chosen by rank, so every column read this way reads from the SAME row and a parent whose
 * preferred translation leaves one field empty cannot take that field from another language.
 *
 * A correlated subquery over `spec.mainTable`, for the restore above and for a precondition that
 * has to judge the values the restore will write before it runs.
 */
export function restoredValue(spec: CompanionCopyRef, source: string): string {
  const { dialect, mainTable, companionTable, defaultLocale } = spec;
  const comp = q(companionTable, dialect);
  const parent = `${comp}.${q("_parent", dialect)} = ${q(mainTable, dialect)}.${q("id", dialect)}`;
  return (
    `(SELECT ${source} FROM ${comp} WHERE ${parent} ` +
    `ORDER BY (${comp}.${q("_locale", dialect)} = ${lit(defaultLocale)}) DESC, ` +
    `${comp}.${q("_locale", dialect)} ASC LIMIT 1)`
  );
}

/**
 * The type to give a main-table column that is about to be filled FROM the companion.
 *
 * Wider than the shared renderer on purpose, and only here. This statement is followed immediately
 * by a copy out of the companion column, so the target has to hold whatever that column can hold —
 * and on a MySQL installation created before the renderer emitted TEXT, a `longText` companion
 * column is physically LONGTEXT. Re-adding TEXT and copying into it truncates a default-locale
 * value past 65 535 characters, silently on a non-strict server.
 *
 * These statements are written into a migration file with no database to introspect, so the target
 * cannot be read from the live column; sizing it to the widest the source could be is what makes
 * the restore safe without one. The cost is a main column wider than a freshly created one would
 * be, which the next schema sync reports as an ordinary type change — visible and recoverable,
 * unlike the truncation it replaces.
 */
function restoreTargetType(
  column: Parameters<typeof ddlType>[0],
  dialect: Parameters<typeof ddlType>[1]
): string {
  if (dialect === "mysql" && column.kind === "longText") return "LONGTEXT";
  return ddlType(column, dialect);
}

/**
 * Copies every non-default language's value of one companion column into the localization
 * archive, where `nextly i18n:restore` reads it back. One row per (entry, language), the value
 * cast to text, recorded under the entity's slug and kind and the column's name.
 *
 * Safe to run more than once: a value is written only when it differs from the newest row already
 * archived for that entry, language and field. A second run of the same change adds nothing, while
 * a value that changed since it was last archived is archived again, and a restore takes the newest
 * row. A value with nothing archived before and nothing to keep (NULL) is not written.
 */
/**
 * The owner an archive row is recorded under. A statement that archives without knowing the
 * entity's kind would file the values where another entity of the same slug reads them, so it is
 * refused rather than given a default.
 */
export function archiveOwnerOf(
  slug: string,
  kind: ArchiveOwner["kind"] | undefined
): ArchiveOwner {
  if (kind === undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: "an archive write needs the entity's kind as well as its slug",
        slug,
      },
    });
  }
  return { slug, kind };
}

function buildArchiveNonDefaultStatement(
  ref: Pick<CompanionCopyRef, "dialect" | "companionTable" | "defaultLocale">,
  owner: ArchiveOwner,
  columnName: string
): string {
  const { dialect, companionTable, defaultLocale } = ref;
  const source = q("source", dialect);
  const archived = q("archived", dialect);
  const value = castText(`${source}.${q(columnName, dialect)}`, dialect);
  // The value archived last for this entry, language and field, or NULL when there is none.
  const newest =
    `(SELECT ${archived}.${q("value", dialect)} FROM ${q(ARCHIVE, dialect)} ${archived} ` +
    `WHERE ${archived}.${q("collection", dialect)} = ${lit(owner.slug)} ` +
    `AND ${archived}.${q("entity_kind", dialect)} = ${lit(owner.kind)} ` +
    // Cast, because the parent id mirrors the main table's id and can be a uuid where the archive
    // keeps text, and PostgreSQL compares the two only explicitly. Exact, because the archive and
    // the companion may carry different collations (see `exactText`).
    `AND ${exactText(`${archived}.${q("entry_id", dialect)}`, dialect)} = ${exactText(castText(`${source}.${q("_parent", dialect)}`, dialect), dialect)} ` +
    `AND ${exactText(`${archived}.${q("locale", dialect)}`, dialect)} = ${exactText(`${source}.${q("_locale", dialect)}`, dialect)} ` +
    `AND ${archived}.${q("field", dialect)} = ${lit(columnName)} ` +
    `ORDER BY ${archived}.${q("id", dialect)} DESC LIMIT 1)`;
  return (
    `INSERT INTO ${q(ARCHIVE, dialect)} ` +
    `(${q("collection", dialect)}, ${q("entity_kind", dialect)}, ${q("entry_id", dialect)}, ${q("locale", dialect)}, ${q("field", dialect)}, ${q("value", dialect)}) ` +
    `SELECT ${lit(owner.slug)}, ${lit(owner.kind)}, ${source}.${q("_parent", dialect)}, ${source}.${q("_locale", dialect)}, ${lit(columnName)}, ${value} ` +
    `FROM ${q(companionTable, dialect)} ${source} WHERE ${source}.${q("_locale", dialect)} <> ${lit(defaultLocale)} ` +
    `AND ${nullSafeDiffers(exactText(newest, dialect), exactText(value, dialect), dialect)}`
  );
}

/**
 * The archive half of a field leaving translation on its own: every non-default language's value
 * of its companion column, written to the localization archive. A caller that writes it before
 * altering the main table, so that an archive that refuses the write stops the change before
 * anything else has run, passes `archive: false` to {@link buildFieldLeavesTranslationStatements}
 * for the rest.
 */
export function buildFieldLeavesTranslationArchiveStatement(
  ref: Pick<CompanionCopyRef, "dialect" | "companionTable" | "defaultLocale">,
  owner: ArchiveOwner,
  columnName: string
): string {
  return buildArchiveNonDefaultStatement(ref, owner, columnName);
}

/**
 * What a field that stops being translated needs before its companion column is dropped: every
 * non-default language's value archived, then the default language's value copied onto the main
 * table's column of the same name, which the caller has already added.
 *
 * Archive first, because it is the step that keeps what the drop would lose: if it fails, the
 * column has not been touched yet. Both statements are safe to re-run before the drop, so a run
 * stopped part-way loses nothing; a value archived twice is restored from its newest row. The copy
 * picks its row by the same rule as disabling translation for the whole entity
 * (`buildDefaultLocaleRestoreStatements`), so the two cannot disagree on what the shared value
 * becomes. `archive: false` leaves out the archive write, for a caller that has made it already.
 */
export function buildFieldLeavesTranslationStatements(
  ref: CompanionCopyRef,
  owner: ArchiveOwner,
  columnName: string,
  options: { archive?: boolean } = {}
): string[] {
  return [
    ...(options.archive === false
      ? []
      : [buildArchiveNonDefaultStatement(ref, owner, columnName)]),
    ...buildDefaultLocaleRestoreStatements(ref, [columnName]),
  ];
}

export function buildLocalizationDownStatements(
  spec: CompanionMigrationSpec,
  options: LocalizationDownOptions = {}
): string[] {
  const {
    dialect,
    mainTable,
    companionTable,
    defaultLocale,
    collection,
    kind,
    columns,
  } = spec;
  const stmts: string[] = [];

  // Reversing an ENABLE that dropped only a subset of the localized columns from main
  // (`columnsOnMain`) must re-add and restore exactly that subset; a column main never
  // carried has no place to come back to. Undefined means "all of `columns`" — the disable
  // path, where every localized column belongs on main. The archive step below still spans
  // ALL columns so no translation is lost when the companion is dropped.
  const onMainSet = spec.columnsOnMain && new Set(spec.columnsOnMain);
  const onMain = onMainSet
    ? columns.filter(c => onMainSet.has(c.name))
    : columns;

  // 1. re-add columns (nullable — localized columns are always nullable), skipping any the main
  // table still carries. Restoring them is handled below regardless: see `existingMainColumns`.
  const alreadyPresent = new Set(options.existingMainColumns ?? []);
  for (const c of onMain) {
    if (alreadyPresent.has(c.name)) continue;
    stmts.push(
      `ALTER TABLE ${q(mainTable, dialect)} ADD COLUMN ${q(c.name, dialect)} ${restoreTargetType(c, dialect)}`
    );
  }

  // 2. restore the default-locale values onto the main row (one UPDATE covering every column)
  stmts.push(
    ...buildDefaultLocaleRestoreStatements(
      spec,
      onMain.map(c => c.name),
      // Decided by the caller from the PHYSICAL tables, never from `spec.status`. That field is
      // the desired shape, and a save that disables localization and turns Draft/Published on at
      // once would have this read a `_status` the old companion does not carry — into a `status`
      // the main table has not been given yet, since a disable runs the companion transition
      // before the shared ALTER. Omitted means do not touch status.
      { restoreStatus: options.restoreStatus === true }
    )
  );

  // 3. archive non-default translations
  for (const c of columns) {
    stmts.push(
      buildArchiveNonDefaultStatement(
        { dialect, companionTable, defaultLocale },
        archiveOwnerOf(collection, kind),
        c.name
      )
    );
  }

  // 4. drop the companion table
  stmts.push(`DROP TABLE ${q(companionTable, dialect)}`);

  return stmts;
}
