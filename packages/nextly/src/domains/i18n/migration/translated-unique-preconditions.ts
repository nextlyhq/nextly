/**
 * What must hold before a translated field becomes unique within each language.
 *
 * - **The server can key the index.** PostgreSQL keys `NULLIF(value, '')`, an expression, and so
 *   does MySQL from 8.0.13; SQLite keys the value itself in a partial index. On a server that
 *   cannot, the rule is refused rather than left unenforced.
 * - **No language already holds a value twice.** Adding the rule over duplicates would fail
 *   part-way; it stops first instead, and names the documents in each language that share a value.
 *   It never names the value: the person adding the rule may not be allowed to read every document.
 *
 * Blank values are never duplicates, here as in the index.
 *
 * @module domains/i18n/migration/translated-unique-preconditions
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import {
  readIndexUniqueness,
  uniqueIndexNames,
} from "../../schema/pipeline/live-table-facts";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";
import { uniquenessCanBeAnIndex } from "../../schema/services/index-name";

import {
  companionUniqueIndexName,
  isUniqueField,
  uniqueColumnsWithKind,
  uniqueTranslatedColumns,
  type UniqueFieldLike,
  type UniqueTranslatedColumn,
} from "./companion-unique-indexes";
import { ddlType } from "./ddl-types";
import type { CompanionMigrationSpec } from "./types";

/** The documents in one language that share a value of a field, by id. */
export interface TranslatedDuplicate {
  field: string;
  locale: string;
  documents: string[];
}

/** The most documents a refusal lists per field, so a large table answers in one screen. */
const LISTED = 50;

/** A refusal in the shape a validation error carries. */
export interface TranslatedUniqueRefusal {
  path: string;
  code:
    | "TRANSLATED_UNIQUE_OVER_DUPLICATES"
    | "UNIQUE_NOT_ENFORCEABLE_ON_DIALECT";
  message: string;
}

/** The adapter surface these preconditions read: what the server can do, and its rows. */
export type TranslatedUniqueAdapter = Pick<
  DrizzleAdapter,
  "getCapabilities" | "queryStatement"
>;

/** Whether the adapter's server can key a unique index on an expression. */
export function canKeyOnExpressions(
  adapter: Pick<DrizzleAdapter, "getCapabilities">
): boolean {
  const capabilities = adapter.getCapabilities();
  return (
    capabilities.dialect !== "mysql" || capabilities.functionalIndexes === true
  );
}

/**
 * Whether a column that is not text can carry uniqueness as an index of its own on `dialect`,
 * asked of the same rule a shared unique column is asked of. MySQL cannot index a JSON column
 * directly: it needs an indexed generated value, so the rule is refused before any DDL rather
 * than reaching the server's error part-way through a change.
 *
 * A kind nothing recorded is taken as indexable: an older record cannot be judged, and refusing
 * what it describes would stop changes that work today.
 */
function nonTextColumnCanBeUnique(
  column: UniqueTranslatedColumn,
  dialect: SupportedDialect
): boolean {
  if (column.kind === undefined) return true;
  return uniquenessCanBeAnIndex(
    ddlType({ name: column.column, kind: column.kind }, dialect),
    dialect
  );
}

/**
 * The refusal for each translated unique field a server cannot index per language: a text column
 * where it cannot key an expression, and a column of any other kind it cannot key as it is.
 */
export function refusalsForUnindexableTranslatedUnique(
  adapter: Pick<DrizzleAdapter, "getCapabilities">,
  columns: readonly UniqueTranslatedColumn[]
): TranslatedUniqueRefusal[] {
  const { dialect } = adapter.getCapabilities();
  const expressions = canKeyOnExpressions(adapter);
  return columns.flatMap(column => {
    const { field } = column;
    // Text is keyed on an expression that leaves its blank out; anything else is keyed as it is.
    if (column.text) {
      if (expressions) return [];
      return [
        {
          path: `fields.${field}`,
          code: "UNIQUE_NOT_ENFORCEABLE_ON_DIALECT" as const,
          message:
            `"${field}" is translated and unique, which needs a unique index on an expression. ` +
            `This database server cannot create one (it needs MySQL 8.0.13 or later). Remove Unique, ` +
            `or make the field shared.`,
        },
      ];
    }
    if (nonTextColumnCanBeUnique(column, dialect)) return [];
    return [
      {
        path: `fields.${field}`,
        code: "UNIQUE_NOT_ENFORCEABLE_ON_DIALECT" as const,
        message:
          `"${field}" is translated and unique, and ${dialect} cannot carry uniqueness on what it ` +
          `stores. Remove Unique, or use a field whose value this database can index.`,
      },
    ];
  });
}

/** A change to an entity's fields, as the unique-within-each-language preconditions read it. */
export interface TranslatedUniqueChange {
  /** The collection, Single or field group, named in a refusal's log. */
  entity: string;
  builtBy: ColumnOrigin;
  oldFields: readonly UniqueFieldLike[];
  newFields: readonly UniqueFieldLike[];
  wasLocalized: boolean;
  isLocalized: boolean;
  /**
   * The per-language unique indexes the companion has, when read. A field counts as becoming
   * unique when its index is missing, which also catches one marked unique before the rule was
   * enforced and never indexed. Left out, it is judged by the fields before the change.
   */
  indexedOn?: { companionTable: string; names: ReadonlySet<string> };
}

/**
 * Refuses a change that makes a translated field unique within each language on a server that
 * cannot key the index (`refusalsForUnindexableTranslatedUnique`), before anything runs. Every
 * path that creates or changes a companion asks it, so none reaches the server's own error
 * part-way through. A field already translated, unique and indexed was checked when it became so.
 *
 * Judged by the flags first, so a change that marks nothing unique asks the adapter nothing.
 *
 * @returns the fields the change makes unique, for a caller that checks more
 * @throws NextlyError `VALIDATION_ERROR` naming each field the server cannot index
 */
export function refuseUnindexableTranslatedUnique(
  adapter: Pick<DrizzleAdapter, "getCapabilities">,
  change: TranslatedUniqueChange
): UniqueTranslatedColumn[] {
  if (!change.isLocalized || !change.newFields.some(isUniqueField)) return [];
  const dialect = adapter.getCapabilities().dialect;
  const columnsOf = (fields: readonly UniqueFieldLike[], localized: boolean) =>
    uniqueTranslatedColumns({
      fields,
      entityLocalized: localized,
      dialect,
      builtBy: change.builtBy,
    });
  const { indexedOn } = change;
  const already = new Set(
    columnsOf(change.oldFields, change.wasLocalized).map(c => c.field)
  );
  const becoming = columnsOf(change.newFields, true).filter(c =>
    indexedOn
      ? !indexedOn.names.has(
          companionUniqueIndexName(indexedOn.companionTable, c.column)
        )
      : !already.has(c.field)
  );
  const refusals = refusalsForUnindexableTranslatedUnique(adapter, becoming);
  if (refusals.length > 0) {
    throw NextlyError.validation({
      errors: refusals,
      logContext: { entity: change.entity, fields: refusals.map(r => r.path) },
    });
  }
  return becoming;
}

/** The documents in each language that already share a value of one of `columns`. */
export async function duplicateTranslatedValues(
  adapter: Pick<DrizzleAdapter, "queryStatement">,
  companionTable: string,
  columns: readonly UniqueTranslatedColumn[]
): Promise<TranslatedDuplicate[]> {
  const found: TranslatedDuplicate[] = [];
  const table = sql.identifier(companionTable);
  const locale = sql.identifier("_locale");
  const parent = sql.identifier("_parent");
  for (const { field, column, text } of columns) {
    const value = sql.identifier(column);
    // Only text has a blank to leave out, as the index leaves it out; a number compared with ''
    // is an error on PostgreSQL and a zero on MySQL.
    const present = text
      ? sql`${value} IS NOT NULL AND ${value} <> ''`
      : sql`${value} IS NOT NULL`;
    const rows = await adapter.queryStatement<{
      locale: string;
      parent: unknown;
    }>(
      sql`SELECT a.${locale} AS locale, a.${parent} AS parent FROM ${table} a JOIN (SELECT ${value} AS v, ${locale} AS l FROM ${table} WHERE ${present} GROUP BY ${value}, ${locale} HAVING COUNT(*) > 1) d ON a.${value} = d.v AND a.${locale} = d.l ORDER BY a.${locale}, a.${parent} LIMIT ${LISTED}`
    );
    const byLocale = new Map<string, string[]>();
    for (const row of rows) {
      byLocale.set(row.locale, [
        ...(byLocale.get(row.locale) ?? []),
        String(row.parent),
      ]);
    }
    for (const [lang, documents] of byLocale)
      found.push({ field, locale: lang, documents });
  }
  return found;
}

/**
 * The documents that already share a value of one of `columns` on the MAIN table, reported as
 * duplicates of the one language they are about to become.
 *
 * Turning translation on copies every main row's value into the default language before the
 * per-language index is created (`buildLocalizationUpStatements`), so a value main holds twice
 * becomes that language's duplicate. The main table has no `_locale` to group by, and the normal
 * main-table uniqueness preflight skips a field that is becoming translated, so neither side
 * checks these values unless this does.
 */
export async function duplicateValuesSeededFromMain(
  adapter: Pick<DrizzleAdapter, "queryStatement">,
  args: { mainTable: string; locale: string },
  columns: readonly UniqueTranslatedColumn[]
): Promise<TranslatedDuplicate[]> {
  const found: TranslatedDuplicate[] = [];
  const table = sql.identifier(args.mainTable);
  const id = sql.identifier("id");
  for (const { field, column, text } of columns) {
    const value = sql.identifier(column);
    const present = text
      ? sql`${value} IS NOT NULL AND ${value} <> ''`
      : sql`${value} IS NOT NULL`;
    const rows = await adapter.queryStatement<{ parent: unknown }>(
      sql`SELECT a.${id} AS parent FROM ${table} a JOIN (SELECT ${value} AS v FROM ${table} WHERE ${present} GROUP BY ${value} HAVING COUNT(*) > 1) d ON a.${value} = d.v ORDER BY a.${id} LIMIT ${LISTED}`
    );
    if (rows.length > 0)
      found.push({
        field,
        locale: args.locale,
        documents: rows.map(row => String(row.parent)),
      });
  }
  return found;
}

/** The refusal for each field and language that already holds a value twice. */
export function refusalsForTranslatedUniqueOverDuplicates(
  duplicates: readonly TranslatedDuplicate[]
): TranslatedUniqueRefusal[] {
  return duplicates.map(({ field, locale, documents }) => ({
    path: `fields.${field}`,
    code: "TRANSLATED_UNIQUE_OVER_DUPLICATES",
    message:
      `"${field}" cannot become unique: in "${locale}", these documents share a value: ` +
      `${documents.join(", ")}. Give each a different value, or leave one blank, then try again.`,
  }));
}

/**
 * The per-language unique indexes of `spec` this database already carries, by index name.
 *
 * A companion migration file is snapshotless and runs verbatim, so a database brought to the
 * same shape another way — `db:sync` under `next dev`, a Schema Builder save — meets a file that
 * creates an index it already has. PostgreSQL and SQLite are asked for `IF NOT EXISTS` and adopt
 * it; MySQL has no such spelling and fails on the duplicate name, so the already-correct state
 * has to be recognised before the statement runs rather than after it errors.
 */
export async function installedTranslatedUniqueIndexes(
  adapter: Pick<DrizzleAdapter, "getDrizzle" | "getCapabilities">,
  companionTable: string
): Promise<ReadonlySet<string>> {
  return uniqueIndexNames(
    await readIndexUniqueness(
      adapter.getDrizzle(),
      adapter.getCapabilities().dialect,
      companionTable
    )
  );
}

/**
 * The statements of a `unique` file with each create of an index `installed` already holds left
 * out, so a run adopts the state it finds instead of failing on a duplicate index name.
 *
 * Matched on the index NAME the statement creates, which is the one thing a create and a live
 * index share: the rest of the statement is the dialect's own spelling of the same rule.
 */
export function withoutAlreadyInstalledIndexes(
  statements: readonly string[],
  installed: ReadonlySet<string>
): string[] {
  if (installed.size === 0) return [...statements];
  return statements.filter(statement => {
    const created =
      /^\s*CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([^`"\s(]+)[`"]?/i.exec(
        statement
      );
    return created === null || !installed.has(created[1] ?? "");
  });
}

/**
 * Refuses a `unique` migration file before any of its statements runs, where an index it creates
 * cannot hold: a language already holds a value twice (naming the documents, never the value), or
 * the server cannot build the index. The same refusals the Schema Builder and `db:sync` give, so
 * the file stops with nothing changed rather than on the database's own error, part-way through
 * on MySQL, whose DDL commits as it goes.
 *
 * @throws NextlyError `CONFLICT` whose message carries each refusal's code and sentence
 */
export async function refuseTranslatedUniqueMigrationThatCannotHold(
  adapter: TranslatedUniqueAdapter,
  spec: Pick<
    CompanionMigrationSpec,
    "collection" | "companionTable" | "columns" | "unique"
  >,
  source: string,
  /**
   * The per-language unique indexes this database already carries, where the caller read them.
   * A column whose index is already there has nothing to create, so it is neither refused nor
   * asked for duplicates: the rule it would add is the rule already in force.
   */
  installed?: ReadonlySet<string>
): Promise<void> {
  // The file's header records each unique column by name beside the companion's columns, so
  // whether one stores text is read off the same header the file was written with.
  const columns = uniqueColumnsWithKind(spec.unique ?? [], spec.columns).filter(
    c =>
      installed === undefined ||
      !installed.has(companionUniqueIndexName(spec.companionTable, c.column))
  );
  if (columns.length === 0) return;
  let refusals = refusalsForUnindexableTranslatedUnique(adapter, columns);
  if (refusals.length === 0) {
    refusals = refusalsForTranslatedUniqueOverDuplicates(
      await duplicateTranslatedValues(adapter, spec.companionTable, columns)
    );
  }
  if (refusals.length === 0) return;
  throw NextlyError.conflict({
    reason: "state",
    message: refusals.map(r => `${r.code}: ${r.message}`).join(" "),
    logContext: {
      source,
      entity: spec.collection,
      fields: refusals.map(r => r.path),
    },
  });
}
