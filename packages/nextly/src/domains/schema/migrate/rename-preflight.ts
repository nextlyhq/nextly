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

/**
 * Whether `statement` changes no table and no column, though `tablesChangedIn`
 * does not read it: an index dropped or altered (a `DROP INDEX` without
 * CASCADE), a comment, a session setting, or a type or sequence created. Any
 * other statement it cannot read may change any table.
 */
function changesNoTable(statement: string, dialect: SupportedDialect): boolean {
  const cursor = cursorOf(statement, dialect);
  if (cursor.accept("DROP", "INDEX")) {
    return !cursor.rest().some(token => token === "CASCADE");
  }
  return (
    cursor.accept("ALTER", "INDEX") ||
    cursor.accept("COMMENT", "ON") ||
    cursor.accept("SET") ||
    cursor.accept("PRAGMA") ||
    cursor.accept("CREATE", "TYPE") ||
    cursor.accept("CREATE", "SEQUENCE")
  );
}

/** The tables a rename involves: its table, or both of a table's names. */
function tablesOf(rename: StatementRename): string[] {
  return rename.kind === "column" ? [rename.table] : [rename.from, rename.to];
}

/**
 * One statement of the run, read in order: the renames it makes that no
 * earlier statement changed the table of, or `stop` when it may change any
 * table. The tables it changes are added to `changed`.
 */
function judgedIn(
  statement: string,
  dialect: SupportedDialect,
  changed: Set<string>
): StatementRename[] | "stop" {
  const renames = renamesIn(statement, dialect);
  const tables =
    renames?.flatMap(tablesOf) ?? tablesChangedIn(statement, dialect);
  if (tables === undefined) {
    return changesNoTable(statement, dialect) ? [] : "stop";
  }
  const judged = (renames ?? []).filter(rename =>
    tablesOf(rename).every(table => !changed.has(table))
  );
  for (const table of tables) changed.add(table);
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

/** Whether `rename`'s new name is taken while its old one is still there, in `live` (by `key`). */
function isTaken(
  rename: StatementRename,
  live: ReadonlyMap<string, ReadonlySet<string>>,
  key: (name: string) => string
): boolean {
  if (rename.kind === "table") {
    return live.has(key(rename.from)) && live.has(key(rename.to));
  }
  const columns = live.get(key(rename.table));
  return columns?.has(key(rename.from)) === true && columns.has(key(rename.to));
}

/** Why `rename` is refused, given where its new name is taken. */
function takenMessage(rename: StatementRename): string {
  return rename.kind === "column"
    ? `Column '${rename.from}' cannot be renamed to '${rename.to}': table '${rename.table}' already has a column '${rename.to}'.`
    : `Table '${rename.from}' cannot be renamed to '${rename.to}': a table '${rename.to}' already exists.`;
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
    if (isTaken(rename, liveTables, key)) {
      taken.push({ file, rename, message: takenMessage(rename) });
    }
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
