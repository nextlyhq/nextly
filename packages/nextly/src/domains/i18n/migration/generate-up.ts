import { ddlType, q } from "./ddl-types";
import type { CompanionMigrationSpec } from "./types";

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
  const {
    dialect,
    mainTable,
    companionTable,
    defaultLocale,
    parentIdType,
    columns,
  } = spec;
  const colNames = columns.map(c => q(c.name, dialect));

  const colDefs = columns
    .map(c => `  ${q(c.name, dialect)} ${ddlType(c, dialect)}`)
    .join(",\n");

  const create =
    `CREATE TABLE ${q(companionTable, dialect)} (\n` +
    `  ${q("_parent", dialect)} ${parentIdType} NOT NULL,\n` +
    `  ${q("_locale", dialect)} VARCHAR(20) NOT NULL,\n` +
    `${colDefs},\n` +
    `  PRIMARY KEY (${q("_parent", dialect)}, ${q("_locale", dialect)}),\n` +
    `  FOREIGN KEY (${q("_parent", dialect)}) REFERENCES ${q(mainTable, dialect)} (${q("id", dialect)}) ON DELETE CASCADE\n` +
    `)`;

  const seed =
    `INSERT INTO ${q(companionTable, dialect)} ` +
    `(${q("_parent", dialect)}, ${q("_locale", dialect)}, ${colNames.join(", ")}) ` +
    `SELECT ${q("id", dialect)}, '${defaultLocale}', ${colNames.join(", ")} ` +
    `FROM ${q(mainTable, dialect)}`;

  const drops = columns.map(
    c =>
      `ALTER TABLE ${q(mainTable, dialect)} DROP COLUMN ${q(c.name, dialect)}`
  );

  return [create, seed, ...drops].map(s => `${s};`).join("\n\n");
}
