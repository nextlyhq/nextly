import { castText, ddlType, lit, q } from "./ddl-types";
import type { CompanionMigrationSpec } from "./types";

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
export function buildLocalizationDownStatements(
  spec: CompanionMigrationSpec
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

  // 1. re-add columns (nullable — localized columns are always nullable)
  for (const c of onMain) {
    stmts.push(
      `ALTER TABLE ${q(mainTable, dialect)} ADD COLUMN ${q(c.name, dialect)} ${ddlType(c, dialect)}`
    );
  }

  // 2. restore default-locale value onto the main row (one correlated UPDATE per column)
  for (const c of onMain) {
    const col = q(c.name, dialect);
    const comp = q(companionTable, dialect);
    const main = q(mainTable, dialect);
    stmts.push(
      `UPDATE ${main} SET ${col} = (SELECT ${col} FROM ${comp} ` +
        `WHERE ${comp}.${q("_parent", dialect)} = ${main}.${q("id", dialect)} ` +
        `AND ${comp}.${q("_locale", dialect)} = ${lit(defaultLocale)})`
    );
  }

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
