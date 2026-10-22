/**
 * What must hold before a translated field becomes unique within each language.
 *
 * - **The server can key the index.** It keys on `NULLIF(value, '')`, an expression, which
 *   PostgreSQL and SQLite always can and MySQL can from 8.0.13. On a server that cannot, the rule
 *   is refused rather than left unenforced.
 * - **No language already holds a value twice.** Adding the rule over duplicates would fail
 *   part-way; it stops first instead, and names the documents in each language that share a value.
 *   It never names the value: the person adding the rule may not be allowed to read every document.
 *
 * Blank values are never duplicates, here as in the index.
 *
 * @module domains/i18n/migration/translated-unique-preconditions
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";

import {
  companionUniqueIndexName,
  uniqueTranslatedColumns,
  type UniqueFieldLike,
  type UniqueTranslatedColumn,
} from "./companion-unique-indexes";

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

/** The refusal for each translated unique field a server cannot index per language. */
export function refusalsForUnindexableTranslatedUnique(
  adapter: Pick<DrizzleAdapter, "getCapabilities">,
  columns: readonly UniqueTranslatedColumn[]
): TranslatedUniqueRefusal[] {
  if (canKeyOnExpressions(adapter)) return [];
  return columns.map(({ field }) => ({
    path: `fields.${field}`,
    code: "UNIQUE_NOT_ENFORCEABLE_ON_DIALECT",
    message:
      `"${field}" is translated and unique, which needs a unique index on an expression. ` +
      `This database server cannot create one (it needs MySQL 8.0.13 or later). Remove Unique, ` +
      `or make the field shared.`,
  }));
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
  if (!change.isLocalized || !change.newFields.some(f => f.unique === true))
    return [];
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
  for (const { field, column } of columns) {
    const value = sql.identifier(column);
    const rows = await adapter.queryStatement<{
      locale: string;
      parent: unknown;
    }>(
      sql`SELECT a.${locale} AS locale, a.${parent} AS parent FROM ${table} a JOIN (SELECT ${value} AS v, ${locale} AS l FROM ${table} WHERE ${value} IS NOT NULL AND ${value} <> '' GROUP BY ${value}, ${locale} HAVING COUNT(*) > 1) d ON a.${value} = d.v AND a.${locale} = d.l ORDER BY a.${locale}, a.${parent} LIMIT ${LISTED}`
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
