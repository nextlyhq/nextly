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

import { queryLiveColumnTypes } from "./pipeline/live-column-types";

/**
 * `sql` with each string literal's contents and each comment blanked (`'...'` keeps its quotes,
 * a comment becomes spaces), and, when `identifiers` is set, each quoted identifier's contents too,
 * so a word inside any of them is never read as SQL. Lengths are kept. A doubled quote inside a
 * literal or an identifier stands for one, as every generator writes it.
 */
function blankQuotedAndComments(sql: string, identifiers: boolean): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i] ?? "";
    const next = sql[i + 1] ?? "";
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const blank = ch === "'" || identifiers;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      const inside = sql.slice(i + 1, j);
      out += ch + (blank ? " ".repeat(inside.length) : inside);
      if (j < sql.length) out += ch;
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
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
  const words = blankQuotedAndComments(statement, true);
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
export async function refuseMovesOntoTakenColumns(
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
