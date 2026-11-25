/**
 * Where a language code's older spelling (`pt_BR`) is still stored: the one answer to "has this
 * code's content been moved to its standard form yet", for the start that refuses to serve a site
 * whose rows are still under the older spelling, and for `nextly migrate`, whose data steps move them.
 *
 * @module domains/i18n/older-codes
 */
import { createHash } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { MEDIA_USAGE_TABLE } from "../../schemas/media-usage/table-name";
import { TRANSLATION_PROVENANCE_TABLE } from "../../schemas/translation-provenance/table-name";
import { TRANSLATION_SOURCES_TABLE } from "../../schemas/translation-sources/table-name";
import { VERSIONS_TABLE } from "../../schemas/versions/types";
import { introspectLiveColumns } from "../schema/pipeline/diff/introspect-live";

import { standardLanguageCode } from "./config/standard-code";

/**
 * A column a language code is stored in: one code, written after `prefix` where it has one, or a
 * JSON list of codes (`list`).
 */
interface CodeColumn {
  table: string;
  column: string;
  prefix?: string;
  list?: true;
}

/**
 * Every column a code is stored in besides the translation tables' `_locale`, each one the
 * conversion rewrites: the versions, by their language and the list of languages each records it
 * changed; a pinned base kept for a language's pending change (its slot); each translation's
 * record of where it came from, and the source text it was made from; the archive of removed
 * translations; the releases' members; and each media use and preview link in a language.
 */
const CODE_COLUMNS: readonly CodeColumn[] = [
  { table: VERSIONS_TABLE, column: "locale" },
  { table: VERSIONS_TABLE, column: "changed_locales", list: true },
  { table: "nextly_version_pins", column: "slot", prefix: "pending:" },
  { table: TRANSLATION_PROVENANCE_TABLE, column: "locale" },
  { table: TRANSLATION_PROVENANCE_TABLE, column: "source_locale" },
  { table: TRANSLATION_SOURCES_TABLE, column: "source_locale" },
  { table: "nextly_i18n_archive", column: "locale" },
  { table: "nextly_release_members", column: "locale" },
  { table: MEDIA_USAGE_TABLE, column: "locale" },
  { table: "nextly_preview_links", column: "locale" },
];

/**
 * The columns of `CODE_COLUMNS` and of the translation tables `translationTables` that the
 * database has. A table or a column an earlier release did not have yet holds no code, where
 * reading it would fail: the versions' list of changed languages comes with this release's
 * migrations.
 */
async function codeColumnsOn(
  adapter: DrizzleAdapter,
  translationTables: readonly string[]
): Promise<CodeColumn[]> {
  const present: CodeColumn[] = translationTables.map(table => ({
    table,
    column: "_locale",
  }));
  const tables = [...new Set(CODE_COLUMNS.map(({ table }) => table))];
  const existing = new Set<string>();
  for (const table of tables) {
    if (await adapter.tableExists(table)) existing.add(table);
  }
  // Only a list column's table is read for its columns: the others are as old as their tables.
  const listTables = [
    ...new Set(
      CODE_COLUMNS.filter(({ list, table }) => list && existing.has(table)).map(
        ({ table }) => table
      )
    ),
  ];
  const { tables: live } = await introspectLiveColumns(
    adapter.getDrizzle(),
    adapter.dialect,
    listTables
  );
  const listColumns = new Set(
    live.flatMap(({ name, columns }) =>
      columns.map(column => `${name}.${column.name}`)
    )
  );
  for (const place of CODE_COLUMNS) {
    if (!existing.has(place.table)) continue;
    if (place.list && !listColumns.has(`${place.table}.${place.column}`)) {
      continue;
    }
    present.push(place);
  }
  return present;
}

/** A list column's text, which every dialect can match with LIKE: JSON on PostgreSQL and MySQL. */
function asText(adapter: DrizzleAdapter, column: string) {
  const type = sql.raw(adapter.dialect === "mysql" ? "CHAR" : "TEXT");
  return sql`CAST(${sql.identifier(column)} AS ${type})`;
}

/** `text` as LIKE matches it literally, through the escape character `!`. */
function likeLiteral(text: string): string {
  return text.replace(/[!%_]/g, character => `!${character}`);
}

/** The codes of a list column's stored text; a list that cannot be read names none. */
function codesOfList(text: string): string[] {
  try {
    const list: unknown = JSON.parse(text);
    return Array.isArray(list)
      ? list.filter((code): code is string => typeof code === "string")
      : [];
  } catch {
    return [];
  }
}

/** Whether `place` holds `code`: as its one code, or in its list. */
async function holdsCode(
  adapter: DrizzleAdapter,
  place: CodeColumn,
  code: string
): Promise<boolean> {
  // A list is matched by the code as its JSON writes it, quotes included: that code, not one it begins.
  const where = place.list
    ? sql`${asText(adapter, place.column)} LIKE ${`%${likeLiteral(JSON.stringify(code))}%`} ESCAPE '!'`
    : sql`${sql.identifier(place.column)} = ${`${place.prefix ?? ""}${code}`}`;
  const rows = await adapter.queryStatement<{ found: unknown }>(
    sql`SELECT 1 AS ${sql.identifier("found")} FROM ${sql.identifier(place.table)} WHERE ${where} LIMIT 1`
  );
  return rows.length > 0;
}

/**
 * The tables still holding a row under `code`: each of the translation tables `translationTables`
 * keeps its language in `_locale`, and every other table the code is stored in (`CODE_COLUMNS`).
 */
export async function tablesHoldingCode(
  adapter: DrizzleAdapter,
  translationTables: readonly string[],
  code: string
): Promise<string[]> {
  const holding: string[] = [];
  for (const place of await codeColumnsOn(adapter, translationTables)) {
    if (holding.includes(place.table)) continue;
    if (await holdsCode(adapter, place, code)) holding.push(place.table);
  }
  return holding;
}

/** A code stored the earlier way, and the configured code it is read as. */
export interface StoredOlderSpelling {
  from: string;
  to: string;
}

/** The codes with an underscore that `place` holds, as stored: its own codes, or its lists'. */
async function underscoredCodesIn(
  adapter: DrizzleAdapter,
  place: CodeColumn
): Promise<string[]> {
  // `_` is LIKE's single-character wildcard, so it is matched through an escape character.
  const pattern = `${likeLiteral(place.prefix ?? "")}%!_%`;
  const value = place.list
    ? asText(adapter, place.column)
    : sql.identifier(place.column);
  const where = sql`${value} LIKE ${pattern} ESCAPE '!'`;
  // Asked first whether it holds any at all, stopping at the first row.
  const any = await adapter.queryStatement<{ found: unknown }>(
    sql`SELECT 1 AS ${sql.identifier("found")} FROM ${sql.identifier(place.table)} WHERE ${where} LIMIT 1`
  );
  if (any.length === 0) return [];
  const rows = await adapter.queryStatement<{ held: unknown }>(
    sql`SELECT DISTINCT ${value} AS ${sql.identifier("held")} FROM ${sql.identifier(place.table)} WHERE ${where}`
  );
  const codes: string[] = [];
  for (const { held } of rows) {
    if (typeof held !== "string") continue;
    if (!place.list) {
      codes.push(held.slice((place.prefix ?? "").length));
      continue;
    }
    // A list matched for one code with an underscore can hold codes without one beside it
    // (`["fr-FR", "pt_BR"]`): only those with one are older spellings.
    codes.push(...codesOfList(held).filter(code => code.includes("_")));
  }
  return codes;
}

/**
 * What a stored code is as the database compares codes (`codesFoldCase`): where it compares them
 * without regard to letter case, `pt_BR` and `PT_br` are one spelling, and one conversion rewrites
 * the rows of both; elsewhere they are two. The one rule the scan and every rewrite of a list of
 * codes compare by, so a spelling the scan takes as one is rewritten wherever it is stored.
 */
export function storedCodeKey(foldsCase: boolean, code: string): string {
  return foldsCase ? code.toLowerCase() : code;
}

/** Whether `a` and `b` are one stored code as the database compares codes (`storedCodeKey`). */
export function sameStoredCode(
  foldsCase: boolean,
  a: string,
  b: string
): boolean {
  return storedCodeKey(foldsCase, a) === storedCodeKey(foldsCase, b);
}

/**
 * Whether the database compares stored codes without regard to letter case. PostgreSQL and SQLite
 * never do. MySQL compares by each column's collation: a case-insensitive one (`..._ci`, the
 * default) folds case, a binary or case-sensitive one (`utf8mb4_bin`, `..._cs`) keeps `pt_BR` and
 * `PT_br` apart. Case is folded only where every code column the scan reads folds it, so a column
 * that keeps the two apart has each found, and a document kept under both is refused, rather than
 * one of them converted and the other left. A list of codes is read as text in the connection's
 * collation, so only the plain code columns decide.
 */
export async function codesFoldCase(
  adapter: DrizzleAdapter,
  translationTables: readonly string[]
): Promise<boolean> {
  if (adapter.dialect !== "mysql") return false;
  const places = (await codeColumnsOn(adapter, translationTables)).filter(
    place => place.list !== true
  );
  const folds = await columnsFoldingCase(adapter, places);
  return places.every(place => folds(place));
}

/**
 * Which of `places`' code columns compare codes without regard to letter case, one column at a
 * time: on MySQL a column of a case-insensitive collation (`..._ci`), and one whose collation could
 * not be read, as the database's default is; on PostgreSQL and SQLite none. What a check of one
 * column asks, where a site mixes collations: on a case-insensitive column `pt_BR` and `PT_br`
 * match the same row, so the two are one stored code there and never a pair of rows.
 */
export async function columnsFoldingCase(
  adapter: DrizzleAdapter,
  places: readonly { table: string; column: string }[]
): Promise<(place: { table: string; column: string }) => boolean> {
  if (adapter.dialect !== "mysql") return () => false;
  if (places.length === 0) return () => true;
  const tables = [...new Set(places.map(({ table }) => table))];
  const columns = [...new Set(places.map(({ column }) => column))];
  const rows = await adapter.queryStatement<{
    tableName: string;
    columnName: string;
    collation: string | null;
  }>(
    sql`SELECT TABLE_NAME AS ${sql.identifier("tableName")}, COLUMN_NAME AS ${sql.identifier("columnName")}, COLLATION_NAME AS ${sql.identifier("collation")} FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${sql.join(
      tables.map(table => sql`${table}`),
      sql`, `
    )}) AND COLUMN_NAME IN (${sql.join(
      columns.map(column => sql`${column}`),
      sql`, `
    )})`
  );
  const keepsCase = new Set(
    rows
      .filter(
        row =>
          row.collation !== null && !row.collation.toLowerCase().endsWith("_ci")
      )
      .map(row => `${row.tableName}.${row.columnName}`)
  );
  return ({ table, column }) => !keepsCase.has(`${table}.${column}`);
}

/**
 * Each of `codes` that has a part after its language, lower-cased, mapped to the code: what a
 * stored spelling is looked up by once read as the conversion reads it (`standardLanguageCode`,
 * every underscore a hyphen). Empty where no code has such a part, and then no row can be stored
 * under an older spelling of a configured language.
 */
export function olderSpellingsOf(
  codes: readonly string[]
): Map<string, string> {
  return new Map(
    codes
      .filter(code => code.includes("-"))
      .map(code => [code.toLowerCase(), code] as const)
  );
}

/**
 * The older spellings of `codes` that rows are still stored under, found from the rows rather than
 * the configuration: a configuration already corrected to the standard code no longer names them.
 * Read from every column the conversion rewrites (`tablesHoldingCode`'s), the translation tables
 * `translationTables` included, so a spelling left only in a version or the archive is found too.
 * Only an underscore is ever converted (`standardLanguageCode`), so an older spelling of `pt-BR`
 * is `pt_BR` in any letter case.
 */
export async function storedOlderSpellings(
  adapter: DrizzleAdapter,
  translationTables: readonly string[],
  codes: readonly string[]
): Promise<StoredOlderSpelling[]> {
  const byLowered = olderSpellingsOf(codes);
  if (byLowered.size === 0) return [];
  // One conversion for each spelling as the database tells spellings apart (`storedCodeKey`).
  const foldsCase = await codesFoldCase(adapter, translationTables);
  const keyOf = (code: string) => storedCodeKey(foldsCase, code);
  const found = new Map<string, StoredOlderSpelling>();
  for (const place of await codeColumnsOn(adapter, translationTables)) {
    for (const code of await underscoredCodesIn(adapter, place)) {
      // Read as the conversion reads it (`standardLanguageCode`): every underscore a hyphen, so a
      // spelling that mixes the two (`zh_Hant-TW`) is found as the one it converts to.
      const to = byLowered.get(
        (standardLanguageCode(code) ?? code).toLowerCase()
      );
      // A code already in the form it is read as is no older spelling of it.
      if (to === undefined || to === code || found.has(keyOf(code))) continue;
      found.set(keyOf(code), { from: code, to });
    }
  }
  return [...found.values()];
}

/**
 * The `nextly_meta` key recording that the database was found to hold no row under an older
 * spelling of the configured languages, and the value it records: those languages, so a change to
 * them is scanned for again.
 */
export const OLDER_CODES_CHECKED_KEY = "i18n.olderCodesChecked";

/**
 * The columns the scan read when a database recorded it, as a short fingerprint of `CODE_COLUMNS`.
 * A database whose record was written over fewer columns is scanned again once, so a spelling only
 * the newer columns hold is found; derived from the list, a column added to it does the same.
 */
const SCANNED_COLUMNS = createHash("sha256")
  .update(
    CODE_COLUMNS.map(({ table, column }) => `${table}.${column}`).join(",")
  )
  .digest("hex")
  .slice(0, 12);

/**
 * The value `OLDER_CODES_CHECKED_KEY` records for `codes`: one per configured language set and
 * set of columns scanned (`SCANNED_COLUMNS`).
 */
export function olderCodesCheckedFor(codes: readonly string[]): string {
  return `${SCANNED_COLUMNS}:${[...new Set(codes)].sort().join(",")}`;
}
