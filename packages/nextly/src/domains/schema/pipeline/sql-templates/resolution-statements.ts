/**
 * The statements a migration file carries for the person's answer to rows
 * that do not fit a column made required: fill them with a value, or delete
 * them. They run after the column exists and before it is made NOT NULL, so a
 * deploy's database is settled the same way as the one the answer was given
 * on.
 *
 * @module domains/schema/pipeline/sql-templates/resolution-statements
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../../errors/nextly-error";
import { storedDateValue } from "../../utils/backfill-default";

import { quoteIdent } from "./identifier-quoting";

/**
 * Where a field's values are kept for each language: in `companionTable`, the entity's
 * translations table, one row per entry (`_parent`, the main table's `id`) and language
 * (`_locale`), with no column on the main table. A field required there needs its value in the
 * default language (`locale`), which every other language falls back to, so an entry fits it
 * where its row in that language holds a value.
 */
export interface PerLanguageColumn {
  companionTable: string;
  locale: string;
}

/**
 * A column's rows that do not fit, and what is done with them. `tableName` is the entity's main
 * table; where the field's values are kept for each language (`perLanguage`), the rows settled are
 * the entries whose default-language value is missing, in the translations table.
 */
export type ColumnResolution = (
  | {
      tableName: string;
      columnName: string;
      kind: "fill";
      value: unknown;
      /**
       * The column stores JSON (`classifyFieldKind`'s `json`): the value is
       * written as its JSON text, which every dialect's JSON column (and
       * SQLite's text) takes from a string literal.
       */
      json?: boolean;
    }
  | { tableName: string; columnName: string; kind: "delete_nonconforming" }
) & { perLanguage?: PerLanguageColumn };

/**
 * `value` written as a SQL literal for `dialect`. A string's quotes are
 * doubled, and on MySQL, which reads a backslash as an escape, its
 * backslashes too; a number must be finite; a boolean is spelled as each
 * dialect stores it. Anything else is refused: the value has been checked
 * against the column's type before it reaches here.
 */
function sqlValueLiteral(value: unknown, dialect: SupportedDialect): string {
  if (typeof value === "string") {
    const quoted = value.replace(/'/g, "''");
    return `'${dialect === "mysql" ? quoted.replace(/\\/g, "\\\\") : quoted}'`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    if (dialect === "postgresql") return value ? "TRUE" : "FALSE";
    return value ? "1" : "0";
  }
  // A date reaching here is written in the one form a date fill is stored
  // in, the form the push binds (`storedDateValue`).
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return sqlValueLiteral(storedDateValue(value, dialect), dialect);
  }
  throw new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      "A fill value must be a string, a finite number, a boolean or a date.",
    logContext: { valueType: typeof value },
  });
}

/**
 * The statements settling `resolution`'s rows, in the order they run: for a column of the main
 * table, the one statement `resolutionStatement` writes; for a field kept per language
 * (`perLanguageStatements`), the statements over its translations table, which
 * `resolutionStatement` does not write. Every road that settles
 * rows, a save's migration file and the push that applies a change in development, writes them
 * from here, so the two settle the same rows.
 */
export function resolutionStatements(
  resolution: ColumnResolution,
  dialect: SupportedDialect
): string[] {
  if (resolution.perLanguage !== undefined) {
    return perLanguageStatements(resolution, resolution.perLanguage, dialect);
  }
  return [resolutionStatement(resolution, dialect)];
}

/** The statement settling `resolution`'s rows. */
export function resolutionStatement(
  resolution: ColumnResolution,
  dialect: SupportedDialect
): string {
  const table = quoteIdent(resolution.tableName, dialect);
  const column = quoteIdent(resolution.columnName, dialect);
  if (resolution.kind === "delete_nonconforming") {
    return `DELETE FROM ${table} WHERE ${column} IS NULL;`;
  }
  const value =
    resolution.json === true ? jsonText(resolution.value) : resolution.value;
  return `UPDATE ${table} SET ${column} = ${sqlValueLiteral(value, dialect)} WHERE ${column} IS NULL;`;
}

/** A fill's value as the SQL literal its column takes: a JSON column's as its JSON text. */
function fillLiteral(
  resolution: Extract<ColumnResolution, { kind: "fill" }>,
  dialect: SupportedDialect
): string {
  const value =
    resolution.json === true ? jsonText(resolution.value) : resolution.value;
  return sqlValueLiteral(value, dialect);
}

/**
 * The statements settling the entries with no value for a field kept per language, in its
 * default language: those whose row in that language holds NULL, or that have no row in it.
 *
 * - A delete removes every language's row of such an entry from the translations table first,
 *   so no row is left naming an entry that is gone, then the entry itself.
 * - A fill gives each default-language row holding NULL the value, then adds a default-language
 *   row holding it for each entry that has none; the row's other columns take their defaults.
 *
 * No column is made NOT NULL: a translations table's columns stay nullable, since a language
 * other than the default one may hold no value and fall back. Where a statement reads the table it
 * changes, it reads it through a derived table of distinct rows, which MySQL materializes before
 * the change, as it requires.
 */
function perLanguageStatements(
  resolution: ColumnResolution,
  perLanguage: PerLanguageColumn,
  dialect: SupportedDialect
): string[] {
  const q = (name: string) => quoteIdent(name, dialect);
  const main = q(resolution.tableName);
  const companion = q(perLanguage.companionTable);
  const column = q(resolution.columnName);
  const parent = q("_parent");
  const language = q("_locale");
  const locale = sqlValueLiteral(perLanguage.locale, dialect);
  const inDefaultLanguage = `${language} = ${locale}`;
  // The entries whose default-language row holds a value: the ones that fit.
  const fitting = `SELECT DISTINCT ${parent} FROM ${companion} WHERE ${inDefaultLanguage} AND ${column} IS NOT NULL`;
  if (resolution.kind === "delete_nonconforming") {
    return [
      `DELETE FROM ${companion} WHERE ${parent} NOT IN (SELECT ${parent} FROM (${fitting}) AS ${q("fitting")});`,
      `DELETE FROM ${main} WHERE ${q("id")} NOT IN (${fitting});`,
    ];
  }
  const value = fillLiteral(resolution, dialect);
  const withRow = `SELECT DISTINCT ${parent} FROM ${companion} WHERE ${inDefaultLanguage}`;
  return [
    `UPDATE ${companion} SET ${column} = ${value} WHERE ${inDefaultLanguage} AND ${column} IS NULL;`,
    `INSERT INTO ${companion} (${parent}, ${language}, ${column}) SELECT ${q("id")}, ${locale}, ${value} FROM ${main} WHERE ${q("id")} NOT IN (SELECT ${parent} FROM (${withRow}) AS ${q("with_row")});`,
  ];
}

/** `value` as the JSON text a JSON column stores; refused where it has none. */
function jsonText(value: unknown): string {
  const text = JSON.stringify(value) as string | undefined;
  if (text === undefined) {
    throw new NextlyError({
      code: "VALIDATION_ERROR",
      publicMessage: "A fill value for a JSON field must be a JSON value.",
      logContext: { valueType: typeof value },
    });
  }
  return text;
}
