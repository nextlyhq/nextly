/**
 * The tables one migration statement changes, read through the shared
 * statement cursor (`statement-cursor.ts`).
 *
 * Only the forms below are read. Anything else, including a schema-qualified
 * name and an index drop that names no table, is unreadable and answered
 * `undefined` rather than guessed: a caller deciding whether a file stays inside
 * one entity's tables must count an unreadable statement as leaving them.
 *
 * @module domains/schema/migrate/statement-targets
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { registryRowKeys } from "../ui-schema/registry-row-keys";

import {
  cursorOf,
  StatementCursor,
  type StatementToken,
} from "./statement-cursor";

/**
 * Every cursor here reads a quoted name only as written in lower case
 * (`exactQuotedNames`): which entity's tables a statement changes is judged
 * from them, and a name in another case is another table on PostgreSQL.
 */
const EXACT = { exactQuotedNames: true } as const;

/**
 * The tables a DROP TABLE names, read in the shape the Builder wrote: after
 * `DROP TABLE [IF EXISTS]`, its names and at most one CASCADE, which it added
 * on PostgreSQL and MySQL, and nothing after. Undefined for any other shape.
 */
function droppedTables(cursor: StatementCursor): string[] | undefined {
  cursor.acceptCondition();
  const names = cursor.names();
  cursor.accept("CASCADE");
  return names !== undefined && cursor.done() ? names : undefined;
}

/** The one table a statement names next, as a list, or undefined. */
function oneTable(cursor: StatementCursor): string[] | undefined {
  const name = cursor.name();
  return name === undefined ? undefined : [name];
}

/**
 * The tables an ALTER TABLE's clauses rename it to, read from the tokens after
 * its table: every RENAME clause, since MySQL takes several in one ALTER, so
 * none past the first goes unread. Null when one renames the table to a name
 * not read here (schema-qualified), or when a clause changes another table
 * (MySQL's `EXCHANGE PARTITION … WITH TABLE`). `RENAME TO x`, `RENAME AS x`
 * and MySQL's bare `RENAME x` rename the table; `RENAME COLUMN`, `INDEX`,
 * `KEY` and `CONSTRAINT` rename something on it.
 */
function renameDestinations(
  tokens: readonly StatementToken[]
): string[] | null {
  if (tokens.includes("EXCHANGE")) return null;
  const destinations: string[] = [];
  for (let at = 0; at < tokens.length; at += 1) {
    if (tokens[at] !== "RENAME") continue;
    const clause = new StatementCursor(tokens.slice(at + 1));
    if (["COLUMN", "INDEX", "KEY", "CONSTRAINT"].some(w => clause.isWord(w))) {
      continue;
    }
    if (!clause.accept("TO")) clause.accept("AS");
    const name = clause.name();
    if (name === undefined) return null;
    destinations.push(name);
  }
  return destinations;
}

/** The table a CREATE TABLE or CREATE [UNIQUE] INDEX … ON names, read after CREATE. */
function createdOn(cursor: StatementCursor): string[] | undefined {
  cursor.accept("TEMPORARY");
  if (cursor.accept("TABLE")) {
    cursor.acceptCondition();
    return oneTable(cursor);
  }
  cursor.accept("UNIQUE");
  if (!cursor.accept("INDEX")) return undefined;
  cursor.acceptCondition();
  if (cursor.name() === undefined || !cursor.accept("ON")) return undefined;
  return oneTable(cursor);
}

/**
 * After `ALTER TABLE`: the table altered, and each one it is renamed to where
 * a clause renames it; undefined when any of them cannot be read.
 */
function alteredTables(cursor: StatementCursor): string[] | undefined {
  cursor.acceptCondition();
  cursor.accept("ONLY");
  const table = cursor.name();
  if (table === undefined) return undefined;
  const renamedTo = renameDestinations(cursor.rest());
  if (renamedTo === null) return undefined;
  return [table, ...renamedTo];
}

/**
 * The one table an UPDATE changes, read after UPDATE: its table followed at
 * once by SET. MySQL's multi-table UPDATE (`UPDATE a, b SET …`, `UPDATE a
 * JOIN b … SET …`) changes every table it names, so anything between the
 * table and SET, a modifier or an alias included, is unreadable here rather
 * than read as its first table alone.
 */
function updatedTable(cursor: StatementCursor): string[] | undefined {
  const table = cursor.name();
  return table !== undefined && cursor.isWord("SET") ? [table] : undefined;
}

/**
 * The one table a DELETE FROM changes, read after DELETE FROM: its table
 * followed by WHERE or by nothing. MySQL's `DELETE FROM a, b USING …` and
 * `DELETE FROM a USING …` reach tables past the first, so they are unreadable
 * here, as is any other text after the table.
 */
function deletedFromTable(cursor: StatementCursor): string[] | undefined {
  const table = cursor.name();
  if (table === undefined) return undefined;
  return cursor.done() || cursor.isWord("WHERE") ? [table] : undefined;
}

/**
 * The tables `statement` changes, lower-cased, or `undefined` when it is not a
 * form read here: CREATE/ALTER/DROP TABLE, CREATE [UNIQUE] INDEX … ON, MySQL's
 * DROP INDEX … ON, INSERT INTO, UPDATE and DELETE FROM.
 */
export function tablesChangedIn(
  statement: string,
  dialect: SupportedDialect
): string[] | undefined {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (cursor.accept("CREATE")) return createdOn(cursor);
  if (cursor.accept("ALTER", "TABLE")) return alteredTables(cursor);
  if (cursor.accept("DROP", "TABLE")) return droppedTables(cursor);
  if (cursor.accept("DROP", "INDEX")) {
    // Only MySQL's form names the table; elsewhere the index alone is named.
    cursor.acceptCondition();
    if (cursor.name() === undefined || !cursor.accept("ON")) return undefined;
    return oneTable(cursor);
  }
  if (cursor.accept("INSERT", "INTO")) return oneTable(cursor);
  if (cursor.accept("UPDATE")) return updatedTable(cursor);
  if (cursor.accept("DELETE", "FROM")) return deletedFromTable(cursor);
  return undefined;
}

/**
 * The indexes a DROP INDEX that names no table drops (PostgreSQL's and
 * SQLite's form), lower-cased, or `undefined` for any other statement. Which
 * table an index is on is the caller's to trace from its name. CASCADE is
 * refused: it drops whatever depends on the index too.
 */
export function indexesDroppedBy(
  statement: string,
  dialect: SupportedDialect
): string[] | undefined {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (!cursor.accept("DROP", "INDEX")) return undefined;
  cursor.accept("CONCURRENTLY");
  cursor.acceptCondition();
  const names = cursor.names();
  cursor.accept("RESTRICT");
  return names !== undefined && cursor.done() ? names : undefined;
}

/**
 * The two names of PostgreSQL's `ALTER INDEX [IF EXISTS] a RENAME TO b`,
 * lower-cased, or `undefined` for any other statement. Which table an index
 * is on is the caller's to trace from its name.
 */
export function indexesRenamedBy(
  statement: string,
  dialect: SupportedDialect
): string[] | undefined {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (!cursor.accept("ALTER", "INDEX")) return undefined;
  cursor.acceptCondition();
  const from = cursor.name();
  if (from === undefined || !cursor.accept("RENAME", "TO")) return undefined;
  const to = cursor.name();
  return to !== undefined && cursor.done() ? [from, to] : undefined;
}

/**
 * The tables `statement` drops when it is a DROP TABLE, lower-cased, or
 * `undefined` for any other statement: what a drop-only file is held to.
 */
export function tablesDroppedBy(
  statement: string,
  dialect: SupportedDialect
): string[] | undefined {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (!cursor.accept("DROP", "TABLE")) return undefined;
  return droppedTables(cursor);
}

/** A registry row a statement writes: the registry table and the row's slug. */
export interface RegistryRowWrite {
  table: string;
  slug: string;
}

/** A string token's exact text, or undefined for any other token. */
function stringText(tokens: readonly StatementToken[]): string | undefined {
  if (tokens.length !== 1) return undefined;
  const [token] = tokens;
  return typeof token !== "string" && token.kind === "string"
    ? token.text
    : undefined;
}

/**
 * The column an assignment sets, read past its `=`, or undefined when it does
 * not open with one; never `slug` or `id`, which would move the row into
 * another entity's.
 */
function assignedColumn(cursor: StatementCursor): string | undefined {
  const column = cursor.name();
  if (column === undefined || column === "slug" || column === "id") {
    return undefined;
  }
  return cursor.accept("=") ? column : undefined;
}

/**
 * Whether every assignment of an upsert's update sets a column to the value
 * the INSERT gave it, and does nothing else: `c = EXCLUDED.c` on PostgreSQL,
 * `c = VALUES(c)` on MySQL, as the Builder writes it. Anything after the last
 * one, including a further statement left without its `;`, is refused.
 */
function setsInsertedValues(assignments: StatementToken[][]): boolean {
  return assignments.every(assignment => {
    const cursor = new StatementCursor(assignment);
    const column = assignedColumn(cursor);
    if (column === undefined) return false;
    if (cursor.isWord(`EXCLUDED.${column.toUpperCase()}`)) {
      cursor.at += 1;
    } else if (cursor.accept("EXCLUDED.")) {
      if (cursor.name() !== column) return false;
    } else {
      if (!cursor.accept("VALUES", "(")) return false;
      if (cursor.name() !== column || !cursor.accept(")")) return false;
    }
    return cursor.done();
  });
}

/**
 * Whether every assignment of an UPDATE sets a column to one string or to
 * NULL, and does nothing else.
 */
function setsPlainValues(assignments: StatementToken[][]): boolean {
  return assignments.every(assignment => {
    const cursor = new StatementCursor(assignment);
    if (assignedColumn(cursor) === undefined) return false;
    const value = cursor.rest();
    if (value.length !== 1) return false;
    const [token] = value;
    return (
      token === "NULL" || (typeof token !== "string" && token.kind === "string")
    );
  });
}

/**
 * The registry row `statement` writes, when it is one of the two shapes a
 * row keyed on its slug is written in, or undefined:
 *
 * - `INSERT INTO t (columns) VALUES (values)`, one row whose `slug` value is a
 *   string read exactly, with nothing after it, or PostgreSQL's
 *   `ON CONFLICT (slug) DO NOTHING` / `DO UPDATE SET …`, or MySQL's
 *   `ON DUPLICATE KEY UPDATE …`. MySQL's form fires on any unique key, so it
 *   is read only where the row's other unique keys, its id and table name, are
 *   the ones the registry derives from its slug; otherwise the row it updates
 *   may be another entity's.
 * - `UPDATE t SET … WHERE slug = '…'`, with nothing else in the WHERE.
 *
 * No assignment may set `slug` or `id`, which would rename the row into
 * another entity's, and each is read whole, so text after the last one (a
 * further statement left without its `;`, which the runner would send with
 * it) is refused. Which table is the registry is the caller's to judge.
 */
export function registryRowWrittenBy(
  statement: string,
  dialect: SupportedDialect
): RegistryRowWrite | undefined {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (cursor.accept("INSERT", "INTO")) return insertedRow(cursor);
  if (cursor.accept("UPDATE")) return updatedRow(cursor);
  return undefined;
}

/** An INSERT's one row, read after `INSERT INTO`. */
function insertedRow(cursor: StatementCursor): RegistryRowWrite | undefined {
  const table = cursor.name();
  if (table === undefined || !cursor.accept("(")) return undefined;
  const row = insertedValues(cursor);
  const slug = stringText(row?.get("slug") ?? []);
  if (row === undefined || slug === undefined) return undefined;
  if (!upsertKeepsSlug(cursor, ownsUniqueKeys(table, slug, row))) {
    return undefined;
  }
  return { table, slug };
}

/**
 * An INSERT's one row as its value for each column, read from its column list
 * to the end of its VALUES, or undefined when the row is not one read here.
 */
function insertedValues(
  cursor: StatementCursor
): Map<string, StatementToken[]> | undefined {
  const columns = cursor.names();
  if (columns === undefined || !cursor.accept(")")) return undefined;
  if (!cursor.accept("VALUES", "(")) return undefined;
  const values = parenthesised(cursor);
  if (values?.length !== columns.length) return undefined;
  return new Map(columns.map((column, i) => [column, values[i]]));
}

/**
 * Whether the row's other unique keys, its `id` and `table_name`, are the ones
 * the registry derives from its slug (`registryRowKeys`), each a string read
 * exactly. MySQL's upsert updates whichever row any unique key meets, so only
 * then is the row it meets this slug's own. A table that is not a registry
 * has no derived keys, and nothing is proved.
 */
function ownsUniqueKeys(
  table: string,
  slug: string,
  row: ReadonlyMap<string, StatementToken[]>
): boolean {
  const keys = registryRowKeys(table, slug);
  if (keys === undefined) return false;
  return Object.entries(keys).every(
    ([column, value]) => stringText(row.get(column) ?? []) === value
  );
}

/**
 * The comma-separated items up to the `)` that closes a list already opened,
 * consumed with it, or undefined when the list never closes.
 */
function parenthesised(
  cursor: StatementCursor
): StatementToken[][] | undefined {
  const items: StatementToken[][] = [[]];
  let depth = 0;
  for (;;) {
    const token = cursor.peek();
    if (token === undefined) return undefined;
    cursor.at += 1;
    if (token === ")" && depth === 0) return items;
    if (token === "(") depth += 1;
    if (token === ")") depth -= 1;
    if (token === "," && depth === 0) items.push([]);
    else items[items.length - 1].push(token);
  }
  return undefined;
}

/**
 * Whether what follows an INSERT's row is nothing, or an upsert on its slug.
 * MySQL's upsert is one only where `ownsKeys` holds: it fires on any unique
 * key, not the slug alone.
 */
function upsertKeepsSlug(cursor: StatementCursor, ownsKeys: boolean): boolean {
  if (cursor.done()) return true;
  if (cursor.accept("ON", "DUPLICATE", "KEY", "UPDATE")) {
    return ownsKeys && setsInsertedValues(cursor.clauses());
  }
  if (!cursor.accept("ON", "CONFLICT", "(")) return false;
  if (cursor.name() !== "slug" || !cursor.accept(")", "DO")) return false;
  if (cursor.accept("NOTHING")) return cursor.done();
  return cursor.accept("UPDATE", "SET") && setsInsertedValues(cursor.clauses());
}

/** An UPDATE keyed on one slug, read after `UPDATE`. */
function updatedRow(cursor: StatementCursor): RegistryRowWrite | undefined {
  const table = cursor.name();
  if (table === undefined || !cursor.accept("SET")) return undefined;
  const rest = cursor.rest();
  const where = rest.lastIndexOf("WHERE");
  if (where === -1) return undefined;
  const key = new StatementCursor(rest.slice(where + 1));
  if (key.name() !== "slug" || !key.accept("=")) return undefined;
  const slug = stringText(key.rest());
  const assignments = new StatementCursor(rest.slice(0, where)).clauses();
  if (slug === undefined || !setsPlainValues(assignments)) return undefined;
  return { table, slug };
}

/** The shared table an earlier Builder kept a translation's values in. */
const ARCHIVE_TABLE = "nextly_i18n_archive";

/**
 * A statement an earlier Builder wrote into an `_i18n_` or `_update_` file to keep a
 * translation's values: the archive created if absent, or the values copied
 * into it, with the slug the rows are kept under and every table read.
 */
export type ArchiveWrite =
  | { kind: "create" }
  | { kind: "insert"; slug: string; reads: string[] };

/**
 * The archive write `statement` is, or `undefined` for any other statement:
 * `CREATE TABLE IF NOT EXISTS nextly_i18n_archive`, `CREATE INDEX IF NOT
 * EXISTS … ON nextly_i18n_archive`, or `INSERT INTO nextly_i18n_archive
 * (columns) SELECT …` whose `collection` value is a string read exactly. A
 * creation without IF NOT EXISTS, or any other write, reads nothing.
 */
export function archiveWriteOf(
  statement: string,
  dialect: SupportedDialect
): ArchiveWrite | undefined {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (cursor.accept("CREATE")) {
    return createsArchive(cursor) ? { kind: "create" } : undefined;
  }
  if (cursor.accept("INSERT", "INTO")) return archiveInsert(cursor);
  return undefined;
}

/** Whether a CREATE, read after CREATE, makes the archive or its index if absent. */
function createsArchive(cursor: StatementCursor): boolean {
  if (cursor.accept("TABLE")) {
    return (
      cursor.accept("IF", "NOT", "EXISTS") && cursor.name() === ARCHIVE_TABLE
    );
  }
  if (!cursor.accept("INDEX", "IF", "NOT", "EXISTS")) return false;
  if (cursor.name() === undefined || !cursor.accept("ON")) return false;
  return cursor.name() === ARCHIVE_TABLE;
}

/** An INSERT … SELECT into the archive, read after INSERT INTO. */
function archiveInsert(cursor: StatementCursor): ArchiveWrite | undefined {
  if (cursor.name() !== ARCHIVE_TABLE || !cursor.accept("(")) return undefined;
  const columns = cursor.names();
  if (columns === undefined || !cursor.accept(")")) return undefined;
  if (!cursor.accept("SELECT")) return undefined;
  const rest = cursor.rest();
  const from = rest.indexOf("FROM");
  if (from === -1) return undefined;
  const items = new StatementCursor(rest.slice(0, from)).clauses();
  const slug = stringText(items[columns.indexOf("collection")] ?? []);
  const reads = tablesReadIn(rest);
  if (slug === undefined || reads === undefined) return undefined;
  return { kind: "insert", slug, reads };
}

/**
 * Every table a query's FROM and JOIN clauses name, in order, once each, or
 * undefined when one names something else (a subquery, a qualified name), or
 * names more than one table (`FROM a, b`), whose second would go unread.
 * `IS [NOT] DISTINCT FROM` compares values and names no table.
 */
function tablesReadIn(tokens: readonly StatementToken[]): string[] | undefined {
  const tables: string[] = [];
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token !== "FROM" && token !== "JOIN") continue;
    if (token === "FROM" && tokens[at - 1] === "DISTINCT") continue;
    const source = new StatementCursor(tokens.slice(at + 1));
    const table = source.name();
    if (table === undefined || !oneSource(source)) return undefined;
    if (!tables.includes(table)) tables.push(table);
  }
  return tables;
}

/**
 * Whether a FROM or JOIN's table, read up to here, is its only one: after an
 * optional alias (`t a`, `t AS a`), no comma lists another.
 */
function oneSource(cursor: StatementCursor): boolean {
  if (cursor.accept("AS")) {
    if (cursor.name() === undefined) return false;
  } else if (!cursor.isWord(",") && !cursor.done()) {
    // A bare alias is a name that is not the clause's next keyword; a keyword
    // is read as a name too, which leaves the comma check below just as strict.
    cursor.name();
  }
  return !cursor.isWord(",");
}
