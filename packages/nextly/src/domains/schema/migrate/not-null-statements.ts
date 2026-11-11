/**
 * Which statements of a migration unit make a column NOT NULL, read from the statements alone:
 * the one reader `nextly migrate` judges a file's required columns through, before the file runs
 * and at the statement itself.
 *
 * The forms it reads, each a decision row of `readNotNullChanges`:
 *
 * | Statement | Change |
 * |---|---|
 * | `ALTER TABLE t ALTER [COLUMN] c SET NOT NULL` (PostgreSQL) | c's null rows break it |
 * | `ALTER TABLE t MODIFY [COLUMN] c <type> ... NOT NULL` (MySQL) | c's null rows break it |
 * | The four-statement MySQL run `migrate:create` writes for a NOT NULL (`mysqlLiveRunAt`) | c's null rows break it |
 * | `ALTER TABLE t CHANGE [COLUMN] old new <type> ... NOT NULL` (MySQL) | old's null rows break it |
 * | `ALTER TABLE t ADD [COLUMN] c <type> NOT NULL`, no default and no generated value | every row breaks it |
 * | `CREATE TABLE __new_t (...)` then `INSERT INTO __new_t (...) SELECT ... FROM t` (SQLite rebuild) | for each NOT NULL column of `__new_t`: the null rows of the column of t copied into it, or every row of t when nothing is copied into it and it has no default |
 *
 * Anything else is no change: a nullable MODIFY, `SET DEFAULT`, `DROP NOT NULL`, an ADD with a
 * DEFAULT, a NOT NULL inside a CHECK's parentheses. Each change also says what the statements
 * before it did to its table, which decides when the change is counted:
 *
 * - `writtenEarlier`: an earlier statement wrote rows of the table (UPDATE, INSERT, DELETE,
 *   REPLACE, MERGE, TRUNCATE, COPY on it), or a statement whose reach is not read (`DO`, `CALL`,
 *   `WITH`, `LOAD`, a write on a table this does not name) ran before it. The rows still null are
 *   counted AT the statement, after that fill; counting before the file runs would refuse a file
 *   that fills them first.
 * - `before`: the table's and the column's names before the unit's first statement, following
 *   the renames before the change, or null when the unit itself created the table or the column
 *   (which then holds no row the file did not put there).
 *
 * Statements are read through the shared statement cursor (`cursorOf`), on the splitter's one
 * tokenizer, so a name or a keyword inside a string literal or a comment is never read as one.
 *
 * @module domains/schema/migrate/not-null-statements
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import {
  MYSQL_LIVE_RUN_LENGTH,
  mysqlLiveRunAt,
  plainMysqlStatement,
} from "../pipeline/sql-templates/mysql-live-restate";

import {
  cursorOf,
  StatementCursor,
  type StatementToken,
} from "./statement-cursor";

/** One column a statement makes NOT NULL, as the statements say it. Names are lower-cased. */
export interface NotNullChange {
  /** The statement's 0-based position in the unit. */
  statement: number;
  /** The table, as named at the statement. */
  table: string;
  /**
   * The column whose null rows break the change, as named at the statement; `null` for a column
   * added NOT NULL with no default, which every existing row breaks.
   */
  column: string | null;
  /** The column the statement leaves required, as named after it: the one a field maps to. */
  required: string;
  /**
   * The table and the column as named before the unit's first statement; `column` is `null` for
   * an added column. `null` when the unit itself created the table or the column.
   * `addedIfMissing`: the unit added the column `IF NOT EXISTS` and empty, so it is the column
   * already there, or, when there is none, one every row breaks.
   */
  before: {
    table: string;
    column: string | null;
    addedIfMissing?: true;
  } | null;
  /** An earlier statement of the unit wrote rows of this table, or may have. */
  writtenEarlier: boolean;
  /**
   * The qualifier the statement names the table through (`s.t`), lower-cased, when it names one.
   * Which schema that reaches is decided against the database, not here.
   */
  qualifier?: string;
}

/** A table as the statements read so far leave it. */
interface TableState {
  /** Its name before the unit ran, or `null` when the unit created it. */
  origin: string | null;
  /** A renamed or created column: its name before the unit ran, or `null` when the unit made it. */
  columns: Map<string, string | null>;
  /**
   * Columns the unit added to this table, which held rows before it, without a value for them:
   * every one of those rows holds null in the column.
   */
  addedEmpty: Set<string>;
  /** Columns the unit added `IF NOT EXISTS`, which may be the ones already there. */
  ifMissing: Set<string>;
  written: boolean;
}

/** A column definition of a `CREATE TABLE` body or an `ADD`/`MODIFY`/`CHANGE` clause. */
interface ColumnDefinition {
  name: string;
  notNull: boolean;
  /** It gets a value without one being written: a default, a generated value, a sequence. */
  hasValue: boolean;
}

/** First words of a statement that writes rows of the table it names next. */
const ROW_WRITE_WORDS = new Set([
  "UPDATE",
  "INSERT",
  "DELETE",
  "REPLACE",
  "MERGE",
  "TRUNCATE",
  "COPY",
]);

/** First words of a statement whose reach is not read: it may write rows of any table. */
const UNREAD_WRITE_WORDS = new Set(["DO", "CALL", "WITH", "LOAD", "EXECUTE"]);

/** Words that start an item of a table body, or an `ADD` clause, that is not a column. */
const NON_COLUMN_WORDS = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "FOREIGN",
  "UNIQUE",
  "CHECK",
  "EXCLUDE",
  "INDEX",
  "KEY",
  "FULLTEXT",
  "SPATIAL",
  "PARTITION",
  "PERIOD",
  "SYSTEM",
  "LIKE",
]);

/** Words in a column definition that give it a value no row has to write. */
const VALUE_WORDS = new Set([
  "DEFAULT",
  "GENERATED",
  "AS",
  "AUTO_INCREMENT",
  "AUTOINCREMENT",
  "IDENTITY",
]);

/** PostgreSQL's sequence-backed types, which fill every row. */
const SERIAL_TYPES = new Set([
  "SERIAL",
  "SERIAL2",
  "SERIAL4",
  "SERIAL8",
  "SMALLSERIAL",
  "BIGSERIAL",
]);

/**
 * Which column of `table` an `INSERT INTO __new_t [(cols)] SELECT items FROM t` copies into each
 * column of the twin (`null` for an item that is not a plain column), or undefined when the copy
 * is not a plain one from `table` alone, which is not read.
 */
function rebuildCopyColumns(
  rest: readonly StatementToken[],
  definitions: readonly ColumnDefinition[],
  table: string
): Map<string, string | null> | undefined {
  let into = definitions.map(d => d.name);
  let query = rest;
  const listed = parenthesised(rest);
  if (listed !== undefined) {
    into = itemsOf(listed).map(item => plainName(item) ?? "");
    query = rest.slice(listed.length + 2);
  }
  if (query[0] !== "SELECT") return undefined;
  const from = query.lastIndexOf("FROM");
  if (from === -1) return undefined;
  const items = itemsOf(query.slice(1, from));
  const source = new StatementCursor(query.slice(from + 1));
  // Only a copy of every row of t alone: a filter, a join or a second table copies rows no count
  // of t stands for.
  if (source.name() !== table || !source.done()) return undefined;
  const everyColumn =
    items.length === 1 && items[0].length === 1 && items[0][0] === "*";
  return new Map(
    into.map((name, i) => [
      name,
      everyColumn ? name : (plainName(items[i] ?? []) ?? null),
    ])
  );
}

/**
 * A row write that may reach tables its first name is not: MySQL's multi-table UPDATE
 * (`UPDATE a JOIN b`, `UPDATE a, b`) and DELETE (`DELETE FROM a, b USING ...`), and a
 * `DELETE ... USING` on either dialect, read as reaching every table it names.
 */
function writesSeveralTables(
  word: string,
  rest: readonly StatementToken[]
): boolean {
  if (word !== "UPDATE" && word !== "DELETE") return false;
  const end = rest.indexOf(word === "UPDATE" ? "SET" : "WHERE");
  const head = end === -1 ? rest : rest.slice(0, end);
  return (
    head.includes("JOIN") ||
    head.includes(",") ||
    (word === "DELETE" && head.includes("USING"))
  );
}

/** What a `RENAME` clause may rename that leaves the table and its columns as they were. */
const RENAME_KEEPS_COLUMNS = ["INDEX", "KEY", "CONSTRAINT"];

/** The rebuild twin SQLite copies a table into (`sqliteTableRebuildStatements`). */
const REBUILD_PREFIX = "__new_";

/** The word before a row write's table, by its first word; a DELETE without it is not read. */
const TABLE_LEADS: Readonly<Record<string, string>> = {
  INSERT: "INTO",
  REPLACE: "INTO",
  MERGE: "INTO",
  DELETE: "FROM",
  TRUNCATE: "TABLE",
};

/** Modifiers between a row statement's first word and its table, skipped where they stand. */
const ROW_MODIFIERS = [
  "LOW_PRIORITY",
  "DELAYED",
  "HIGH_PRIORITY",
  "QUICK",
  "IGNORE",
  "ONLY",
];

/** The tokens inside the parentheses `tokens` opens with, or undefined when they do not. */
function parenthesised(
  tokens: readonly StatementToken[]
): StatementToken[] | undefined {
  if (tokens[0] !== "(") return undefined;
  let depth = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === "(") depth += 1;
    if (tokens[i] === ")") depth -= 1;
    if (depth === 0) return tokens.slice(1, i);
  }
  return undefined;
}

/** The comma-separated items of a token list, split outside parentheses. */
function itemsOf(tokens: readonly StatementToken[]): StatementToken[][] {
  return new StatementCursor(tokens).clauses();
}

/** An item that is one plain column name and nothing else, or undefined. */
function plainName(item: readonly StatementToken[]): string | undefined {
  const cursor = new StatementCursor(item);
  const name = cursor.name();
  return name !== undefined && cursor.peek() === undefined ? name : undefined;
}

/** A word of a column definition outside any parentheses, with the tokens after it. */
interface DefinitionWord {
  word: string;
  after: readonly StatementToken[];
  /** The definition's first token: its type. */
  first: boolean;
}

/** The words of a definition outside any parentheses, so a CHECK's `IS NOT NULL` is not one. */
function topLevelWords(rest: readonly StatementToken[]): DefinitionWord[] {
  const words: DefinitionWord[] = [];
  let depth = 0;
  rest.forEach((token, i) => {
    if (token === "(") depth += 1;
    else if (token === ")") depth -= 1;
    else if (depth === 0 && typeof token === "string") {
      words.push({ word: token, after: rest.slice(i + 1), first: i === 0 });
    }
  });
  return words;
}

/** Whether tokens start with the constant NULL, bare or in parentheses: `NULL`, `(NULL)`. */
function startsWithNull(tokens: readonly StatementToken[]): boolean {
  if (tokens[0] === "NULL") return true;
  const inner = parenthesised(tokens);
  return inner !== undefined && inner.length > 0 && isNullConstant(inner);
}

/** Whether tokens are the constant NULL and nothing else, however parenthesised. */
function isNullConstant(tokens: readonly StatementToken[]): boolean {
  if (tokens.length === 1) return tokens[0] === "NULL";
  const inner = parenthesised(tokens);
  return (
    inner !== undefined &&
    inner.length + 2 === tokens.length &&
    isNullConstant(inner)
  );
}

/**
 * Whether a word gives the column a value no row has to write: a default other than NULL (which
 * leaves every row null, written `DEFAULT NULL` or `DEFAULT (NULL)`), a generated value, a
 * sequence-backed type.
 */
function givesValue({ word, after, first }: DefinitionWord): boolean {
  if (word === "DEFAULT") return !startsWithNull(after);
  return VALUE_WORDS.has(word) || (first && SERIAL_TYPES.has(word));
}

/** What a column definition's tokens after its name say: NOT NULL, and a value of its own. */
function readDefinition(
  name: string,
  rest: readonly StatementToken[]
): ColumnDefinition {
  const words = topLevelWords(rest);
  const pair = (word: string, next: string) =>
    words.some(w => w.word === word && w.after[0] === next);
  // SQLite's `INTEGER PRIMARY KEY` is the rowid, which every row gets.
  const rowid = rest[0] === "INTEGER" && pair("PRIMARY", "KEY");
  return {
    name,
    notNull: pair("NOT", "NULL"),
    hasValue: rowid || words.some(givesValue),
  };
}

/** The column definitions of a `CREATE TABLE` body, table constraints left out. */
function bodyColumns(
  tokens: readonly StatementToken[]
): ColumnDefinition[] | undefined {
  const body = parenthesised(tokens);
  if (body === undefined) return undefined;
  const columns: ColumnDefinition[] = [];
  for (const item of itemsOf(body)) {
    const cursor = new StatementCursor(item);
    const first = cursor.peek();
    if (typeof first === "string" && NON_COLUMN_WORDS.has(first)) continue;
    const name = cursor.name();
    if (name === undefined) continue;
    columns.push(readDefinition(name, cursor.rest()));
  }
  return columns;
}

/** The statements of a unit read in order, keeping what each leaves its tables. */
class UnitReader {
  private readonly tables = new Map<string, TableState>();
  /** Tables dropped by the unit, by name, for a rebuild's twin renamed back onto one. */
  private readonly dropped = new Map<string, TableState>();
  /** The column definitions of the tables the unit created, for a rebuild's copy. */
  private readonly created = new Map<string, ColumnDefinition[]>();
  /** A statement whose reach is not read ran: it may have written rows of any table. */
  private anyWritten = false;
  /** The qualifier the statement being read names its table through, if any. */
  private qualifier: string | undefined;
  readonly changes: NotNullChange[] = [];

  constructor(private readonly dialect: SupportedDialect) {}

  private state(table: string): TableState {
    let state = this.tables.get(table);
    if (state === undefined) {
      state = {
        origin: table,
        columns: new Map(),
        addedEmpty: new Set(),
        ifMissing: new Set(),
        written: false,
      };
      this.tables.set(table, state);
    }
    return state;
  }

  /** A column's name before the unit ran, or `null` when the unit made it or its table. */
  private columnOrigin(state: TableState, column: string): string | null {
    if (state.origin === null) return null;
    return state.columns.has(column)
      ? (state.columns.get(column) ?? null)
      : column;
  }

  private change(
    statement: number,
    table: string,
    column: string | null,
    required: string
  ): void {
    const state = this.state(table);
    this.changes.push({
      statement,
      table,
      column,
      required,
      before: this.beforeOf(state, column),
      writtenEarlier: state.written || this.anyWritten,
      ...(this.qualifier === undefined ? {} : { qualifier: this.qualifier }),
    });
  }

  /**
   * What a change breaks, by the names before the unit ran. A column the unit added empty to a
   * table that had rows breaks every one of them, as a column added NOT NULL without a default
   * does; one it added with a value, or to a table it created, breaks none the unit did not put
   * there. One it added `IF NOT EXISTS` and empty may be the one already there.
   */
  private beforeOf(
    state: TableState,
    column: string | null
  ): NotNullChange["before"] {
    if (state.origin === null) return null;
    if (column === null) return { table: state.origin, column: null };
    const columnBefore = this.columnOrigin(state, column);
    if (columnBefore === null) {
      return state.addedEmpty.has(column)
        ? { table: state.origin, column: null }
        : null;
    }
    return state.ifMissing.has(column) && state.addedEmpty.has(column)
      ? { table: state.origin, column: columnBefore, addedIfMissing: true }
      : { table: state.origin, column: columnBefore };
  }

  read(statement: string, index: number): void {
    const cursor = cursorOf(statement, this.dialect);
    const first = cursor.peek();
    if (typeof first !== "string") return;
    if (UNREAD_WRITE_WORDS.has(first)) {
      this.anyWritten = true;
    } else if (ROW_WRITE_WORDS.has(first)) {
      cursor.accept(first);
      this.readRowWrite(cursor, first, index);
    } else if (cursor.accept("CREATE", "TABLE")) {
      this.readCreateTable(cursor);
    } else if (cursor.accept("DROP", "TABLE")) {
      this.readDropTables(cursor);
    } else if (cursor.accept("ALTER", "TABLE")) {
      this.readAlterTable(cursor, index);
    } else if (cursor.accept("RENAME", "TABLE")) {
      this.readRenameTables(cursor);
    }
  }

  /**
   * `UPDATE`, `INSERT`, `DELETE`, ... on a table: its rows written, and a rebuild's copy read. A
   * write whose table is not read here (qualified, several tables, a join) may have written any.
   */
  private readRowWrite(
    cursor: StatementCursor,
    word: string,
    index: number
  ): void {
    if (!this.readRowWriteLead(cursor, word)) {
      this.anyWritten = true;
      return;
    }
    const target = cursor.name();
    if (target === undefined) {
      this.anyWritten = true;
      return;
    }
    this.state(target).written = true;
    if (word === "TRUNCATE") {
      this.readMoreTruncated(cursor);
      return;
    }
    const rest = cursor.rest();
    if (writesSeveralTables(word, rest)) this.anyWritten = true;
    if (word === "INSERT") this.readRebuildCopy(rest, target, index);
  }

  /**
   * The words before a row write's table: its modifiers, SQLite's `OR <resolution>`, `INTO`,
   * `FROM`, `TABLE`, PostgreSQL's `ONLY`. False when the table cannot be read from where it
   * stands (MySQL's multi-table `DELETE a FROM a JOIN b` names its tables before FROM).
   */
  private readRowWriteLead(cursor: StatementCursor, word: string): boolean {
    for (const modifier of ROW_MODIFIERS) cursor.accept(modifier);
    // SQLite's `INSERT OR REPLACE` / `UPDATE OR IGNORE`: the word after OR is not the table.
    const resolution = cursor.peek(1);
    if (cursor.isWord("OR") && typeof resolution === "string") {
      cursor.accept("OR", resolution);
    }
    const lead = TABLE_LEADS[word];
    const led = lead === undefined || cursor.accept(lead);
    if (word === "DELETE" && !led) return false;
    // PostgreSQL's `DELETE FROM ONLY t` / `TRUNCATE ONLY t`.
    cursor.accept("ONLY");
    return true;
  }

  /** `TRUNCATE a, b, ...`: each further table it empties. */
  private readMoreTruncated(cursor: StatementCursor): void {
    while (cursor.accept(",")) {
      const next = cursor.name();
      if (next === undefined) this.anyWritten = true;
      else this.state(next).written = true;
    }
  }

  /**
   * `INSERT INTO __new_t [(cols)] SELECT items FROM t ...`, where the unit created `__new_t`: a
   * rebuild of t. Each NOT NULL column of the twin is a change on t: the null rows of the column
   * of t copied into it, or every row of t when nothing is copied into it and it has no value of
   * its own. A copied item that is not a plain column, or a copy from more than one table, is
   * not read.
   */
  private readRebuildCopy(
    rest: readonly StatementToken[],
    twin: string,
    index: number
  ): void {
    const definitions = this.created.get(twin);
    if (definitions === undefined || !twin.startsWith(REBUILD_PREFIX)) return;
    const table = twin.slice(REBUILD_PREFIX.length);
    const copied = rebuildCopyColumns(rest, definitions, table);
    if (copied === undefined) return;
    for (const definition of definitions) {
      if (!definition.notNull) continue;
      if (copied.has(definition.name)) {
        const column = copied.get(definition.name);
        if (column) this.change(index, table, column, definition.name);
      } else if (!definition.hasValue) {
        this.change(index, table, null, definition.name);
      }
    }
  }

  /**
   * `CREATE TABLE [IF NOT EXISTS] t (...)`: t made by the unit, with its columns. With IF NOT
   * EXISTS it may be the table already there, which the statement leaves as it is, rows and all.
   */
  private readCreateTable(cursor: StatementCursor): void {
    cursor.acceptCondition();
    const table = cursor.name();
    if (table === undefined) return;
    const rest = cursor.rest();
    const columns = bodyColumns(rest);
    if (columns !== undefined) this.created.set(table, columns);
    if (cursor.conditional) {
      // `CREATE TABLE IF NOT EXISTS t AS SELECT ...` writes rows only when it creates t.
      if (rest.includes("SELECT")) this.state(table).written = true;
      return;
    }
    this.tables.set(table, {
      origin: null,
      columns: new Map(),
      addedEmpty: new Set(),
      ifMissing: new Set(),
      // `CREATE TABLE t AS SELECT ...` writes the rows it creates.
      written: rest.includes("SELECT"),
    });
  }

  /** `DROP TABLE [IF EXISTS] a[, b...]`: each gone, kept for a twin renamed back onto it. */
  private readDropTables(cursor: StatementCursor): void {
    cursor.acceptCondition();
    do {
      const table = cursor.name();
      if (table === undefined) return;
      this.dropped.set(table, this.state(table));
      this.tables.delete(table);
    } while (cursor.accept(","));
  }

  /** MySQL's `RENAME TABLE a TO b[, c TO d]`. */
  private readRenameTables(cursor: StatementCursor): void {
    do {
      const from = cursor.name();
      if (from === undefined || !cursor.accept("TO")) return;
      const to = cursor.name();
      if (to === undefined) return;
      this.renameTable(from, to);
    } while (cursor.accept(","));
  }

  /**
   * A table renamed. A rebuild's twin renamed back onto the table it rebuilt, which the unit
   * dropped, IS that table again: its rows were copied from it.
   */
  private renameTable(from: string, to: string): void {
    const state = this.state(from);
    this.tables.delete(from);
    const rebuilt = this.dropped.get(to);
    if (from === `${REBUILD_PREFIX}${to}` && rebuilt !== undefined) {
      this.tables.set(to, {
        ...rebuilt,
        written: rebuilt.written || state.written,
      });
      this.dropped.delete(to);
      return;
    }
    this.tables.set(to, state);
  }

  /** `ALTER TABLE [IF EXISTS] [ONLY] t <clause>[, <clause>...]`. */
  private readAlterTable(cursor: StatementCursor, index: number): void {
    cursor.acceptCondition();
    cursor.accept("ONLY");
    // A qualified target is read under its own name, with the qualifier kept on each change it
    // makes, for the guard to decide which schema that reaches.
    const qualified = cursor.qualifiedName();
    let table = qualified?.name ?? cursor.name();
    if (table === undefined) return;
    this.qualifier = qualified?.qualifier;
    try {
      for (const tokens of cursor.clauses()) {
        const renamedTo = this.readAlterClause(
          new StatementCursor(tokens),
          table,
          index
        );
        if (renamedTo !== undefined) table = renamedTo;
      }
    } finally {
      this.qualifier = undefined;
    }
  }

  /** One clause of an ALTER TABLE on `table`; returns the table's new name when it renames it. */
  private readAlterClause(
    clause: StatementCursor,
    table: string,
    index: number
  ): string | undefined {
    // One reader per clause kind; a RENAME may rename the table, so it answers the new name.
    if (clause.accept("ADD")) this.readAddClause(clause, table, index);
    else if (clause.accept("ALTER"))
      this.readAlterColumnClause(clause, table, index);
    else if (clause.accept("MODIFY"))
      this.readModifyClause(clause, table, index);
    else if (clause.accept("CHANGE"))
      this.readChangeClause(clause, table, index);
    else if (clause.accept("RENAME"))
      return this.readRename(clause, table, this.state(table));
    else if (clause.accept("DROP")) this.readDropClause(clause, table);
    return undefined;
  }

  /** `ADD [COLUMN] c <definition>`: a NOT NULL column with no value breaks every row. */
  private readAddClause(
    clause: StatementCursor,
    table: string,
    index: number
  ): void {
    const first = clause.peek();
    if (typeof first === "string" && NON_COLUMN_WORDS.has(first)) return;
    clause.accept("COLUMN");
    clause.acceptCondition();
    const column = clause.name();
    if (column === undefined) return;
    const definition = readDefinition(column, clause.rest());
    if (definition.notNull && !definition.hasValue) {
      this.change(index, table, null, column);
    }
    const state = this.state(table);
    // `IF NOT EXISTS` adds nothing over a column already there, which keeps its name and rows.
    if (clause.conditional) state.ifMissing.add(column);
    else state.columns.set(column, null);
    if (definition.hasValue) state.addedEmpty.delete(column);
    else state.addedEmpty.add(column);
  }

  /** `ALTER [COLUMN] c SET NOT NULL`. */
  private readAlterColumnClause(
    clause: StatementCursor,
    table: string,
    index: number
  ): void {
    clause.accept("COLUMN");
    const column = clause.name();
    if (column !== undefined && clause.accept("SET", "NOT", "NULL")) {
      this.change(index, table, column, column);
    }
  }

  /** `MODIFY [COLUMN] c <definition> NOT NULL`. */
  private readModifyClause(
    clause: StatementCursor,
    table: string,
    index: number
  ): void {
    clause.accept("COLUMN");
    const column = clause.name();
    if (column !== undefined && readDefinition(column, clause.rest()).notNull) {
      this.change(index, table, column, column);
    }
  }

  /** `CHANGE [COLUMN] old new <definition>`: the old column's rows, the new one required. */
  private readChangeClause(
    clause: StatementCursor,
    table: string,
    index: number
  ): void {
    clause.accept("COLUMN");
    const from = clause.name();
    const to = clause.name();
    if (from === undefined || to === undefined) return;
    if (readDefinition(to, clause.rest()).notNull) {
      this.change(index, table, from, to);
    }
    this.renameColumn(this.state(table), from, to);
  }

  /** `DROP [COLUMN] c`: the column is gone, so a later one of its name is the unit's own. */
  private readDropClause(clause: StatementCursor, table: string): void {
    clause.accept("COLUMN");
    clause.acceptCondition();
    const column = clause.name();
    if (column === undefined) return;
    const state = this.state(table);
    state.columns.set(column, null);
    state.addedEmpty.delete(column);
    state.ifMissing.delete(column);
  }

  /**
   * `RENAME [COLUMN] a TO b` (a column), `RENAME [TO|AS] u` (the table); an index, key or
   * constraint renamed leaves the table and its columns as they were.
   */
  private readRename(
    clause: StatementCursor,
    table: string,
    state: TableState
  ): string | undefined {
    if (RENAME_KEEPS_COLUMNS.some(word => clause.isWord(word))) {
      return undefined;
    }
    if (clause.accept("COLUMN")) {
      this.readColumnRenameTo(clause, state, clause.name());
      return undefined;
    }
    if (!clause.accept("TO")) clause.accept("AS");
    const to = clause.name();
    if (to === undefined) return undefined;
    // `RENAME a TO b` without COLUMN is a column rename on PostgreSQL and SQLite: `a` was a column.
    if (clause.isWord("TO")) {
      this.readColumnRenameTo(clause, state, to);
      return undefined;
    }
    this.renameTable(table, to);
    return to;
  }

  /** `TO b` after a column's name `from`: the column renamed. */
  private readColumnRenameTo(
    clause: StatementCursor,
    state: TableState,
    from: string | undefined
  ): void {
    if (from === undefined || !clause.accept("TO")) return;
    const to = clause.name();
    if (to !== undefined) this.renameColumn(state, from, to);
  }

  private renameColumn(state: TableState, from: string, to: string): void {
    if (from === to) return;
    state.columns.set(to, this.columnOrigin(state, from));
    state.columns.set(from, null);
    // A column added empty stays empty under its new name, and one added IF NOT EXISTS may still
    // be the one already there.
    if (state.addedEmpty.delete(from)) state.addedEmpty.add(to);
    if (state.ifMissing.delete(from)) state.ifMissing.add(to);
  }
}

/**
 * Every column the statements of one unit make NOT NULL, in statement order, with what the
 * statements before each did to its table. The one reading of a file's required columns.
 */
export function readNotNullChanges(
  statements: readonly string[],
  dialect: SupportedDialect
): NotNullChange[] {
  const reader = new UnitReader(dialect);
  for (let index = 0; index < statements.length; index++) {
    // A MySQL run `migrate:create` writes builds its statement from the catalog when the file
    // runs. It is read as the plain statement it amounts to, at its first statement, which
    // writes no row.
    const run =
      dialect === "mysql" ? mysqlLiveRunAt(statements, index) : undefined;
    if (run === undefined) {
      reader.read(statements[index], index);
      continue;
    }
    reader.read(plainMysqlStatement(run), index);
    index += MYSQL_LIVE_RUN_LENGTH - 1;
  }
  return reader.changes;
}
