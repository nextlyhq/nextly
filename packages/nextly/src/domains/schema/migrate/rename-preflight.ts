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
 * only where nothing earlier in the run could have changed what its names
 * hold. Judged this way, a file that would run is never refused, and the check
 * is not a guarantee: these renames are left to the runner's failure, as
 * before.
 *
 * - A rename after another change to its table in the run: an added or dropped
 *   column, a table created, dropped or renamed (an earlier pair of the same
 *   MySQL `RENAME TABLE` included).
 * - Every rename after a statement this reading cannot place, or after a
 *   `SET search_path` / `SET SCHEMA` on PostgreSQL.
 * - On PostgreSQL and SQLite, a table's rename after an index, sequence or type
 *   is created, dropped or renamed: they share a table's name space.
 * - On a MySQL server comparing table names by case
 *   (`lower_case_table_names=0`), every table rename (`judgedOnThisServer`).
 * - A rename onto a name held only by what the live readers do not describe: a
 *   SQLite generated column, a relation outside PostgreSQL's current schema, or
 *   a PostgreSQL type's name (an enum, a domain, a composite type).
 * - A rename onto a system column the run adds before its files (such as
 *   `_revision`): the files are judged against the database as they find it.
 * - Every rename after a PostgreSQL `SET ROLE` or `SET SESSION AUTHORIZATION`,
 *   which a `$user` in the search path follows.
 * - A table renamed onto the name of one of its own indexes (PostgreSQL,
 *   SQLite): the catalog lookup leaves a table's own indexes out.
 * - On a MySQL server comparing table names by case, a column rename on a
 *   table spelled in another case than lower: the name is read lower-cased.
 * - On SQLite, a rename between spellings that differ only in the case of a
 *   letter outside ASCII (`Ä`, `ä`): names are read lower-cased, while SQLite
 *   folds ASCII letters only.
 * - A plugin module's rename whose old and new names its snapshot, or a later
 *   pending module's, holds together: a run finding the database there adopts
 *   the modules without running them (`RenameUnit.adoptableAt`).
 *
 * A rename already made (the old name gone, the new one there) is not refused
 * either: there is nothing left to rename.
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
import { readIdentifierCaseRules } from "../utils/read-identifier-case";

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
  /**
   * For a plugin's module: the schemas a run may find already in place and
   * record it at without running it (its snapshot and each later pending
   * module's). A rename whose old and new names one of them holds together is
   * not judged: the database standing there is adopted, not renamed.
   */
  adoptableAt?: readonly SchemaShape[];
}

/** A schema as a module's snapshot describes it: each table's name and its columns' names. */
export interface SchemaShape {
  tables: readonly { name: string; columns: readonly { name: string }[] }[];
}

/** A rename a run would refuse: the file it is in, the rename, and why. */
export interface TakenRename {
  file: string;
  rename: StatementRename;
  message: string;
}

/**
 * Words of a PostgreSQL setting that change which table an unqualified name
 * reaches: `search_path` and its alias `SCHEMA`, and the role (`SET ROLE`,
 * `SET SESSION AUTHORIZATION`), which a `$user` in the search path follows.
 */
const REROUTING_SETTINGS: ReadonlySet<string> = new Set([
  "SEARCH_PATH",
  "SCHEMA",
  "ROLE",
  "AUTHORIZATION",
]);

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
 * CASCADE), a comment, a session setting other than those changing which table
 * an unqualified name reaches (`REROUTING_SETTINGS`), or a type or sequence
 * created. Any other statement it cannot read may change any table.
 */
function changesNoTable(statement: string, dialect: SupportedDialect): boolean {
  const cursor = cursorOf(statement, dialect);
  if (cursor.accept("DROP", "INDEX")) return !cursor.rest().includes("CASCADE");
  if (cursor.accept("SET")) {
    return !cursor
      .rest()
      .some(token => REROUTING_SETTINGS.has(token as string));
  }
  return CHANGES_NO_TABLE.some(words => cursor.accept(...words));
}

/** First words of statements that create, drop or rename a relation other than a table. */
const NAMES_A_RELATION: readonly string[][] = [
  ["CREATE", "INDEX"],
  ["CREATE", "UNIQUE", "INDEX"],
  ["DROP", "INDEX"],
  ["ALTER", "INDEX"],
  ["CREATE", "SEQUENCE"],
  ["CREATE", "TYPE"],
];

/**
 * Whether `statement` changes which names relations other than tables hold,
 * where a table shares their name space: PostgreSQL gives every relation of a
 * schema one name space (an index, a sequence, a composite type), SQLite one
 * for the whole database. MySQL names an index per table, so nothing there.
 */
function namesARelation(statement: string, dialect: SupportedDialect): boolean {
  if (dialect === "mysql") return false;
  const cursor = cursorOf(statement, dialect);
  if (NAMES_A_RELATION.some(words => cursor.accept(...words))) return true;
  // `ALTER TABLE … SET SCHEMA` takes the table's indexes and sequences with it.
  return cursor.accept("ALTER", "TABLE") && cursor.rest().includes("SCHEMA");
}

/**
 * Whether one of `schemas` holds both of `rename`'s names together: both
 * columns on its table, or both tables.
 */
function heldTogether(
  rename: StatementRename,
  schemas: readonly SchemaShape[],
  dialect: SupportedDialect
): boolean {
  const key = (name: string) => identifierKey(dialect, name);
  return schemas.some(({ tables }) => {
    if (rename.kind === "table") {
      const names = new Set(tables.map(table => key(table.name)));
      return names.has(key(rename.from)) && names.has(key(rename.to));
    }
    const table = tables.find(t => key(t.name) === key(rename.table));
    const columns = new Set(table?.columns.map(c => key(c.name)) ?? []);
    return columns.has(key(rename.from)) && columns.has(key(rename.to));
  });
}

/**
 * Whether `rename` names the one identifier twice, as the dialect compares
 * names (`a TO a`, or `a TO A` without regard to case): a rename that changes
 * nothing, which a database may run, so its new name is never judged taken by
 * the column or table it renames.
 */
function keepsItsName(
  rename: StatementRename,
  dialect: SupportedDialect
): boolean {
  return (
    identifierKey(dialect, rename.from) === identifierKey(dialect, rename.to)
  );
}

/** The tables a rename involves: its table, or both of a table's names. */
function tablesOf(rename: StatementRename): string[] {
  return rename.kind === "column" ? [rename.table] : [rename.from, rename.to];
}

/**
 * What the run's statements read so far have changed: the tables, and whether
 * a relation's name (an index's, a sequence's) changed, after which a table's
 * new name is no longer judged against the catalog as the run found it.
 */
interface RunChanges {
  tables: Set<string>;
  relationNames: boolean;
}

/**
 * A statement that renames nothing, read in order: what it changes is added to
 * `changes`, or `stop` when it may change any table.
 */
function noteChanges(
  statement: string,
  dialect: SupportedDialect,
  changes: RunChanges
): [] | "stop" {
  if (namesARelation(statement, dialect)) changes.relationNames = true;
  const tables = tablesChangedIn(statement, dialect);
  if (tables === undefined) {
    return changesNoTable(statement, dialect) ? [] : "stop";
  }
  for (const table of tables) changes.tables.add(table);
  return [];
}

/**
 * One statement of the run, read in order: the renames it makes that no
 * earlier statement or earlier rename in it changed the table of, or `stop`
 * when it may change any table. What it changes is added to `changes`. A
 * rename after another of the same name in one statement, as in MySQL's
 * `RENAME TABLE a TO tmp, b TO a, tmp TO b`, is not judged: the earlier one
 * changes what the name holds. Nor is a table's rename after a relation's name
 * changed (`namesARelation`).
 */
function judgedIn(
  statement: string,
  dialect: SupportedDialect,
  changes: RunChanges
): StatementRename[] | "stop" {
  const renames = renamesIn(statement, dialect);
  if (renames === undefined) return noteChanges(statement, dialect, changes);
  const judged: StatementRename[] = [];
  for (const rename of renames) {
    const tables = tablesOf(rename);
    const unchanged =
      tables.every(table => !changes.tables.has(table)) &&
      !(rename.kind === "table" && changes.relationNames);
    if (unchanged && !keepsItsName(rename, dialect)) judged.push(rename);
    for (const table of tables) changes.tables.add(table);
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
  const changes: RunChanges = { tables: new Set(), relationNames: false };
  for (const { label, statements, adoptableAt = [] } of units) {
    for (const statement of statements) {
      const renames = judgedIn(statement, dialect, changes);
      if (renames === "stop") return judged;
      for (const rename of renames) {
        if (!heldTogether(rename, adoptableAt, dialect)) {
          judged.push({ file: label, rename });
        }
      }
    }
  }
  return judged;
}

/**
 * `judged` as this server can judge it: a MySQL server comparing table names
 * by their case (`lower_case_table_names=0`) keeps its table renames out,
 * since a statement's names are read lower-cased and the case it wrote them in
 * is not known (`notes TO Archive` beside an `archive` is a rename it runs).
 * Column names compare without case on every MySQL server, so those stay.
 */
async function judgedOnThisServer(
  judged: { file: string; rename: StatementRename }[],
  db: unknown,
  dialect: SupportedDialect
): Promise<{ file: string; rename: StatementRename }[]> {
  if (dialect !== "mysql" || judged.every(j => j.rename.kind === "column")) {
    return judged;
  }
  const rules = await readIdentifierCaseRules({
    dialect,
    getDrizzle: <T>() => db as T,
  });
  return rules.tables === "preserve"
    ? judged.filter(j => j.rename.kind === "column")
    : judged;
}

/** The live tables' columns, each name by `key`. */
type LiveNames = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * What already holds a table rename's new name while the table it renames is
 * still there, said for the refusal, or undefined when nothing does. A table
 * with columns is in `live`. PostgreSQL gives a table the name space of every
 * relation in its schema (an index, a view, a sequence, a table with no
 * column), and SQLite one name space for the whole database, so there the
 * catalog is asked too (`readNameHoldersElsewhere`), for the table renamed as
 * well, which is not in `live` when it has no column; on MySQL a view is in
 * `live` with its columns.
 */
async function tableNameHolder(
  rename: Extract<StatementRename, { kind: "table" }>,
  live: LiveNames,
  key: (name: string) => string,
  read: { db: unknown; dialect: SupportedDialect }
): Promise<string | undefined> {
  const holders = await readNameHoldersElsewhere(
    read.db,
    read.dialect,
    rename.from,
    [rename.from, rename.to]
  );
  const renamedIsThere =
    live.has(key(rename.from)) || holders.get(rename.from)?.type === "table";
  if (!renamedIsThere) return undefined;
  if (live.has(key(rename.to))) return `a table '${rename.to}' already exists`;
  const holder = holders.get(rename.to);
  // SQLite keeps a trigger's name apart from a table's; every other holder the catalog names
  // shares it.
  if (holder === undefined || holder.type === "trigger") return undefined;
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
  const judged = await judgedOnThisServer(
    judgedRenames(units, dialect),
    db,
    dialect
  );
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
