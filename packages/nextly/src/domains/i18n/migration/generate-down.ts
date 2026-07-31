import { castText, ddlType, lit, q } from "./ddl-types";
import type { CompanionCopyRef, CompanionMigrationSpec } from "./types";

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
 * `WHERE EXISTS` matters in both. Without it a row that has no companion row in the default locale
 * — an entry authored only in another language, or one created while the transition was
 * incomplete — assigns SQL NULL, so restoring would blank the main column instead of leaving it
 * alone. There is nothing to restore for such a row, and nothing is what it should get.
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
  columnNames: readonly string[]
): string[] {
  if (columnNames.length === 0) return [];
  const { dialect, mainTable, companionTable, defaultLocale } = spec;
  const comp = q(companionTable, dialect);
  const main = q(mainTable, dialect);
  const match =
    `${comp}.${q("_parent", dialect)} = ${main}.${q("id", dialect)} ` +
    `AND ${comp}.${q("_locale", dialect)} = ${lit(defaultLocale)}`;
  const assignments = columnNames
    .map(name => {
      const col = q(name, dialect);
      return `${col} = (SELECT ${col} FROM ${comp} WHERE ${match})`;
    })
    .join(", ");
  return [
    `UPDATE ${main} SET ${assignments} ` +
      `WHERE EXISTS (SELECT 1 FROM ${comp} WHERE ${match})`,
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
      `ALTER TABLE ${q(mainTable, dialect)} ADD COLUMN ${q(c.name, dialect)} ${ddlType(c, dialect)}`
    );
  }

  // 2. restore the default-locale values onto the main row (one UPDATE covering every column)
  stmts.push(
    ...buildDefaultLocaleRestoreStatements(
      spec,
      onMain.map(c => c.name)
    )
  );

  // 3. archive non-default translations
  for (const c of columns) {
    const comp = q(companionTable, dialect);
    stmts.push(
      `INSERT INTO ${q(ARCHIVE, dialect)} ` +
        `(${q("collection", dialect)}, ${q("entry_id", dialect)}, ${q("locale", dialect)}, ${q("field", dialect)}, ${q("value", dialect)}) ` +
        `SELECT ${lit(collection)}, ${q("_parent", dialect)}, ${q("_locale", dialect)}, ${lit(c.name)}, ${castText(q(c.name, dialect), dialect)} ` +
        `FROM ${comp} WHERE ${q("_locale", dialect)} <> ${lit(defaultLocale)}`
    );
  }

  // 4. drop the companion table
  stmts.push(`DROP TABLE ${q(companionTable, dialect)}`);

  return stmts;
}
