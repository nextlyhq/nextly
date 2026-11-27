/**
 * Read every row one entry stores, on the delete's own transaction, before
 * the delete removes them: what the trash keeps so a restore can put the
 * entry back as it was.
 *
 * The rows are those the delete removes and nothing else:
 *
 * - the entry's own row, and its row in each language (`<table>_locales`);
 * - its field-group rows at every depth, found as the delete finds them (by
 *   the parent columns, in every field group's table), and their rows in each
 *   language;
 * - the many-to-many links it holds, by the ids it links to;
 * - where its translated values came from, the source text they were made
 *   from, and the record of the media its values use.
 *
 * Links other entries hold to it, and other entries' relation columns
 * pointing at it, belong to those entries: the database removes or clears
 * them at the delete as before, and a restore does not change other entries.
 * Its version history stays in the versions table under its id.
 *
 * @module domains/trash/capture-entry
 */
import type {
  TransactionContext,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { missingSchemaObject } from "../../database/missing-column";
import type { KeptLinks, KeptTableRows } from "../../schemas/trash";
import { MEDIA_USAGE_TABLE } from "../../schemas/media-usage/table-name";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import { TRANSLATION_PROVENANCE_TABLE } from "../../schemas/translation-provenance/table-name";
import { TRANSLATION_SOURCES_TABLE } from "../../schemas/translation-sources/table-name";
import { COMPANION_PARENT_COLUMN } from "../i18n/companion-columns";
import { usesJunctionTable } from "../schema/field-rules";
import {
  junctionLinkColumnsOf,
  junctionTableTo,
} from "../schema/services/field-column-descriptor";

import { keepRow } from "./kept-values";

/** Ids asked about in one statement, as the delete's own walk asks them. */
const ID_CHUNK = 200;

/** A field as the capture reads it: its name, type and options. */
export interface CapturedField {
  name?: string;
  type?: unknown;
  options?: unknown;
}

/** What the capture reads besides the transaction. */
export interface CaptureEntryInput {
  /** The collection's slug, which keys its translation records. */
  collection: string;
  /** The entry's own table. */
  tableName: string;
  entryId: string;
  /** The collection's fields, whose many-to-many fields hold its links. */
  fields: readonly CapturedField[];
  /** Every field group's table, where a field-group row can be. */
  fieldGroupTables: readonly string[];
  /** Whether a core table is in the database, asked on the transaction. */
  tableExists: (table: string) => Promise<boolean>;
}

/** Everything one entry stores, as the trash keeps it. */
export interface CapturedEntry {
  tables: KeptTableRows[];
  links: KeptLinks[];
}

/**
 * Whether `error` refuses a table this running instance has not registered:
 * the refusal comes before any statement is built, so the transaction it is
 * asked in stays usable.
 */
function isUnregisteredTable(error: unknown): boolean {
  return missingSchemaObject(error)?.object === "unregistered";
}

/** `table`'s rows matching `where`; none for a table not registered. */
async function rowsOf(
  tx: TransactionContext,
  table: string,
  where: WhereClause
): Promise<Record<string, unknown>[]> {
  try {
    return await tx.select<Record<string, unknown>>(table, { where });
  } catch (error) {
    if (isUnregisteredTable(error)) return [];
    throw error;
  }
}

/** `table`'s rows whose `column` is one of `ids`, in bounded statements. */
async function rowsWhereIn(
  tx: TransactionContext,
  table: string,
  column: string,
  ids: readonly string[],
  also: WhereClause["and"] = []
): Promise<Record<string, unknown>[]> {
  const found: Record<string, unknown>[] = [];
  for (let at = 0; at < ids.length; at += ID_CHUNK) {
    const where: WhereClause = {
      and: [
        ...(also ?? []),
        { column, op: "IN", value: ids.slice(at, at + ID_CHUNK) },
      ],
    };
    found.push(...(await rowsOf(tx, table, where)));
  }
  return found;
}

/** The ids of rows read, as text. */
function idsOf(rows: readonly Record<string, unknown>[]): string[] {
  return rows.map(row => String(row.id));
}

/**
 * Adds `rows` of `table` to `kept` with their rows in each language: the
 * companion is keyed by its parent's id, and the database removes its rows
 * with the parent's.
 */
async function keepWithLanguages(
  tx: TransactionContext,
  kept: KeptTableRows[],
  table: string,
  rows: readonly Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;
  kept.push({ table, rows: rows.map(keepRow) });
  const companion = `${table}${STORAGE_FORMAT.companionSuffix}`;
  const languages = await rowsWhereIn(
    tx,
    companion,
    COMPANION_PARENT_COLUMN,
    idsOf(rows)
  );
  if (languages.length > 0) {
    kept.push({ table: companion, rows: languages.map(keepRow) });
  }
}

/**
 * The field-group rows beneath `parentIds` of `parentTable`, at every depth:
 * each level is looked for in every field group's table, as the delete's
 * walk looks, since a row's parent is where it was written, whatever the
 * definitions place now.
 */
async function keepFieldGroupRows(
  tx: TransactionContext,
  kept: KeptTableRows[],
  input: Pick<CaptureEntryInput, "fieldGroupTables">,
  parentTable: string,
  parentIds: readonly string[],
  reached: Set<string>
): Promise<void> {
  const fresh = parentIds.filter(id => !reached.has(`${parentTable}:${id}`));
  if (fresh.length === 0) return;
  for (const id of fresh) reached.add(`${parentTable}:${id}`);
  for (const table of input.fieldGroupTables) {
    const rows = await rowsWhereIn(
      tx,
      table,
      STORAGE_FORMAT.columns.parentId,
      fresh,
      [
        {
          column: STORAGE_FORMAT.columns.parentTable,
          op: "=",
          value: parentTable,
        },
      ]
    );
    if (rows.length === 0) continue;
    await keepWithLanguages(tx, kept, table, rows);
    await keepFieldGroupRows(tx, kept, input, table, idsOf(rows), reached);
  }
}

/**
 * The links each many-to-many field holds, read from its junction as the
 * relationship service names it. A junction not there yet holds none.
 */
async function linksOf(
  tx: TransactionContext,
  input: CaptureEntryInput
): Promise<KeptLinks[]> {
  const links: KeptLinks[] = [];
  for (const field of input.fields) {
    if (!usesJunctionTable(field)) continue;
    const options = (field.options ?? {}) as { target?: unknown };
    if (typeof options.target !== "string" || options.target === "") continue;
    const targetSlug = options.target;
    const table = junctionTableTo(input.tableName, targetSlug, field);
    if (!(await input.tableExists(table))) continue;
    const { sourceColumn, targetColumn } = junctionLinkColumnsOf(
      input.tableName,
      targetSlug
    );
    // The junction is not a registered table, so it is read with a built
    // statement, as the relationship service reads it.
    const rows = await tx.queryStatement<Record<string, unknown>>(
      sql`SELECT ${sql.identifier(targetColumn)} AS target_id FROM ${sql.identifier(table)} WHERE ${sql.identifier(sourceColumn)} = ${input.entryId} ORDER BY ${sql.identifier("created_at")}, ${sql.identifier("id")}`
    );
    if (rows.length === 0) continue;
    links.push({
      table,
      sourceColumn,
      targetColumn,
      targetSlug,
      targetIds: rows.map(row => String(row.target_id)),
    });
  }
  return links;
}

/**
 * The core tables keeping rows about the document that its delete removes and
 * a restore puts back, each with how it names the document: where its
 * translated values came from and their source text, and the media its
 * values use.
 */
function documentRecordTables(
  input: Pick<CaptureEntryInput, "collection" | "entryId">
): { table: string; where: WhereClause }[] {
  const translationWhere: WhereClause = {
    and: [
      { column: "scopeKind", op: "=", value: "collection" },
      { column: "scopeSlug", op: "=", value: input.collection },
      { column: "entryId", op: "=", value: input.entryId },
    ],
  };
  return [
    { table: TRANSLATION_PROVENANCE_TABLE, where: translationWhere },
    { table: TRANSLATION_SOURCES_TABLE, where: translationWhere },
    {
      table: MEDIA_USAGE_TABLE,
      where: {
        and: [
          { column: "subjectKind", op: "=", value: "collection" },
          { column: "subjectSlug", op: "=", value: input.collection },
          { column: "documentId", op: "=", value: input.entryId },
        ],
      },
    },
  ];
}

/** The document's rows in {@link documentRecordTables}. */
async function keepDocumentRecords(
  tx: TransactionContext,
  kept: KeptTableRows[],
  input: CaptureEntryInput
): Promise<void> {
  for (const { table, where } of documentRecordTables(input)) {
    // Asked first: a statement against a table not there yet would abort
    // the transaction on PostgreSQL.
    if (!(await input.tableExists(table))) continue;
    const rows = await rowsOf(tx, table, where);
    if (rows.length > 0) kept.push({ table, rows: rows.map(keepRow) });
  }
}

/**
 * Every row `input.entryId` stores, read on `tx`. The entry's own table comes
 * first; undefined when its row is not there.
 */
export async function captureEntry(
  tx: TransactionContext,
  input: CaptureEntryInput
): Promise<CapturedEntry | undefined> {
  const own = await rowsOf(tx, input.tableName, {
    and: [{ column: "id", op: "=", value: input.entryId }],
  });
  if (own.length === 0) return undefined;
  const tables: KeptTableRows[] = [];
  await keepWithLanguages(tx, tables, input.tableName, own);
  await keepFieldGroupRows(
    tx,
    tables,
    input,
    input.tableName,
    [input.entryId],
    new Set()
  );
  await keepDocumentRecords(tx, tables, input);
  return { tables, links: await linksOf(tx, input) };
}
