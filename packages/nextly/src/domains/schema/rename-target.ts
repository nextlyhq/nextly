/**
 * A column rename is checked before it runs.
 *
 * A rename moves a field's values from one column to another: within a table, or, for a field that
 * leaves or joins translation as it is renamed, from one table to the other (the main table and its
 * `_locales` companion). When the new column is already there, the move cannot be made without
 * losing or taking over one of the two columns, so the change is refused before any of it runs,
 * naming the table and both columns. A move an earlier, stopped run of the same change already made
 * (the old column gone) is not refused: there is nothing left to move.
 *
 * Column names are compared as the database compares them: without regard to case on MySQL and
 * SQLite, exactly on PostgreSQL, whose generated names are quoted.
 *
 * And a database's report that a rename's target exists is a failure, never a step an earlier run
 * already applied: `isRenameStatement` names the statements whose refusal is never passed over.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";
import type { FieldDefinition } from "../../schemas/dynamic-collections";

import { queryLiveColumnTypes } from "./pipeline/live-column-types";
import {
  getColumnDescriptor,
  type ColumnOrigin,
} from "./services/field-column-descriptor";

/** Where a comment that starts at `i` ends (the index after it), or -1 when none starts there. */
function commentEnd(sql: string, i: number): number {
  if (sql.startsWith("--", i)) {
    const end = sql.indexOf("\n", i);
    return end === -1 ? sql.length : end;
  }
  if (sql.startsWith("/*", i)) {
    const end = sql.indexOf("*/", i + 2);
    return end === -1 ? sql.length : end + 2;
  }
  return -1;
}

/**
 * The index of the quote closing the literal or identifier `quote` opens at `i`, a doubled quote
 * standing for one, as every generator writes it; the end of `sql` when it never closes.
 */
function quoteEnd(sql: string, i: number, quote: string): number {
  let j = i + 1;
  while (j < sql.length) {
    if (sql[j] !== quote) {
      j += 1;
    } else if (sql[j + 1] === quote) {
      j += 2;
    } else {
      return j;
    }
  }
  return sql.length;
}

const QUOTES = new Set(["'", '"', "`"]);

/**
 * `sql` with each comment, string literal and quoted name blanked (a quote keeps its quotes, its
 * contents become spaces; a comment becomes spaces), so a word inside any of them is never read as
 * a keyword. Lengths are kept.
 */
function keywordsOnly(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const comment = commentEnd(sql, i);
    if (comment !== -1) {
      out += " ".repeat(comment - i);
      i = comment;
      continue;
    }
    const ch = sql[i] ?? "";
    if (!QUOTES.has(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    const end = quoteEnd(sql, i, ch);
    out +=
      ch + " ".repeat(Math.max(0, end - i - 1)) + (end < sql.length ? ch : "");
    i = end + 1;
  }
  return out;
}

/**
 * Whether a statement renames something: a column, a table, an index. A runner that passes over a
 * refusal an earlier run of the same migration explains ("already exists") must not pass over
 * this one's, since "the target already exists" is exactly a rename that could not be made.
 *
 * Read by its keywords alone: a word inside a string literal (a column's default), a comment or a
 * quoted name is not one.
 */
export function isRenameStatement(statement: string): boolean {
  const words = keywordsOnly(statement);
  return (
    (/^\s*ALTER\s+(?:TABLE|INDEX)\b/i.test(words) &&
      /\bRENAME\b/i.test(words)) ||
    /^\s*RENAME\s+TABLE\b/i.test(words)
  );
}

/**
 * A field's values moving from one column to another: within one table for a rename, or from one
 * table to the other for a rename that leaves or joins translation as it is made.
 */
export interface ColumnMove {
  /** The field's name after the change, for the log. */
  field: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

/** A move refused because the column it moves to is already there, and the table holding it. */
export interface TakenMove {
  move: ColumnMove;
  table: string;
}

/**
 * A column name as the dialect compares it: MySQL and SQLite compare without regard to case, so
 * `HEADLINE` and `headline` are one column there; PostgreSQL compares the quoted names exactly.
 */
export function identifierKey(dialect: SupportedDialect, name: string): string {
  return dialect === "postgresql" ? name : name.toLowerCase();
}

/**
 * The moves whose new column is already there while the old one still is. The new column is looked
 * for on the table the move ends on, and, for a move between tables, on the table it starts from
 * too, where its rename may run first. A move whose old column is gone is not among them: an
 * earlier run already made it.
 *
 * @param liveColumns - Each table's columns as they are now, by `identifierKey`.
 */
export function movesOntoTakenColumns(
  moves: readonly ColumnMove[],
  liveColumns: ReadonlyMap<string, ReadonlySet<string>>,
  dialect: SupportedDialect
): TakenMove[] {
  const has = (table: string, column: string) =>
    liveColumns.get(table)?.has(identifierKey(dialect, column)) === true;
  const taken: TakenMove[] = [];
  for (const move of moves) {
    if (!has(move.fromTable, move.fromColumn)) continue;
    const tables =
      move.fromTable === move.toTable
        ? [move.toTable]
        : [move.toTable, move.fromTable];
    const holding = tables.find(table => has(table, move.toColumn));
    if (holding !== undefined) taken.push({ move, table: holding });
  }
  return taken;
}

/** The refusal's message for one move onto a taken column. */
export function renameTargetTakenMessage({ move, table }: TakenMove): string {
  return `Column '${move.fromColumn}' cannot be renamed to '${move.toColumn}': table '${table}' already has a column '${move.toColumn}'. Remove or rename that column first, then save again.`;
}

/**
 * Refuse the moves among `moves` whose new column is already there, reading each table's columns
 * as they are now. Asked before any statement of the change runs; nothing is read when there is no
 * move.
 *
 * @throws NextlyError `VALIDATION_ERROR` with one `RENAME_TARGET_TAKEN` entry per refused move
 */
async function refuseMovesOntoTakenColumns(
  adapter: DrizzleAdapter,
  moves: readonly ColumnMove[],
  logContext: Record<string, unknown>
): Promise<void> {
  if (moves.length === 0) return;
  const dialect = adapter.getCapabilities().dialect;
  const tables = [
    ...new Set(moves.flatMap(move => [move.fromTable, move.toTable])),
  ];
  const live = await queryLiveColumnTypes(
    adapter.getDrizzle(),
    dialect,
    tables
  );
  const liveColumns = new Map(
    [...live].map(([table, columns]) => [
      table,
      new Set([...columns.keys()].map(name => identifierKey(dialect, name))),
    ])
  );
  const taken = movesOntoTakenColumns(moves, liveColumns, dialect);
  if (taken.length === 0) return;
  throw NextlyError.validation({
    errors: taken.map(refused => ({
      path: "fields",
      code: "RENAME_TARGET_TAKEN",
      message: renameTargetTakenMessage(refused),
    })),
    logContext: {
      ...logContext,
      reason: "rename-target-taken",
      moves: taken,
    },
  });
}

/**
 * A schema change as the rename check reads it: the fields before and after, the entity's main
 * table (a translated field's values sit in `<mainTable>_locales`), and whether the entity keeps
 * translatable values per language before and after.
 */
export interface RenamedFieldChange {
  previousFields: FieldDefinition[];
  fields: FieldDefinition[];
  mainTable: string;
  wasLocalized: boolean;
  isLocalized: boolean;
  dialect: SupportedDialect;
  /** What built the entity's tables, which decides the column a field names. */
  builtBy: ColumnOrigin;
}

/**
 * The move a schema change makes of the field it renames, or `null` when it renames none or the
 * rename keeps the column. The renamed field is the one the main table's rule
 * (`detectFieldRename`) finds on the whole field lists, as every Builder road finds it. Its values
 * move from the table holding it before the change to the one holding it after: the companion for
 * a translated field, the main table otherwise (`isFieldLocalized`). The columns are the ones each
 * spelling names (`getColumnDescriptor`), which a companion column mirrors.
 *
 * A dialog asks this of the field lists rather than of the renames it was answered with: when the
 * new column is already there, the change is never offered as a rename at all, only as the old
 * column dropped beside a field kept on the column that is there.
 */
async function renamedFieldMove(
  change: RenamedFieldChange
): Promise<ColumnMove | null> {
  const { DynamicCollectionSchemaService } = await import(
    "../dynamic-collections/services/dynamic-collection-schema-service"
  );
  const rename = new DynamicCollectionSchemaService(
    undefined,
    change.dialect
  ).detectFieldRename(change.previousFields, change.fields);
  if (!rename) return null;
  const fromColumn = getColumnDescriptor(
    rename.from,
    change.dialect,
    change.builtBy
  )?.name;
  const toColumn = getColumnDescriptor(
    rename.to,
    change.dialect,
    change.builtBy
  )?.name;
  if (!fromColumn || !toColumn || fromColumn === toColumn) return null;
  const { isFieldLocalized } = await import("../i18n/classify-fields");
  const companionTable = `${change.mainTable}_locales`;
  return {
    field: rename.to.name,
    fromTable: isFieldLocalized(rename.from, change.wasLocalized)
      ? companionTable
      : change.mainTable,
    fromColumn,
    toTable: isFieldLocalized(rename.to, change.isLocalized)
      ? companionTable
      : change.mainTable,
    toColumn,
  };
}

/**
 * Refuse the field a schema change renames when the column it moves to is already there, before
 * anything of the change is written: the one call every road that applies a change makes.
 *
 * @throws NextlyError `VALIDATION_ERROR` with a `RENAME_TARGET_TAKEN` entry naming the table and
 *   both columns
 */
export async function refuseRenamedFieldOntoTakenColumn(
  adapter: DrizzleAdapter,
  change: RenamedFieldChange,
  logContext: Record<string, unknown>
): Promise<void> {
  const move = await renamedFieldMove(change);
  if (move) await refuseMovesOntoTakenColumns(adapter, [move], logContext);
}
