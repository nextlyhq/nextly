/**
 * A migration run's renames, checked before the run's first statement: a file
 * that renames a column or a table onto one that is already there, while the
 * one it renames still is, is refused, naming the file, the table and both
 * names, and nothing of the run is applied.
 *
 * The database refuses such a rename itself, but only when the statement runs.
 * PostgreSQL and SQLite then roll the file back; MySQL commits each schema
 * statement as it runs, so every statement of the file before the rename stays
 * applied and the run stops part-way. Asked first, the refusal leaves the
 * database as it was on every dialect.
 *
 * A rename is judged against the database as it stands before the run, so
 * only a rename no earlier statement of the run changes the table of: a
 * rename after another change to the same table in the run (an added or
 * dropped column, a table created, dropped or renamed, or a statement this
 * reading cannot place) is left to the runner's failure, as before. Judged
 * this way, a file that would run is never refused. A rename already made (the
 * old name gone, the new one there) is not refused either: there is nothing
 * left to rename.
 *
 * Statements are read through the shared readers (`renamesIn`,
 * `tablesChangedIn`), so a word in a string or a comment is never code.
 *
 * @module domains/schema/migrate/rename-preflight
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { queryLiveColumnTypes } from "../pipeline/live-column-types";
import { readNameHoldersElsewhere } from "../pipeline/live-table-facts";
import { identifierKey } from "../rename-target";

import { cursorOf } from "./statement-cursor";
import {
  renamesIn,
  tablesChangedIn,
  type StatementRename,
} from "./statement-targets";

/** One file of a run as this check reads it: its name and its statements for the dialect. */
export interface RenameUnit {
  label: string;
  statements: readonly string[];
}

/** A rename a run would refuse: the file it is in, the rename, and why. */
export interface TakenRename {
  file: string;
  rename: StatementRename;
  message: string;
}

/** First words of statements that change no table and no column. */
const CHANGES_NO_TABLE: readonly string[][] = [
  ["ALTER", "INDEX"],
  ["COMMENT", "ON"],
  ["PRAGMA"],
  ["CREATE", "TYPE"],
  ["CREATE", "SEQUENCE"],
];

/**
 * Whether `statement` changes no table and no column, though `tablesChangedIn`
 * does not read it: an index dropped or altered (a `DROP INDEX` without
 * CASCADE), a comment, a session setting other than PostgreSQL's
 * `search_path` (which changes the table an unqualified name reaches), or a
 * type or sequence created. Any other statement it cannot read may change any
 * table.
 */
function changesNoTable(statement: string, dialect: SupportedDialect): boolean {
  const cursor = cursorOf(statement, dialect);
  if (cursor.accept("DROP", "INDEX")) return !cursor.rest().includes("CASCADE");
  if (cursor.accept("SET")) return !cursor.rest().includes("SEARCH_PATH");
  return CHANGES_NO_TABLE.some(words => cursor.accept(...words));
}

/** The tables a rename involves: its table, or both of a table's names. */
function tablesOf(rename: StatementRename): string[] {
  return rename.kind === "column" ? [rename.table] : [rename.from, rename.to];
}

/**
 * A statement that renames nothing, read in order: the tables it changes are
 * added to `changed`, or `stop` when it may change any table.
 */
function noteChanges(
  statement: string,
  dialect: SupportedDialect,
  changed: Set<string>
): [] | "stop" {
  const tables = tablesChangedIn(statement, dialect);
  if (tables === undefined) {
    return changesNoTable(statement, dialect) ? [] : "stop";
  }
  for (const table of tables) changed.add(table);
  return [];
}

/**
 * One statement of the run, read in order: the renames it makes that no
 * earlier statement or earlier rename in it changed the table of, or `stop`
 * when it may change any table. The tables it changes are added to `changed`.
 * A rename after another of the same name in one statement, as in MySQL's
 * `RENAME TABLE a TO tmp, b TO a, tmp TO b`, is not judged: the earlier one
 * changes what the name holds.
 */
function judgedIn(
  statement: string,
  dialect: SupportedDialect,
  changed: Set<string>
): StatementRename[] | "stop" {
  const renames = renamesIn(statement, dialect);
  if (renames === undefined) return noteChanges(statement, dialect, changed);
  const judged: StatementRename[] = [];
  for (const rename of renames) {
    const tables = tablesOf(rename);
    if (tables.every(table => !changed.has(table))) judged.push(rename);
    for (const table of tables) changed.add(table);
  }
  return judged;
}

/**
 * The renames of `units`, read in run order, that no earlier statement of the
 * run changes the table of, each with its file (`judgedIn`). Reading stops at
 * a statement that may change any table.
 */
function judgedRenames(
  units: readonly RenameUnit[],
  dialect: SupportedDialect
): { file: string; rename: StatementRename }[] {
  const judged: { file: string; rename: StatementRename }[] = [];
  const changed = new Set<string>();
  for (const { label, statements } of units) {
    for (const statement of statements) {
      const renames = judgedIn(statement, dialect, changed);
      if (renames === "stop") return judged;
      judged.push(...renames.map(rename => ({ file: label, rename })));
    }
  }
  return judged;
}

/** The live tables' columns, each name by `key`. */
type LiveNames = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * What already holds a table rename's new name while the table it renames is
 * still there, said for the refusal, or undefined when nothing does. A table
 * with columns is in `live`. PostgreSQL gives a table the name space of every
 * relation in its schema (an index, a view, a sequence, a table with no
 * column), and SQLite one name space for the whole database, so there the
 * catalog is asked too (`readNameHoldersElsewhere`); on MySQL a view is in
 * `live` with its columns.
 */
async function tableNameHolder(
  rename: Extract<StatementRename, { kind: "table" }>,
  live: LiveNames,
  key: (name: string) => string,
  read: { db: unknown; dialect: SupportedDialect }
): Promise<string | undefined> {
  if (!live.has(key(rename.from))) return undefined;
  if (live.has(key(rename.to))) return `a table '${rename.to}' already exists`;
  const holder = (
    await readNameHoldersElsewhere(read.db, read.dialect, rename.from, [
      rename.to,
    ])
  ).get(rename.to);
  if (holder === undefined) return undefined;
  const article = /^[aeiou]/.test(holder.type) ? "an" : "a";
  return `${article} ${holder.type} '${holder.name}' already exists`;
}

/**
 * Why `rename` is refused, when its new name is taken while its old one is
 * still there; undefined when it is not.
 */
async function takenMessage(
  rename: StatementRename,
  live: LiveNames,
  key: (name: string) => string,
  read: { db: unknown; dialect: SupportedDialect }
): Promise<string | undefined> {
  if (rename.kind === "table") {
    const holder = await tableNameHolder(rename, live, key, read);
    return holder === undefined
      ? undefined
      : `Table '${rename.from}' cannot be renamed to '${rename.to}': ${holder}.`;
  }
  const columns = live.get(key(rename.table));
  return columns?.has(key(rename.from)) === true && columns.has(key(rename.to))
    ? `Column '${rename.from}' cannot be renamed to '${rename.to}': table '${rename.table}' already has a column '${rename.to}'.`
    : undefined;
}

/**
 * The renames of a run's files (`units`, in run order) whose new name is
 * already taken in the database while the old one still is, read before any
 * statement of the run, against the database as it stands (`judgedRenames`).
 * Empty when there is none; nothing is read when the files rename nothing.
 */
export async function renamesOntoTakenTargets(
  units: readonly RenameUnit[],
  db: unknown,
  dialect: SupportedDialect
): Promise<TakenRename[]> {
  const judged = judgedRenames(units, dialect);
  if (judged.length === 0) return [];
  const tables = [...new Set(judged.flatMap(({ rename }) => tablesOf(rename)))];
  const live = await queryLiveColumnTypes(db, dialect, tables);
  const key = (name: string) => identifierKey(dialect, name);
  const liveTables = new Map(
    [...live].map(([table, columns]) => [
      key(table),
      new Set([...columns.keys()].map(key)),
    ])
  );
  const taken: TakenRename[] = [];
  for (const { file, rename } of judged) {
    const message = await takenMessage(rename, liveTables, key, {
      db,
      dialect,
    });
    if (message !== undefined) taken.push({ file, rename, message });
  }
  return taken;
}

/**
 * Refuse a run, before any of its statements, when one of its files renames a
 * column or a table onto one already there (`renamesOntoTakenTargets`).
 *
 * @throws NextlyError `VALIDATION_ERROR` with a `RENAME_TARGET_TAKEN` entry per
 *   refused rename, naming its file
 */
export async function refuseRenamesOntoTakenTargets(
  units: readonly RenameUnit[],
  db: unknown,
  dialect: SupportedDialect
): Promise<void> {
  const taken = await renamesOntoTakenTargets(units, db, dialect);
  if (taken.length === 0) return;
  const sentences = taken
    .map(({ file, message }) => `${file}: ${message}`)
    .join(" ");
  throw new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage: `The run was refused before any of its statements ran, and nothing of it was applied. ${sentences} Remove or rename what holds the new name, or change the migration, then run it again.`,
    publicData: {
      errors: taken.map(({ file, message }) => ({
        path: file,
        code: "RENAME_TARGET_TAKEN",
        message,
      })),
    },
    logContext: {
      reason: "rename-target-taken",
      renames: taken.map(({ file, rename }) => ({ file, ...rename })),
    },
  });
}
