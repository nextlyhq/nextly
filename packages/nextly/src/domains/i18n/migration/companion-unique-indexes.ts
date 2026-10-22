/**
 * A translated field marked unique is unique within each language: a unique index on its
 * companion table over its value and `_locale`, so the same value is refused twice in one
 * language and allowed in two.
 *
 * The index keys on `NULLIF(column, '')` rather than the column: a value left blank is stored as
 * `''`, and two blanks are not the same value. Inside the index a blank becomes NULL, and NULLs
 * never collide, so untranslated documents are never duplicates of one another, while what is
 * stored, and what every read returns, stays exactly as it was. PostgreSQL and SQLite key an index
 * on an expression; MySQL does from 8.0.13 (a functional key part, in its own parentheses), on
 * the value's SHA-256 since it cannot key an expression returning TEXT.
 *
 * @module domains/i18n/migration/companion-unique-indexes
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";
import { indexNameForColumns } from "../../schema/services/index-name";
import { isFieldLocalized } from "../classify-fields";

import { q } from "./ddl-types";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import type { CompanionFieldLike } from "./reconcile-companion";

/** A field as the companion knows it, with whether it is marked unique. */
export type UniqueFieldLike = CompanionFieldLike & { unique?: boolean };

/** A translated field that is unique within each language, and its companion column. */
export interface UniqueTranslatedColumn {
  field: string;
  column: string;
}

/** The translated fields marked unique, with the companion column each one has. */
export function uniqueTranslatedColumns(args: {
  fields: readonly UniqueFieldLike[];
  entityLocalized: boolean;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
}): UniqueTranslatedColumn[] {
  return args.fields.flatMap(field => {
    if (field.unique !== true) return [];
    if (!isFieldLocalized(field, args.entityLocalized)) return [];
    const spec = fieldToLocalizedColumnSpec(field, args.dialect, args.builtBy);
    return spec ? [{ field: field.name, column: spec.name }] : [];
  });
}

/**
 * The companion column of every translated field in `fields`, unique or not: the columns whose
 * per-language index a change may have to drop.
 */
export function translatedColumnNames(args: {
  fields: readonly UniqueFieldLike[];
  entityLocalized: boolean;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
}): string[] {
  return args.fields.flatMap(field => {
    if (!isFieldLocalized(field, args.entityLocalized)) return [];
    const spec = fieldToLocalizedColumnSpec(field, args.dialect, args.builtBy);
    return spec ? [spec.name] : [];
  });
}

/** The name of a column's per-language unique index on a companion table. */
export function companionUniqueIndexName(
  companionTable: string,
  column: string
): string {
  return indexNameForColumns(companionTable, [column, "_locale"], true);
}

/** What a companion's per-language unique indexes are brought to `wanted` by. */
interface CompanionUniqueIndexArgs {
  dialect: SupportedDialect;
  companionTable: string;
  wanted: readonly UniqueTranslatedColumn[];
  /** Every translated column the companion has, so only this module's own indexes are dropped. */
  translatedColumns: readonly string[];
  liveIndexNames: ReadonlySet<string>;
}

/**
 * The statements that bring a companion's per-language unique indexes to `wanted`, drops first
 * (`companionUniqueIndexChanges`). For a caller that changes no column alongside them.
 */
export function companionUniqueIndexStatements(
  args: CompanionUniqueIndexArgs
): string[] {
  const { drops, creates } = companionUniqueIndexChanges(args);
  return [...drops, ...creates];
}

/**
 * The index of each translated column no longer wanted, dropped, and each missing one wanted,
 * created. Asked against the indexes the table has (`liveIndexNames`), so a statement is never
 * written for an index already there or already gone, which MySQL, having no `IF EXISTS` on
 * either, would refuse.
 *
 * Apart, because a change that also alters columns has to place them: the drops before any column
 * goes, since SQLite will not drop a column an index uses and MySQL will not drop one a functional
 * key part uses, and the creates after every column is in place.
 */
export function companionUniqueIndexChanges(args: CompanionUniqueIndexArgs): {
  drops: string[];
  creates: string[];
} {
  const { dialect, companionTable, liveIndexNames } = args;
  const table = q(companionTable, dialect);
  const wanted = new Set(args.wanted.map(w => w.column));
  const creates = args.wanted
    .filter(
      w =>
        !liveIndexNames.has(companionUniqueIndexName(companionTable, w.column))
    )
    .map(w => {
      const name = q(
        companionUniqueIndexName(companionTable, w.column),
        dialect
      );
      const value = `NULLIF(${q(w.column, dialect)}, '')`;
      // MySQL takes an expression only as a functional key part, in parentheses of its own, and
      // cannot key one that returns TEXT, which a companion's text column is. It keys the value's
      // SHA-256 instead: any length, a blank still NULL, and values compared exactly, as
      // PostgreSQL and SQLite compare them.
      const key = dialect === "mysql" ? `(SHA2(${value}, 256))` : value;
      const ifNotExists = dialect === "mysql" ? "" : "IF NOT EXISTS ";
      return `CREATE UNIQUE INDEX ${ifNotExists}${name} ON ${table} (${key}, ${q("_locale", dialect)})`;
    });
  // Each column once: a caller may list a column the change keeps under both its old and new
  // fields, and MySQL refuses a second DROP of the same index.
  const drops = [...new Set(args.translatedColumns)]
    .filter(column => !wanted.has(column))
    .map(column => companionUniqueIndexName(companionTable, column))
    .filter(name => liveIndexNames.has(name))
    .map(name =>
      dialect === "mysql"
        ? `DROP INDEX ${q(name, dialect)} ON ${table}`
        : `DROP INDEX IF EXISTS ${q(name, dialect)}`
    );
  return { drops, creates };
}
