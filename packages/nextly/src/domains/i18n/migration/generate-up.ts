import { ddlType, lit, q } from "./ddl-types";
import type { CompanionMigrationSpec } from "./types";

/** The `CREATE TABLE <companion> (...)` statement (no trailing `;`). Shared by the
 *  enable UP and the create-only path so the companion shape stays identical. */
function buildCompanionCreateStatement(spec: CompanionMigrationSpec): string {
  const { dialect, mainTable, companionTable, parentIdType, columns } = spec;
  const colDefs = columns
    .map(c => `  ${q(c.name, dialect)} ${ddlType(c, dialect)}`)
    .join(",\n");
  // i18n M6: per-locale draft/publish status column (only when the collection has Draft/Published).
  const statusDef = spec.status
    ? `  ${q("_status", dialect)} VARCHAR(20) NOT NULL DEFAULT 'draft',\n`
    : "";
  return (
    `CREATE TABLE ${q(companionTable, dialect)} (\n` +
    `  ${q("_parent", dialect)} ${parentIdType} NOT NULL,\n` +
    `  ${q("_locale", dialect)} VARCHAR(20) NOT NULL,\n` +
    statusDef +
    `${colDefs},\n` +
    `  PRIMARY KEY (${q("_parent", dialect)}, ${q("_locale", dialect)}),\n` +
    `  FOREIGN KEY (${q("_parent", dialect)}) REFERENCES ${q(mainTable, dialect)} (${q("id", dialect)}) ON DELETE CASCADE\n` +
    `)`
  );
}

/**
 * Create-only companion migration for a FRESH localized collection: just the
 * `CREATE TABLE <companion>`. No seed (the main table never held the localized columns)
 * and no main-table drop. Used when a collection is localized from birth.
 */
export function buildCompanionCreateOnlySql(
  spec: CompanionMigrationSpec
): string {
  return `${buildCompanionCreateStatement(spec)};`;
}

/**
 * UP migration for ENABLING localization on a collection's columns:
 *   1. CREATE the companion `_locales` table (composite PK, FK to main.id ON DELETE CASCADE)
 *   2. INSERT ... SELECT existing values as the default-locale rows (the data copy — the
 *      one thing the diff pipeline cannot do; this rides the verbatim file-migration path)
 *   3. DROP the relocated columns from the main table
 *
 * Returned as one SQL string; statements are `;`-terminated and blank-line separated.
 * Companion columns are created nullable (localized columns are always nullable).
 */
export function buildLocalizationUpSql(spec: CompanionMigrationSpec): string {
  return buildLocalizationUpStatements(spec)
    .map(s => `${s};`)
    .join("\n\n");
}

/**
 * Statement-array form of {@link buildLocalizationUpSql} (no trailing `;` per element). The
 * runtime enable path (a Builder-entity localization toggle, which has no migration file) runs
 * these individually via the adapter, so it does not have to split a joined string on `;`.
 */
export function buildLocalizationUpStatements(
  spec: CompanionMigrationSpec
): string[] {
  const { dialect, mainTable, companionTable, defaultLocale, columns } = spec;
  const colNames = columns.map(c => q(c.name, dialect));

  const create = buildCompanionCreateStatement(spec);

  // When the collection has Draft/Published, the seeded default-locale rows carry the existing
  // main row's `status` into the companion `_status` so enabling localization doesn't silently
  // un-publish live content.
  const statusInsertCol = spec.status ? `, ${q("_status", dialect)}` : "";
  const statusSelectCol = spec.status ? `, ${q("status", dialect)}` : "";
  const seed =
    `INSERT INTO ${q(companionTable, dialect)} ` +
    `(${q("_parent", dialect)}, ${q("_locale", dialect)}${statusInsertCol}, ${colNames.join(", ")}) ` +
    `SELECT ${q("id", dialect)}, ${lit(defaultLocale)}${statusSelectCol}, ${colNames.join(", ")} ` +
    `FROM ${q(mainTable, dialect)}`;

  const drops = columns.map(
    c =>
      `ALTER TABLE ${q(mainTable, dialect)} DROP COLUMN ${q(c.name, dialect)}`
  );

  return [create, seed, ...drops];
}
