/**
 * The companion migrations for fields that stop being translated while their entity stays
 * translated, as `nextly migrate:create` writes them.
 *
 * Two files around the main migration, which gives the main table its column for each field:
 *
 * - **archive**, before it: every non-default language's value written to the localization
 *   archive. An archive that refuses them stops the run before the main table changes. The writes
 *   are safe to repeat (`buildFieldLeavesTranslationArchiveStatement`). Its DOWN keeps the archived
 *   copies, which a restore may still read.
 * - **shared**, after it: the default language's value copied onto the main table's new column,
 *   then the companion column dropped. Its DOWN puts the companion column back and refills it, the
 *   default language from the main table and every other language from its newest archive row.
 *
 * Re-running is the runner's: a file runs in one transaction on PostgreSQL and SQLite, so a failed
 * one leaves nothing behind, and on MySQL a failed file is refused rather than run again over what
 * stayed (`assertNotPartiallyApplied`).
 *
 * @module domains/i18n/migration/plan-field-leaves-migration
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { COMPANION_STATUS_COLUMN } from "../companion-columns";

import { castText, ddlType, exactText, lit, q } from "./ddl-types";
import {
  archiveOwnerOf,
  buildDefaultLocaleRestoreStatements,
  buildFieldLeavesTranslationArchiveStatement,
} from "./generate-down";
import type { CompanionMigrationSpec, LocalizedColumnSpec } from "./types";

const ARCHIVE = "nextly_i18n_archive";

/** One companion file: its statements each way, and the spec its header records. */
export interface FieldLeavesFile {
  upSql: string;
  downSql: string;
  spec: CompanionMigrationSpec;
}

/** The two files, in the order they run around the main migration. */
export interface FieldLeavesMigrationPlan {
  archive: FieldLeavesFile;
  shared: FieldLeavesFile;
}

function toSql(statements: readonly string[]): string {
  return statements.map(s => `${s};`).join("\n\n");
}

/**
 * An archived value, which the archive keeps as text, as a value of the column it goes back to.
 * PostgreSQL assigns text to another type only through an explicit cast; MySQL and SQLite convert
 * on assignment.
 */
function fromArchivedText(
  expr: string,
  column: LocalizedColumnSpec,
  dialect: SupportedDialect
): string {
  return dialect === "postgresql"
    ? `CAST(${expr} AS ${ddlType(column, dialect)})`
    : expr;
}

/**
 * Plans the archive and shared files for the fields in `spec.columns`, every one of which stops
 * being translated in this migration.
 */
export function planFieldLeavesTranslationMigration(
  spec: CompanionMigrationSpec
): FieldLeavesMigrationPlan {
  const {
    dialect,
    mainTable,
    companionTable,
    defaultLocale,
    collection,
    kind,
  } = spec;
  const owner = archiveOwnerOf(collection, kind);
  const ref = { dialect, mainTable, companionTable, defaultLocale };
  const comp = q(companionTable, dialect);
  const main = q(mainTable, dialect);
  const names = spec.columns.map(c => c.name);

  const archiveUp = spec.columns.map(column =>
    buildFieldLeavesTranslationArchiveStatement(ref, owner, column.name)
  );
  const archiveDown = [
    // The archived copies stay: a restore may still read them, and they change nothing a rollback
    // has to undo. The runner refuses an empty DOWN as irreversible, so the file says so instead.
    "SELECT 1",
  ];

  // No widening of the main column here, though a `longText` companion column made before the
  // renderer emitted TEXT is physically LONGTEXT on MySQL: widening it would leave the main column
  // wider than the snapshot says, which a later migration reads as drift that no `migrate:create`
  // can repair. A value too long for TEXT is refused by the copy instead (MySQL's strict mode, its
  // default), and the copy runs before the drop, so the value stays where it was.
  const sharedUp = [
    ...buildDefaultLocaleRestoreStatements(ref, names),
    ...names.map(name => `ALTER TABLE ${comp} DROP COLUMN ${q(name, dialect)}`),
  ];

  const parent = `${comp}.${q("_parent", dialect)}`;
  const locale = `${comp}.${q("_locale", dialect)}`;
  const newestArchived = (column: LocalizedColumnSpec) =>
    `(SELECT ${q("archived", dialect)}.${q("value", dialect)} FROM ${q(ARCHIVE, dialect)} ${q("archived", dialect)} ` +
    `WHERE ${q("archived", dialect)}.${q("collection", dialect)} = ${lit(collection)} ` +
    `AND ${q("archived", dialect)}.${q("entity_kind", dialect)} = ${lit(owner.kind)} ` +
    `AND ${exactText(`${q("archived", dialect)}.${q("entry_id", dialect)}`, dialect)} = ${exactText(castText(parent, dialect), dialect)} ` +
    `AND ${exactText(`${q("archived", dialect)}.${q("locale", dialect)}`, dialect)} = ${exactText(locale, dialect)} ` +
    `AND ${q("archived", dialect)}.${q("field", dialect)} = ${lit(column.name)} ` +
    `ORDER BY ${q("archived", dialect)}.${q("id", dialect)} DESC LIMIT 1)`;
  const mainId = `${main}.${q("id", dialect)}`;
  // The companion row a default-language value goes back into. An entry created while the field
  // was shared may have none (when this was the entity's last translated field, nothing wrote
  // one), and the main table's column is dropped right after this file's DOWN, so it is created
  // here from the main row, publishing state included, rather than its value being left behind.
  const insertMissingDefaultRows =
    `INSERT INTO ${comp} (${q("_parent", dialect)}, ${q("_locale", dialect)}, ` +
    `${names.map(name => q(name, dialect)).join(", ")}` +
    `${spec.status ? `, ${q(COMPANION_STATUS_COLUMN, dialect)}` : ""}) ` +
    `SELECT ${mainId}, ${lit(defaultLocale)}, ` +
    `${names.map(name => `${main}.${q(name, dialect)}`).join(", ")}` +
    `${spec.status ? `, ${main}.${q("status", dialect)}` : ""} ` +
    `FROM ${main} WHERE NOT EXISTS (SELECT 1 FROM ${comp} WHERE ${parent} = ${mainId} ` +
    `AND ${locale} = ${lit(defaultLocale)})`;
  const sharedDown = [
    ...spec.columns.map(
      column =>
        `ALTER TABLE ${comp} ADD COLUMN ${q(column.name, dialect)} ${ddlType(column, dialect)}`
    ),
    insertMissingDefaultRows,
    ...spec.columns.flatMap(column => {
      const col = q(column.name, dialect);
      return [
        // The default language's value is the shared one the main table holds now.
        `UPDATE ${comp} SET ${col} = (SELECT ${main}.${col} FROM ${main} WHERE ${mainId} = ${parent}) ` +
          `WHERE ${locale} = ${lit(defaultLocale)}`,
        // Every other language from the newest value archived for it.
        `UPDATE ${comp} SET ${col} = ${fromArchivedText(newestArchived(column), column, dialect)} ` +
          `WHERE ${locale} <> ${lit(defaultLocale)}`,
      ];
    }),
  ];

  return {
    archive: {
      upSql: toSql(archiveUp),
      downSql:
        "-- The archived copies are kept; a restore may still read them.\n" +
        toSql(archiveDown),
      spec,
    },
    shared: { upSql: toSql(sharedUp), downSql: toSql(sharedDown), spec },
  };
}

/**
 * How to recover a `shared` file whose attempt may have stopped part-way, which MySQL refuses to
 * run again: it commits each schema statement as it runs, so its drops may have landed while the
 * file is recorded as failed. Whether they did is one question the operator can answer from the
 * companion table, and each answer has one next step.
 */
export function sharedFileRecoveryAdvice(
  filename: string,
  spec: CompanionMigrationSpec
): string {
  const names = spec.columns.map(c => `"${c.name}"`);
  const one = names.length === 1;
  const columns = names.join(", ");
  return (
    `It copies ${columns} onto ${spec.mainTable}, then drops ${one ? "it" : "them"} from ` +
    `${spec.companionTable}. Check whether ${spec.companionTable} still has ${columns}. ` +
    `If ${one ? "it is" : "they are all"} gone, the file finished: mark it applied with ` +
    `\`nextly migrate:resolve --applied ${filename}\`. ` +
    `If ${one ? "it is" : "they are all"} still there, nothing was dropped: run ` +
    `\`nextly migrate:resolve --failed-cleanup ${filename}\` and then \`nextly migrate\` to run it again.` +
    (one
      ? ""
      : ` If only some are gone, drop the rest from ${spec.companionTable} by hand, then mark it applied.`)
  );
}
