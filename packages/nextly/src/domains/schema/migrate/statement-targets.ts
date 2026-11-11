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

/** One rename a migration statement makes: a column of a table, or a table. */
export type StatementRename =
  | { kind: "column"; table: string; from: string; to: string }
  | { kind: "table"; from: string; to: string };

/** The name that ends a clause, or undefined when anything else follows it. */
function lastName(clause: StatementCursor): string | undefined {
  const name = clause.name();
  return name !== undefined && clause.done() ? name : undefined;
}

/** `a TO b`, ending the clause: the old name and the new, or undefined. */
function namePair(
  clause: StatementCursor
): { from: string; to: string } | undefined {
  const from = clause.name();
  if (from === undefined || !clause.accept("TO")) return undefined;
  const to = lastName(clause);
  return to === undefined ? undefined : { from, to };
}

/** `a TO b` read as a column of `table` renamed, or undefined. */
function columnRename(
  clause: StatementCursor,
  table: string
): StatementRename | undefined {
  const pair = namePair(clause);
  return pair === undefined ? undefined : { kind: "column", table, ...pair };
}

/** A name ending the clause, read as the name `table` is renamed to, or undefined. */
function tableRenamedTo(
  clause: StatementCursor,
  table: string
): StatementRename | undefined {
  const to = lastName(clause);
  return to === undefined ? undefined : { kind: "table", from: table, to };
}

/** What a RENAME clause renames besides the table and its columns. */
const NOT_A_COLUMN_OR_TABLE = ["INDEX", "KEY", "CONSTRAINT"];

/**
 * One ALTER TABLE clause read as a rename of `table` or of one of its columns:
 * `RENAME COLUMN a TO b` and PostgreSQL's and SQLite's `RENAME a TO b`, a
 * column; `RENAME TO u`, `RENAME AS u` and MySQL's bare `RENAME u`, the table.
 * Undefined for any other clause, a renamed index, key or constraint
 * included.
 */
function renameClause(
  clause: StatementCursor,
  table: string
): StatementRename | undefined {
  if (
    !clause.accept("RENAME") ||
    NOT_A_COLUMN_OR_TABLE.some(word => clause.isWord(word))
  ) {
    return undefined;
  }
  if (clause.accept("COLUMN")) return columnRename(clause, table);
  if (clause.accept("TO") || clause.accept("AS")) {
    return tableRenamedTo(clause, table);
  }
  // A name followed by TO is a column renamed; a name alone, MySQL's table.
  return clause.isWord("TO", 1)
    ? columnRename(clause, table)
    : tableRenamedTo(clause, table);
}

/** Each `a TO b` of MySQL's `RENAME TABLE`, read after those words, or undefined. */
function tablesRenamed(cursor: StatementCursor): StatementRename[] | undefined {
  const renames: StatementRename[] = [];
  for (const tokens of cursor.clauses()) {
    const pair = namePair(new StatementCursor(tokens));
    if (pair === undefined) return undefined;
    renames.push({ kind: "table", ...pair });
  }
  return renames;
}

/** Each clause of an ALTER TABLE read after those words as a rename, or undefined. */
function alterTableRenames(
  cursor: StatementCursor
): StatementRename[] | undefined {
  cursor.acceptCondition();
  cursor.accept("ONLY");
  const table = cursor.name();
  if (table === undefined) return undefined;
  const renames: StatementRename[] = [];
  for (const tokens of cursor.clauses()) {
    const rename = renameClause(new StatementCursor(tokens), table);
    if (rename === undefined) return undefined;
    renames.push(rename);
  }
  return renames;
}

/**
 * The renames `statement` makes, in order, when it is made of renames alone:
 * an ALTER TABLE each of whose clauses renames the table or one of its columns
 * (`renameClause`; every clause names the table as the statement found it),
 * or MySQL's `RENAME TABLE a TO b[, c TO d]`. Undefined for any other
 * statement, for a rename beside a clause that does anything else, and for a
 * name not read here (schema-qualified, or on PostgreSQL quoted in another
 * case than lower), so a caller judging renames before a file runs counts such
 * a statement as a change it did not read. Names come back lower-cased: MySQL
 * and SQLite compare them without regard to case, so a quoted `Heading` there
 * is read as the column it names; PostgreSQL keeps a quoted name's case, so
 * there only the lower-case spelling is read.
 */
export function renamesIn(
  statement: string,
  dialect: SupportedDialect
): StatementRename[] | undefined {
  const cursor = cursorOf(
    statement,
    dialect,
    dialect === "postgresql" ? EXACT : {}
  );
  if (cursor.accept("RENAME", "TABLE")) return tablesRenamed(cursor);
  if (!cursor.accept("ALTER", "TABLE")) return undefined;
  return alterTableRenames(cursor);
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

/** A unique index one statement creates: its table, its name and its columns, lower-cased. */
export interface UniqueIndexCreated {
  readonly table: string;
  readonly name: string;
  readonly columns: readonly string[];
}

/**
 * A unique index a statement creates, read as far as its table and its key list. `exact` where the
 * whole statement is a form read here (`uniqueIndexesCreatedBy`); not where anything around them is
 * not read: an option after the key list, MySQL's index type before `ON`, an index left unnamed,
 * another clause of the same ALTER, a qualified table.
 */
export interface UniqueIndexRead extends UniqueIndexCreated {
  readonly exact: boolean;
  /** A qualified table's schema, which the caller judges against the connection's own. */
  readonly qualifier?: string;
}

/**
 * The unique index `statement` creates, as a list of one, or `undefined` for any other statement:
 * `CREATE UNIQUE INDEX [CONCURRENTLY] [IF NOT EXISTS] name ON [ONLY] table [USING method] (columns)` and
 * `ALTER TABLE table ADD CONSTRAINT name UNIQUE (columns)`, read whole (`uniqueIndexesReadIn`,
 * `exact`). One with anything else in it is not read here.
 */
export function uniqueIndexesCreatedBy(
  statement: string,
  dialect: SupportedDialect
): UniqueIndexCreated[] | undefined {
  const read = uniqueIndexesReadIn(statement, dialect);
  if (read === undefined || !read.every(index => index.exact)) return undefined;
  return read.map(({ table, name, columns }) => ({ table, name, columns }));
}

/**
 * The unique indexes `statement` creates, each read as far as its table and plain key list:
 * `CREATE UNIQUE INDEX … ON table … (columns) …`, and each `ADD [CONSTRAINT name] UNIQUE … (columns)`
 * clause of an ALTER TABLE. Undefined for any other statement, and for an index over an expression
 * or with a predicate (`WHERE`): that is not uniqueness of its whole columns, so the database alone
 * judges it.
 */
export function uniqueIndexesReadIn(
  statement: string,
  dialect: SupportedDialect
): UniqueIndexRead[] | undefined {
  // As `renamesIn` reads names: MySQL and SQLite compare them without regard to case, so a quoted
  // `Person` there is the column it names; PostgreSQL keeps a quoted name's case, so there only
  // the lower-case spelling is read.
  const cursor = cursorOf(
    statement,
    dialect,
    dialect === "postgresql" ? EXACT : {}
  );
  if (cursor.accept("CREATE", "UNIQUE", "INDEX")) {
    const index = createdUniqueIndex(cursor);
    return index === undefined ? undefined : [index];
  }
  if (!cursor.accept("ALTER", "TABLE")) return undefined;
  cursor.acceptCondition();
  cursor.accept("ONLY");
  const table = tableNamed(cursor);
  if (table === undefined) return undefined;
  const clauses = cursor.clauses();
  const added = clauses.flatMap(
    clause => addedUniqueKey(new StatementCursor(clause), table) ?? []
  );
  if (added.length === 0) return undefined;
  // A clause beside the key is not read.
  return clauses.length === 1
    ? added
    : added.map(index => ({ ...index, exact: false }));
}

/** A table named next, plain or with one qualifier (`s.t`), or undefined. */
function tableNamed(
  cursor: StatementCursor
): { table: string; qualifier?: string } | undefined {
  const qualified = cursor.qualifiedName();
  if (qualified !== undefined) {
    return { table: qualified.name, qualifier: qualified.qualifier };
  }
  const table = cursor.name();
  return table === undefined ? undefined : { table };
}

/**
 * The index `CREATE UNIQUE INDEX` makes, read after it: PostgreSQL's `CONCURRENTLY`, `ON ONLY` and
 * method before the key list included, and exact only when it is named and MySQL's index type does
 * not come before `ON`.
 */
function createdUniqueIndex(
  cursor: StatementCursor
): UniqueIndexRead | undefined {
  cursor.accept("CONCURRENTLY");
  cursor.acceptCondition();
  // PostgreSQL takes an index left unnamed.
  const name = cursor.isWord("ON") ? undefined : cursor.name();
  if (name === undefined && !cursor.isWord("ON")) return undefined;
  // MySQL's index type, which it also takes before ON.
  const typed = cursor.accept("USING");
  if (typed) cursor.at += 1;
  if (!cursor.accept("ON")) return undefined;
  cursor.accept("ONLY");
  const table = tableNamed(cursor);
  if (table === undefined) return undefined;
  // PostgreSQL names the index's method before its columns.
  if (cursor.accept("USING")) cursor.at += 1;
  return keyList(cursor, table, name, name !== undefined && !typed);
}

/**
 * The unique key one ALTER TABLE clause adds: `ADD CONSTRAINT name UNIQUE [INDEX|KEY]`, and
 * MySQL's `ADD UNIQUE [INDEX|KEY] [name] [USING type]`, whose name may be left out.
 */
function addedUniqueKey(
  cursor: StatementCursor,
  table: { table: string; qualifier?: string }
): UniqueIndexRead | undefined {
  if (!cursor.accept("ADD")) return undefined;
  const name = cursor.accept("CONSTRAINT")
    ? constraintName(cursor)
    : uniqueKeyName(cursor);
  if (name === null) return undefined;
  const typed = cursor.accept("USING");
  if (typed) cursor.at += 1;
  return keyList(cursor, table, name, !typed);
}

/**
 * After `ADD CONSTRAINT`: the constraint's name, read through `UNIQUE [INDEX|KEY]`, or null where
 * the constraint is no unique key.
 */
function constraintName(cursor: StatementCursor): string | null {
  const name = cursor.name();
  if (name === undefined || !cursor.accept("UNIQUE")) return null;
  if (!cursor.accept("INDEX")) cursor.accept("KEY");
  return name;
}

/**
 * After `ADD`: MySQL's `UNIQUE [INDEX|KEY] [name]`, its name, undefined where it is left out (the
 * key list or the index type opens next then), or null where the clause adds no unique key.
 */
function uniqueKeyName(cursor: StatementCursor): string | undefined | null {
  if (!cursor.accept("UNIQUE")) return null;
  if (!cursor.accept("INDEX")) cursor.accept("KEY");
  if (cursor.isWord("(") || cursor.isWord("USING")) return undefined;
  return cursor.name() ?? null;
}

/**
 * The key list an index's reading reaches next, and what follows it: a predicate (`WHERE`) reads
 * as no index of its whole columns, anything else as an index not read whole.
 */
function keyList(
  cursor: StatementCursor,
  table: { table: string; qualifier?: string },
  name: string | undefined,
  exact: boolean
): UniqueIndexRead | undefined {
  if (!cursor.accept("(")) return undefined;
  const columns = columnList(cursor);
  if (columns === undefined) return undefined;
  const rest = cursor.rest();
  if (rest.includes("WHERE")) return undefined;
  return {
    table: table.table,
    // MySQL names an unnamed one after its first column.
    name: name ?? columns[0],
    columns,
    exact: exact && table.qualifier === undefined && rest.length === 0,
    ...(table.qualifier === undefined ? {} : { qualifier: table.qualifier }),
  };
}

/** The plain column names of a key list already opened, consumed with its `)`, or undefined. */
function columnList(cursor: StatementCursor): string[] | undefined {
  const items = parenthesised(cursor);
  if (items === undefined) return undefined;
  const columns: string[] = [];
  for (const item of items) {
    const key = new StatementCursor(item);
    const column = key.name();
    if (column === undefined || !key.done()) return undefined;
    columns.push(column);
  }
  return columns;
}

/** A column an ALTER TABLE adds, lower-cased, and the constant it gives every row there already. */
export interface ColumnAdded {
  readonly table: string;
  readonly column: string;
  /**
   * The literal its DEFAULT names (a string, a number, TRUE or FALSE), which every existing row
   * takes; undefined for no default, NULL, or anything else (an expression, a function call, a
   * generated column), whose values are not read here.
   */
  readonly filledWith?: string;
}

/** What an ADD clause names first when it adds a key, an index or a check rather than a column. */
const NOT_A_COLUMN = [
  "CONSTRAINT",
  "UNIQUE",
  "PRIMARY",
  "FOREIGN",
  "CHECK",
  "INDEX",
  "KEY",
  "FULLTEXT",
  "SPATIAL",
];

/**
 * The columns `statement` adds: each `ADD [COLUMN] [IF NOT EXISTS] name …` clause of an ALTER
 * TABLE. Empty for any statement that is not an ALTER TABLE; undefined for one whose table, or one
 * of whose ADD clauses, is not read (MySQL's `ADD (a …, b …)`, a qualified table), which may then
 * add any column.
 */
export function columnsAddedBy(
  statement: string,
  dialect: SupportedDialect
): ColumnAdded[] | undefined {
  const cursor = cursorOf(
    statement,
    dialect,
    dialect === "postgresql" ? EXACT : {}
  );
  if (!cursor.accept("ALTER", "TABLE")) return [];
  cursor.acceptCondition();
  cursor.accept("ONLY");
  const table = cursor.name();
  if (table === undefined) return undefined;
  const added: ColumnAdded[] = [];
  for (const tokens of cursor.clauses()) {
    const clause = new StatementCursor(tokens);
    if (!clause.accept("ADD") || NOT_A_COLUMN.some(w => clause.isWord(w))) {
      continue;
    }
    clause.accept("COLUMN");
    clause.acceptCondition();
    const column = clause.name();
    if (column === undefined) return undefined;
    const filledWith = literalDefault(clause.rest());
    added.push({
      table,
      column,
      ...(filledWith === undefined ? {} : { filledWith }),
    });
  }
  return added;
}

/** A word that may follow a literal default without changing it: a keyword, or a cast's `::`. */
const AFTER_A_LITERAL = /^([A-Z_].*|:)$/;

/**
 * The literal a column definition's DEFAULT names, as text: a string, TRUE, FALSE or a number,
 * followed by nothing that makes it an expression. Undefined otherwise, NULL included.
 */
function literalDefault(tokens: readonly StatementToken[]): string | undefined {
  const at = tokens.indexOf("DEFAULT");
  if (at < 0) return undefined;
  const read = literalAt(tokens, at + 1);
  if (read === undefined) return undefined;
  const next = tokens[read.end];
  const ends =
    next === undefined ||
    (typeof next === "string" && AFTER_A_LITERAL.test(next));
  return ends ? read.literal : undefined;
}

/** The literal the tokens from `at` begin with, as text, and the position after it. */
function literalAt(
  tokens: readonly StatementToken[],
  at: number
): { literal: string; end: number } | undefined {
  const value = tokens[at];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    return value.kind === "string" && value.text !== undefined
      ? { literal: value.text, end: at + 1 }
      : undefined;
  }
  if (value === "TRUE" || value === "FALSE") {
    return { literal: value, end: at + 1 };
  }
  return numberAt(tokens, at);
}

/** The number the tokens from `at` begin with, read as one token per digit, sign and point. */
function numberAt(
  tokens: readonly StatementToken[],
  at: number
): { literal: string; end: number } | undefined {
  let end = at;
  let digits = "";
  for (let part = tokens[end]; typeof part === "string"; part = tokens[end]) {
    if (!/^[-0-9.]$/.test(part)) break;
    digits += part;
    end += 1;
  }
  return /^-?\d+(\.\d+)?$/.test(digits) ? { literal: digits, end } : undefined;
}

/**
 * The table a CREATE TABLE makes, lower-cased, as `renamesIn` reads names, or undefined for any
 * other statement.
 */
export function tablesCreatedBy(
  statement: string,
  dialect: SupportedDialect
): string[] | undefined {
  const cursor = cursorOf(
    statement,
    dialect,
    dialect === "postgresql" ? EXACT : {}
  );
  if (!cursor.accept("CREATE")) return undefined;
  cursor.accept("TEMPORARY");
  if (!cursor.accept("TABLE")) return undefined;
  cursor.acceptCondition();
  return oneTable(cursor);
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
