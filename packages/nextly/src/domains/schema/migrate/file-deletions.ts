/**
 * Which data a migration file (or a down section) deletes, read from its
 * statements for the running dialect — never from any mark in its header.
 *
 * A statement deletes data when it, as written:
 *
 * - drops a table (`DROP TABLE`, MariaDB's `CREATE OR REPLACE TABLE`): a
 *   `table` deletion. A table the same list created earlier is scratch, and
 *   dropping it again deletes nothing that was there before the file.
 * - drops a column, or changes its type (`ALTER ... TYPE`, MySQL's `MODIFY`
 *   and `CHANGE`): a `column` deletion. A changed type may not hold every
 *   value, so it needs consent naming the column like a drop does.
 * - removes rows (`DELETE`, `TRUNCATE`, `REPLACE`, SQLite's `OR REPLACE`): a
 *   `rows` deletion, and one for each table a foreign key's `ON DELETE
 *   CASCADE` (or PostgreSQL's `TRUNCATE ... CASCADE`) reaches from it, read
 *   from the live database (`DeletionFacts`). When those cannot be read, an
 *   `unnamed` deletion stands for them, which only consent without targets
 *   covers: a list cannot name tables nobody could read.
 * - rebuilds a SQLite table (`__new_t` created, rows copied, `t` dropped,
 *   `__new_t` renamed to `t`): judged by what it does to `t` — each live
 *   column it leaves out or converts, and its rows when the copy does not
 *   take them all — never as a drop of `t`.
 * - is a statement this reading cannot place that may still delete: a
 *   procedural block, a `DROP ... CASCADE` of something other than a table,
 *   a schema-qualified name, or any unread statement whose code says DROP,
 *   DELETE, TRUNCATE or REPLACE: an `unnamed` deletion labelled by the
 *   statement.
 *
 * Statements are read through the shared cursor over the splitter's tokens
 * (`cursorOf`), so a word inside a string literal or a comment is never code.
 * Renames are followed, so a table or column dropped under a name the file
 * gave it is named by the name it has in the database. No deletion carries
 * `core`: a file's drop is never covered by the earlier spelling that covers
 * only Nextly's own tables.
 *
 * @module domains/schema/migrate/file-deletions
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import type { LiveColumns } from "../ownership/drop-guard";
import {
  introspectLiveSnapshot,
  introspectTableNames,
} from "../pipeline/diff/introspect-live";
import { queryLiveColumnTypes } from "../pipeline/live-column-types";
import { readReferencingTables } from "../pipeline/live-table-facts";

import type { Deletion } from "./data-loss-consent";
import type { QuotedToken } from "./split-sql";
import { cursorOf, StatementCursor } from "./statement-cursor";

/** The live database facts a file's deletions are judged against, read once before the file runs. */
export interface DeletionFacts {
  /**
   * Every table (lower-cased) whose rows a row removal in `table` also removes through
   * ON DELETE CASCADE foreign keys, followed transitively, `table` itself excluded. Undefined when
   * the foreign keys could not be read. On SQLite: always empty, since the runner applies a
   * migration with foreign-key enforcement off and no cascade fires.
   */
  cascadeFrom(table: string): readonly string[] | undefined;
  /**
   * PostgreSQL only: every table `TRUNCATE <table> CASCADE` also empties (every table with a
   * foreign key referencing it, whatever its ON DELETE action, transitively). Undefined when unreadable.
   */
  truncateCascadeFrom(table: string): readonly string[] | undefined;
  /** The live columns of the tables a SQLite rebuild in the file rebuilds (drop-guard's `readLiveColumns`). */
  liveColumns: LiveColumns;
  /**
   * The declared type of each of those columns as SQLite reports it, lower-cased, by lower-cased
   * table and column. A rebuild column whose type is absent here counts as converted, so facts
   * without it judge every carried column a possible deletion rather than none.
   */
  liveColumnTypes?: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

type Token = string | QuotedToken;

/**
 * The facts a walk asks, one question each, so the reading of facts
 * (`readDeletionFacts`) can record exactly what `fileDeletions` will ask.
 */
interface FactSource {
  cascadeFrom(table: string): readonly string[] | undefined;
  truncateCascadeFrom(table: string): readonly string[] | undefined;
  liveColumns(table: string): ReadonlySet<string> | undefined;
  liveType(table: string, column: string): string | undefined;
}

/** How a removal of rows reaches other tables. */
type Reach = "delete" | "truncate" | "none";

/** What one statement does that can delete data, or change which name means which table. */
type Step =
  | { kind: "create"; table: string }
  | { kind: "drop"; table: string }
  | { kind: "rows"; table: string; reach: Reach }
  | { kind: "column"; table: string; column: string }
  | { kind: "drop-column"; table: string; column: string }
  | { kind: "rename-table"; from: string; to: string }
  | { kind: "rename-column"; table: string; from: string; to: string }
  | { kind: "unread"; description: string };

/** Words whose presence in an unread statement's code means it may delete. */
const DELETING_WORDS = new Set(["DROP", "DELETE", "TRUNCATE", "REPLACE"]);

/** First words of a statement that runs code its text does not show. */
const CODE_WORDS = new Set(["DO", "CALL", "EXECUTE", "EXEC", "PREPARE"]);

/**
 * First words of a statement that cannot delete, whatever words follow: a
 * creation (a trigger's body is code it runs later, not now), a write that
 * keeps its rows (`REPLACE(...)` is then a string function), a read, a
 * session setting, a grant or a transaction bracket. Their own exceptions
 * (`CREATE OR REPLACE TABLE`, `INSERT OR REPLACE`, `UPDATE OR REPLACE`) are
 * read before this list is consulted.
 */
const NEVER_DELETING = new Set([
  "CREATE",
  "INSERT",
  "UPDATE",
  "SELECT",
  "VALUES",
  "SET",
  "RESET",
  "PRAGMA",
  "COMMENT",
  "GRANT",
  "REVOKE",
  "ANALYZE",
  "VACUUM",
  "REINDEX",
  "SAVEPOINT",
  "RELEASE",
  "BEGIN",
  "START",
  "COMMIT",
  "END",
]);

/**
 * Objects whose drop, without CASCADE, removes no row and no column: what
 * they hold is derived (an index, a view) or is code or a definition the
 * database refuses to drop while a column still uses it. With CASCADE each
 * may take what depends on it, which the text does not show. A schema is
 * here on PostgreSQL only: MySQL's `DROP SCHEMA` drops a database with its
 * tables.
 */
const DEFINITION_KINDS = new Set([
  "INDEX",
  "VIEW",
  "MATERIALIZED",
  "SEQUENCE",
  "TRIGGER",
  "TYPE",
  "DOMAIN",
  "FUNCTION",
  "PROCEDURE",
  "AGGREGATE",
  "OPERATOR",
  "EXTENSION",
  "POLICY",
  "RULE",
  "EVENT",
  "ROLE",
  "USER",
  "COLLATION",
  "STATISTICS",
  "PUBLICATION",
  "SUBSCRIPTION",
]);

/** Words after `DROP` in an ALTER TABLE clause that drop no column's data. */
const DROPPED_ELEMENTS = new Set([
  "CONSTRAINT",
  "INDEX",
  "KEY",
  "FOREIGN",
  "PRIMARY",
  "CHECK",
]);

/** Words after `ALTER` in an ALTER TABLE clause that alter no column. */
const ALTERED_ELEMENTS = new Set(["CONSTRAINT", "INDEX", "CHECK"]);

/** Words that open a table constraint in a CREATE TABLE body, not a column. */
const TABLE_CONSTRAINT_WORDS = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "FOREIGN",
  "UNIQUE",
  "CHECK",
]);

/** Words that end a column definition's declared type: its first constraint. */
const COLUMN_CONSTRAINT_WORDS = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "NOT",
  "NULL",
  "UNIQUE",
  "CHECK",
  "DEFAULT",
  "COLLATE",
  "REFERENCES",
  "GENERATED",
  "AS",
]);

/** A SQLite rebuild's twin name for a table. */
const REBUILD_PREFIX = "__new_";

/** Longest label, in characters, the ellipsis included. */
const LABEL_LIMIT = 60;

/**
 * A statement's leading words, for a person to find it by, up to its first
 * string literal or `(`. A string can hold row data, so none reaches a label.
 */
function labelOf(tokens: readonly Token[]): string {
  const words: string[] = [];
  for (const token of tokens) {
    if (typeof token !== "string") {
      if (token.name === undefined) break;
      words.push(`"${token.name.toLowerCase()}"`);
      continue;
    }
    if (token === "(") break;
    words.push(token);
  }
  const label = words.join(" ");
  return label.length > LABEL_LIMIT
    ? `${label.slice(0, LABEL_LIMIT - 1).trimEnd()}…`
    : label;
}

/** The deletion standing for a statement this reading does not place. */
function unread(tokens: readonly Token[]): Step {
  return {
    kind: "unread",
    description: `${labelOf(tokens)} (not read, may delete data)`,
  };
}

/** Whether a statement's code (not its strings or comments) says it may delete. */
function saysDelete(tokens: readonly Token[]): boolean {
  return tokens.some(
    token => typeof token === "string" && DELETING_WORDS.has(token)
  );
}

/** Nothing, or `unread` when the code says it may delete. */
function unreadIfDeleting(tokens: readonly Token[]): Step[] {
  return saysDelete(tokens) ? [unread(tokens)] : [];
}

/** All of a statement's tokens, its trailing `;` dropped (`cursorOf`). */
function tokensOf(statement: string, dialect: SupportedDialect): Token[] {
  return cursorOf(statement, dialect).rest();
}

/** What one statement does, as steps in the order it does them. */
function readStatement(statement: string, dialect: SupportedDialect): Step[] {
  const tokens = tokensOf(statement, dialect);
  const cursor = new StatementCursor(tokens);
  const first = cursor.peek();
  if (typeof first !== "string") return unreadIfDeleting(tokens);
  if (CODE_WORDS.has(first)) return [unread(tokens)];
  if (cursor.accept("CREATE")) return readCreate(cursor, tokens);
  if (cursor.accept("DROP")) return readDrop(cursor, tokens, dialect);
  if (cursor.accept("ALTER", "TABLE")) {
    return readAlterTable(cursor, tokens, dialect);
  }
  if (cursor.accept("DELETE")) return readDelete(cursor, tokens);
  if (cursor.accept("TRUNCATE")) return readTruncate(cursor, tokens, dialect);
  if (dialect !== "postgresql" && cursor.accept("REPLACE")) {
    return readRowsInto(cursor, tokens);
  }
  if (dialect === "sqlite" && cursor.accept("INSERT", "OR", "REPLACE")) {
    return readRowsInto(cursor, tokens);
  }
  if (dialect === "sqlite" && cursor.accept("UPDATE", "OR", "REPLACE")) {
    // A uniqueness conflict deletes the rows in the way of the update.
    const table = cursor.name();
    return table === undefined
      ? [unread(tokens)]
      : [{ kind: "rows", table, reach: "delete" }];
  }
  if (dialect === "mysql" && cursor.accept("RENAME", "TABLE")) {
    return readRenameTables(cursor, tokens);
  }
  if (NEVER_DELETING.has(first)) return [];
  return unreadIfDeleting(tokens);
}

/**
 * `CREATE [TEMPORARY] TABLE t`: t is the list's own from here, unless written
 * `IF NOT EXISTS`, which may leave a live table of that name in place.
 * MariaDB's `CREATE OR REPLACE TABLE t` drops t first. Any other creation
 * deletes nothing now.
 */
function readCreate(cursor: StatementCursor, tokens: readonly Token[]): Step[] {
  if (cursor.accept("OR", "REPLACE")) {
    cursor.accept("TEMPORARY");
    if (!cursor.accept("TABLE")) return [];
    const table = cursor.name();
    return table === undefined
      ? [unread(tokens)]
      : [
          { kind: "drop", table },
          { kind: "create", table },
        ];
  }
  if (!cursor.accept("TEMPORARY")) cursor.accept("TEMP");
  if (!cursor.accept("TABLE")) return [];
  if (cursor.accept("IF", "NOT", "EXISTS")) return [];
  const table = cursor.name();
  return table === undefined ? [] : [{ kind: "create", table }];
}

/**
 * `DROP [TEMPORARY] TABLE [IF EXISTS] a[, b...] [CASCADE|RESTRICT]`: each
 * table. A table's CASCADE takes views and other tables' foreign key
 * constraints, never their rows. A drop of anything else is a definition's
 * (`DEFINITION_KINDS`), deleting nothing, unless written with CASCADE.
 */
function readDrop(
  cursor: StatementCursor,
  tokens: readonly Token[],
  dialect: SupportedDialect
): Step[] {
  // MySQL's temporary tables live for the session, holding nothing a
  // migration could have found there.
  if (cursor.accept("TEMPORARY")) return [];
  if (cursor.accept("TABLE")) {
    cursor.acceptCondition();
    const tables: string[] = [];
    do {
      const table = cursor.name();
      if (table === undefined) return [unread(tokens)];
      tables.push(table);
    } while (cursor.accept(","));
    if (!cursor.accept("CASCADE")) cursor.accept("RESTRICT");
    if (!cursor.done()) return [unread(tokens)];
    return tables.map(table => ({ kind: "drop", table }));
  }
  const kind = cursor.peek();
  const definition =
    typeof kind === "string" &&
    (DEFINITION_KINDS.has(kind) ||
      (kind === "SCHEMA" && dialect === "postgresql"));
  return definition && !tokens.includes("CASCADE") ? [] : [unread(tokens)];
}

/**
 * `DELETE [LOW_PRIORITY] [QUICK] [IGNORE] FROM [ONLY] t ...`: t's rows, with
 * or without a condition, and what its cascades reach. MySQL's multi-table
 * forms (`DELETE a FROM ...`, `DELETE FROM a, b USING ...`) are unread.
 */
function readDelete(cursor: StatementCursor, tokens: readonly Token[]): Step[] {
  for (const modifier of ["LOW_PRIORITY", "QUICK", "IGNORE"]) {
    cursor.accept(modifier);
  }
  if (!cursor.accept("FROM")) return [unread(tokens)];
  cursor.accept("ONLY");
  const table = cursor.name();
  if (table === undefined || cursor.isWord(",")) return [unread(tokens)];
  return [{ kind: "rows", table, reach: "delete" }];
}

/**
 * `TRUNCATE [TABLE] [ONLY] t [*][, u...] [RESTART|CONTINUE IDENTITY]
 * [CASCADE|RESTRICT]`: each table's rows. A truncate fires no ON DELETE
 * action; PostgreSQL's CASCADE empties every table referencing one, and
 * without it refuses a referenced table. SQLite has no TRUNCATE: the
 * statement fails there, deleting nothing.
 */
function readTruncate(
  cursor: StatementCursor,
  tokens: readonly Token[],
  dialect: SupportedDialect
): Step[] {
  if (dialect === "sqlite") return [];
  cursor.accept("TABLE");
  const tables: string[] = [];
  do {
    if (dialect === "postgresql") cursor.accept("ONLY");
    const table = cursor.name();
    if (table === undefined) return [unread(tokens)];
    cursor.accept("*");
    tables.push(table);
  } while (cursor.accept(","));
  if (!cursor.accept("RESTART", "IDENTITY")) {
    cursor.accept("CONTINUE", "IDENTITY");
  }
  const cascade = dialect === "postgresql" && cursor.accept("CASCADE");
  if (!cascade) cursor.accept("RESTRICT");
  if (!cursor.done()) return [unread(tokens)];
  return tables.map(table => ({
    kind: "rows",
    table,
    reach: cascade ? "truncate" : "none",
  }));
}

/**
 * `REPLACE [LOW_PRIORITY|DELAYED] [INTO] t ...` and SQLite's `INSERT OR
 * REPLACE INTO t`, from past their opening words: a row in the way of a new
 * one is deleted (its cascades with it), so t's rows.
 */
function readRowsInto(
  cursor: StatementCursor,
  tokens: readonly Token[]
): Step[] {
  if (!cursor.accept("LOW_PRIORITY")) cursor.accept("DELAYED");
  cursor.accept("INTO");
  const table = cursor.name();
  return table === undefined
    ? [unread(tokens)]
    : [{ kind: "rows", table, reach: "delete" }];
}

/** MySQL's `RENAME TABLE a TO b[, c TO d]`: each rename, in order. */
function readRenameTables(
  cursor: StatementCursor,
  tokens: readonly Token[]
): Step[] {
  const steps: Step[] = [];
  do {
    const from = cursor.name();
    if (from === undefined || !cursor.accept("TO")) return [unread(tokens)];
    const to = cursor.name();
    if (to === undefined) return [unread(tokens)];
    steps.push({ kind: "rename-table", from, to });
  } while (cursor.accept(","));
  return cursor.done() ? steps : [unread(tokens)];
}

/**
 * `ALTER TABLE [IF EXISTS] [ONLY] t <clause>[, <clause>...]`: each clause's
 * steps. A clause this reading cannot place makes the whole statement
 * unread when its code may delete, and so does a schema-qualified table: the
 * table it reaches is not known.
 */
function readAlterTable(
  cursor: StatementCursor,
  tokens: readonly Token[],
  dialect: SupportedDialect
): Step[] {
  cursor.acceptCondition();
  if (dialect === "postgresql") cursor.accept("ONLY");
  const table = cursor.name();
  // A qualified name leaves its clauses unread: any word that can open a
  // clause dropping or converting a column makes the statement unread.
  if (table === undefined) {
    return tokens.some(
      token =>
        typeof token === "string" &&
        (DELETING_WORDS.has(token) || CONVERTING_WORDS.has(token))
    )
      ? [unread(tokens)]
      : [];
  }
  const steps: Step[] = [];
  for (const clause of cursor.clauses()) {
    const read = readAlterClause(new StatementCursor(clause), table, dialect);
    // A clause not placed is one that may delete (`readAlterClause`).
    if (read === undefined) return [unread(tokens)];
    steps.push(...read);
  }
  return steps;
}

/** Words that open an ALTER TABLE clause converting a column's values. */
const CONVERTING_WORDS = new Set([
  "TYPE",
  "MODIFY",
  "CHANGE",
  "CONVERT",
  "PARTITION",
]);

/**
 * One ALTER TABLE clause on `table`: its steps, or undefined when it is not
 * placed and may delete. A clause not placed whose code cannot delete (an
 * option, an owner, a trigger switched) has no steps.
 */
function readAlterClause(
  clause: StatementCursor,
  table: string,
  dialect: SupportedDialect
): Step[] | undefined {
  if (clause.accept("ADD")) return [];
  if (clause.accept("DROP")) return readDropClause(clause, table);
  if (clause.accept("RENAME")) return readRenameClause(clause, table, dialect);
  if (clause.accept("ALTER")) return readAlterColumn(clause, table);
  if (dialect === "mysql") {
    if (clause.accept("MODIFY")) {
      clause.accept("COLUMN");
      const column = clause.name();
      return column === undefined
        ? undefined
        : [{ kind: "column", table, column }];
    }
    if (clause.accept("CHANGE")) {
      // A CHANGE restates the column's type, so its values are judged as a
      // type change; under a new name the old one is gone as well.
      clause.accept("COLUMN");
      const from = clause.name();
      const to = clause.name();
      if (from === undefined || to === undefined) return undefined;
      const changed: Step[] = [{ kind: "column", table, column: from }];
      if (from !== to) {
        changed.push({ kind: "rename-column", table, from, to });
      }
      return changed;
    }
    // Converting the table's character set rewrites every text column.
    if (clause.isWord("CONVERT")) return undefined;
    if (clause.accept("TRUNCATE", "PARTITION")) {
      return [{ kind: "rows", table, reach: "none" }];
    }
  }
  return saysDelete(clause.rest()) ? undefined : [];
}

/**
 * `DROP [COLUMN] [IF EXISTS] c [CASCADE|RESTRICT]`, a column. A constraint,
 * index or key drops no data; MySQL's `DROP PARTITION` drops the partition's
 * rows. Anything else is not placed.
 */
function readDropClause(
  clause: StatementCursor,
  table: string
): Step[] | undefined {
  if (clause.accept("PARTITION")) {
    return [{ kind: "rows", table, reach: "none" }];
  }
  const explicit = clause.accept("COLUMN");
  const next = clause.peek();
  if (!explicit && typeof next === "string" && DROPPED_ELEMENTS.has(next)) {
    return [];
  }
  clause.acceptCondition();
  const column = clause.name();
  if (column === undefined) return undefined;
  if (!clause.accept("CASCADE")) clause.accept("RESTRICT");
  return clause.done() ? [{ kind: "drop-column", table, column }] : undefined;
}

/**
 * `RENAME TO|AS u` (MySQL also bare `RENAME u`), the table; `RENAME [COLUMN]
 * a TO b`, a column; a constraint, index or key renamed, nothing.
 */
function readRenameClause(
  clause: StatementCursor,
  table: string,
  dialect: SupportedDialect
): Step[] | undefined {
  if (clause.accept("TO") || clause.accept("AS")) {
    const to = clause.name();
    return to === undefined
      ? undefined
      : [{ kind: "rename-table", from: table, to }];
  }
  if (
    clause.accept("CONSTRAINT") ||
    clause.accept("INDEX") ||
    clause.accept("KEY")
  ) {
    return [];
  }
  const explicit = clause.accept("COLUMN");
  const from = clause.name();
  if (from === undefined) return undefined;
  if (dialect === "mysql" && !explicit && clause.done()) {
    return [{ kind: "rename-table", from: table, to: from }];
  }
  if (!clause.accept("TO")) return undefined;
  const to = clause.name();
  return to === undefined
    ? undefined
    : [{ kind: "rename-column", table, from, to }];
}

/**
 * `ALTER [COLUMN] c [SET DATA] TYPE ...`, a type change; any other change of
 * a column (its default, nullability, statistics) keeps its values.
 */
function readAlterColumn(
  clause: StatementCursor,
  table: string
): Step[] | undefined {
  const next = clause.peek();
  if (typeof next === "string" && ALTERED_ELEMENTS.has(next)) return [];
  clause.accept("COLUMN");
  const column = clause.name();
  if (column === undefined) return undefined;
  return clause.accept("TYPE") || clause.accept("SET", "DATA", "TYPE")
    ? [{ kind: "column", table, column }]
    : [];
}

/** A rebuild twin's column: its declared type spelled for comparison, or undefined when unreadable. */
interface TwinColumn {
  name: string;
  type: string | undefined;
}

/**
 * A SQLite rebuild of one table: the statements that make it, by index, and
 * the twin's declared columns.
 */
interface Rebuild {
  table: string;
  twin: string;
  createAt: number;
  dropAt: number;
  renameAt: number;
  copies: number[];
  columns: TwinColumn[];
}

/**
 * A declared type spelled for comparison: lower-cased, without spaces — the
 * spelling `PRAGMA table_info` reports for it, lower-cased, compares equal.
 */
function typeSpelling(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

/**
 * `CREATE TABLE [IF NOT EXISTS] __new_t (...)`: the twin, the table it stands
 * in for and its columns, or undefined when the statement is not one.
 */
function twinCreatedBy(
  statement: string
): { twin: string; table: string; columns: TwinColumn[] } | undefined {
  const cursor = cursorOf(statement, "sqlite");
  if (!cursor.accept("CREATE", "TABLE")) return undefined;
  cursor.acceptCondition();
  const twin = cursor.name();
  if (twin === undefined || !twin.startsWith(REBUILD_PREFIX)) return undefined;
  if (!cursor.isWord("(")) return undefined;
  const columns: TwinColumn[] = [];
  for (const item of bodyItems(cursor.rest())) {
    const first = item[0];
    if (typeof first === "string" && TABLE_CONSTRAINT_WORDS.has(first))
      continue;
    const name = new StatementCursor(item).name();
    if (name === undefined) return undefined;
    columns.push({ name, type: declaredType(item.slice(1)) });
  }
  return { twin, table: twin.slice(REBUILD_PREFIX.length), columns };
}

/** The items of a parenthesised body opening the tokens, split at its own commas. */
function bodyItems(tokens: readonly Token[]): Token[][] {
  const items: Token[][] = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (token === ")") depth -= 1;
    if (depth === 0 && token === ")") break;
    if (depth === 1 && token === ",") items.push([]);
    else if (depth >= 1) items[items.length - 1].push(token);
    if (token === "(") depth += 1;
  }
  return items.filter(item => item.length > 0);
}

/**
 * A column definition's declared type — every token before its first
 * constraint — spelled for comparison, or undefined when a quoted unit is
 * part of it, which this spelling cannot compare.
 */
function declaredType(tokens: readonly Token[]): string | undefined {
  const type: string[] = [];
  for (const token of tokens) {
    if (typeof token !== "string") return undefined;
    if (COLUMN_CONSTRAINT_WORDS.has(token)) break;
    type.push(token);
  }
  return typeSpelling(type.join(""));
}

/** `ALTER TABLE __new_t RENAME TO t`, exactly. */
function renamesBack(statement: string, twin: string, table: string): boolean {
  const cursor = cursorOf(statement, "sqlite");
  return (
    cursor.accept("ALTER", "TABLE") &&
    cursor.name() === twin &&
    cursor.accept("RENAME", "TO") &&
    cursor.name() === table &&
    cursor.done()
  );
}

/** `DROP TABLE [IF EXISTS] t`, exactly, naming t alone. */
function dropsOnly(statement: string, table: string): boolean {
  const cursor = cursorOf(statement, "sqlite");
  if (!cursor.accept("DROP", "TABLE")) return false;
  cursor.acceptCondition();
  return cursor.name() === table && cursor.done();
}

/** `INSERT [OR x] INTO <twin> ...`: a statement writing into the twin. */
function insertsInto(statement: string, twin: string): boolean {
  const tokens = tokensOf(statement, "sqlite");
  const into = tokens.indexOf("INTO");
  return (
    tokens[0] === "INSERT" &&
    into !== -1 &&
    new StatementCursor(tokens.slice(into + 1)).name() === twin
  );
}

/**
 * Every SQLite rebuild in the list: a twin created, then the table dropped,
 * then the twin renamed back, with the copies into the twin between its
 * creation and the drop. Only SQLite rebuilds a table to change it; on the
 * other dialects the same statements are the drop they read as.
 */
function rebuildsIn(
  statements: readonly string[],
  dialect: SupportedDialect
): Rebuild[] {
  if (dialect !== "sqlite") return [];
  const rebuilds: Rebuild[] = [];
  for (let createAt = 0; createAt < statements.length; createAt += 1) {
    const created = twinCreatedBy(statements[createAt]);
    if (created === undefined) continue;
    const { twin, table } = created;
    const renameAt = statements.findIndex(
      (statement, at) => at > createAt && renamesBack(statement, twin, table)
    );
    if (renameAt === -1) continue;
    const dropAt = statements.findIndex(
      (statement, at) =>
        at > createAt && at < renameAt && dropsOnly(statement, table)
    );
    if (dropAt === -1) continue;
    const copies: number[] = [];
    for (let at = createAt + 1; at < dropAt; at += 1) {
      if (insertsInto(statements[at], twin)) copies.push(at);
    }
    rebuilds.push({ ...created, createAt, dropAt, renameAt, copies });
  }
  return rebuilds;
}

/**
 * A rebuild's copy, read: the table it copies from, whether it takes every
 * row (no conflict clause, no DISTINCT, nothing after `FROM t`), and which
 * source column fills each twin column, by twin column. Undefined when the
 * copy is not `INSERT [OR x] INTO twin [(cols)] SELECT ... FROM src ...`.
 */
function readCopy(
  statement: string,
  twin: string,
  columns: readonly TwinColumn[]
):
  | { from: string | undefined; allRows: boolean; filled: Map<string, string> }
  | undefined {
  const cursor = cursorOf(statement, "sqlite");
  if (!cursor.accept("INSERT")) return undefined;
  // `OR IGNORE` and `OR REPLACE` drop the rows a conflict meets.
  const conflict = cursor.accept("OR");
  if (conflict) cursor.name();
  if (!cursor.accept("INTO") || cursor.name() !== twin) return undefined;
  let into = columns.map(column => column.name);
  if (cursor.accept("(")) {
    into = [];
    do {
      const name = cursor.name();
      if (name === undefined) return undefined;
      into.push(name);
    } while (cursor.accept(","));
    if (!cursor.accept(")")) return undefined;
  }
  if (!cursor.accept("SELECT")) return undefined;
  const distinct = cursor.accept("DISTINCT");
  cursor.accept("ALL");
  const rest = cursor.rest();
  const fromAt = topLevelIndex(rest, "FROM");
  if (fromAt === -1) return undefined;
  const items = splitTopLevel(rest.slice(0, fromAt));
  const source = new StatementCursor(rest.slice(fromAt + 1));
  const from = source.name();
  const filled = new Map<string, string>();
  if (items.length === into.length) {
    items.forEach((item, at) => {
      const reading = new StatementCursor(item);
      const name = reading.name();
      if (name !== undefined && reading.done()) filled.set(into[at], name);
    });
  }
  return {
    from,
    allRows: !conflict && !distinct && from !== undefined && source.done(),
    filled,
  };
}

/** Where `word` stands outside every parenthesis, or -1. */
function topLevelIndex(tokens: readonly Token[], word: string): number {
  let depth = 0;
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token === "(") depth += 1;
    if (token === ")") depth -= 1;
    if (depth === 0 && token === word) return at;
  }
  return -1;
}

/** Tokens split at the commas outside every parenthesis. */
function splitTopLevel(tokens: readonly Token[]): Token[][] {
  return new StatementCursor(tokens).clauses();
}

/**
 * A live table's columns as the list has left them so far: each name it
 * renamed a column to, with the live column it was, and the live columns no
 * longer under their own name (dropped or renamed away).
 */
interface ColumnNames {
  renamed: Map<string, string>;
  away: Set<string>;
}

/** One walk over a statement list, following names and collecting deletions. */
class FileWalk {
  /** Each deletion with the part of the list (a file of a run) whose statement made it. */
  readonly found: { deletion: Deletion; part: number }[] = [];
  private readonly seen = new Set<string>();
  /** The part the statement being read belongs to. */
  private part = 0;
  /**
   * Each table name the list has given a meaning: the live table it reaches
   * (followed through renames), or null for one the list made itself.
   */
  private readonly origins = new Map<string, string | null>();
  /** Per live table, its columns as the list has left them. */
  private readonly columnNames = new Map<string, ColumnNames>();

  constructor(private readonly facts: FactSource) {}

  /** The live table a name reaches here, or null for one the list made. */
  private origin(name: string): string | null {
    const origin = this.origins.get(name);
    return origin === undefined ? name : origin;
  }

  private columnsOf(table: string): ColumnNames {
    const names = this.columnNames.get(table) ?? {
      renamed: new Map<string, string>(),
      away: new Set<string>(),
    };
    this.columnNames.set(table, names);
    return names;
  }

  /** The live column a column name of a live table reaches here. */
  private columnOrigin(table: string, column: string): string {
    return this.columnNames.get(table)?.renamed.get(column) ?? column;
  }

  /** The name a live column has here, or undefined once it is gone. */
  private currentColumn(table: string, live: string): string | undefined {
    const names = this.columnNames.get(table);
    for (const [current, origin] of names?.renamed ?? []) {
      if (origin === live) return current;
    }
    return names?.away.has(live) === true ? undefined : live;
  }

  /** The statements read next belong to `part`. */
  enter(part: number): void {
    this.part = part;
  }

  /** Records a deletion, once per part by kind, table and column. */
  private emit(deletion: Deletion): void {
    const key =
      deletion.kind === "unnamed"
        ? `unnamed:${deletion.description}`
        : deletion.kind === "column"
          ? `column:${deletion.table}.${deletion.column}`
          : `${deletion.kind}:${deletion.table}`;
    const once = `${String(this.part)}|${key}`;
    if (this.seen.has(once)) return;
    this.seen.add(once);
    this.found.push({ deletion, part: this.part });
  }

  apply(step: Step): void {
    switch (step.kind) {
      case "create":
        this.origins.set(step.table, null);
        return;
      case "drop": {
        const table = this.origin(step.table);
        if (table !== null) this.emit({ kind: "table", table });
        this.origins.set(step.table, null);
        return;
      }
      case "rows": {
        const table = this.origin(step.table);
        if (table !== null) this.removeRows(table, step.reach);
        return;
      }
      case "column": {
        const table = this.origin(step.table);
        if (table === null) return;
        this.emit({
          kind: "column",
          table,
          column: this.columnOrigin(table, step.column),
        });
        return;
      }
      case "drop-column": {
        const table = this.origin(step.table);
        if (table === null) return;
        const column = this.columnOrigin(table, step.column);
        this.emit({ kind: "column", table, column });
        const names = this.columnsOf(table);
        names.renamed.delete(step.column);
        names.away.add(column);
        return;
      }
      case "rename-table":
        this.origins.set(step.to, this.origin(step.from));
        this.origins.set(step.from, null);
        return;
      case "rename-column": {
        const table = this.origin(step.table);
        if (table === null) return;
        const column = this.columnOrigin(table, step.from);
        const names = this.columnsOf(table);
        names.renamed.delete(step.from);
        if (step.to === column) {
          names.away.delete(column);
        } else {
          names.renamed.set(step.to, column);
          names.away.add(column);
        }
        return;
      }
      case "unread":
        this.emit({ kind: "unnamed", description: step.description });
        return;
    }
  }

  /** A removal of `table`'s rows, and of the rows its foreign keys reach. */
  private removeRows(table: string, reach: Reach): void {
    this.emit({ kind: "rows", table });
    if (reach === "none") return;
    const reached =
      reach === "delete"
        ? this.facts.cascadeFrom(table)
        : this.facts.truncateCascadeFrom(table);
    if (reached === undefined) {
      // Fails closed: tables nobody could read cannot be named, so only
      // consent without targets covers them.
      this.emit({
        kind: "unnamed",
        description:
          reach === "delete"
            ? `rows removed from tables ${table}'s foreign keys cascade to, which could not be read`
            : `rows removed from tables TRUNCATE ${table} CASCADE also empties, which could not be read`,
      });
      return;
    }
    for (const other of reached) this.emit({ kind: "rows", table: other });
  }

  /**
   * A rebuild, judged at its drop by what it does to its table: each live
   * column the twin does not carry, or carries converted, and the rows when
   * the copy does not take them all. A table whose live columns could not
   * be read is judged as the drop the block then is, which consent naming
   * the table covers as it covers each of its columns and rows.
   */
  rebuild(rebuild: Rebuild, statements: readonly string[]): void {
    // The twin is the list's own: dropping it again deletes nothing.
    this.origins.set(rebuild.twin, null);
    const table = this.origin(rebuild.table);
    if (table === null) return;
    const live = this.facts.liveColumns(table);
    if (live === undefined || live.size === 0) {
      this.emit({ kind: "table", table });
      return;
    }
    const copy =
      rebuild.copies.length === 1
        ? readCopy(statements[rebuild.copies[0]], rebuild.twin, rebuild.columns)
        : undefined;
    // With one copy from the table, a twin column carries a live column only
    // when the copy fills it from that column. Without one the rows are gone
    // (below), and a column the twin declares counts as carried.
    const filled =
      copy !== undefined && copy.from === rebuild.table
        ? copy.filled
        : undefined;
    const declared = new Map(
      rebuild.columns.map(column => [column.name, column])
    );
    const after: ColumnNames = { renamed: new Map(), away: new Set() };
    for (const liveColumn of live) {
      const current = this.currentColumn(table, liveColumn);
      if (current === undefined) {
        after.away.add(liveColumn);
        continue;
      }
      const carriedAs =
        filled === undefined
          ? declared.has(current)
            ? current
            : undefined
          : [...filled].find(([, source]) => source === current)?.[0];
      const twinColumn =
        carriedAs === undefined ? undefined : declared.get(carriedAs);
      const liveType = this.facts.liveType(table, liveColumn);
      if (twinColumn === undefined) {
        this.emit({ kind: "column", table, column: liveColumn });
        after.away.add(liveColumn);
        continue;
      }
      // A converted type may not hold every value; an unreadable one counts
      // as converted.
      if (
        twinColumn.type === undefined ||
        liveType === undefined ||
        typeSpelling(liveType) !== twinColumn.type
      ) {
        this.emit({ kind: "column", table, column: liveColumn });
      }
      if (twinColumn.name !== liveColumn) {
        after.renamed.set(twinColumn.name, liveColumn);
        after.away.add(liveColumn);
      }
    }
    if (filled === undefined || copy?.allRows !== true) {
      this.emit({ kind: "rows", table });
    }
    this.columnNames.set(table, after);
  }
}

/** Every step of the list, with each SQLite rebuild judged as one. */
function walk(
  statements: readonly string[],
  dialect: SupportedDialect,
  facts: FactSource,
  partOf: (at: number) => number = () => 0
): { deletion: Deletion; part: number }[] {
  const file = new FileWalk(facts);
  const rebuilds = rebuildsIn(statements, dialect);
  const byDrop = new Map(rebuilds.map(rebuild => [rebuild.dropAt, rebuild]));
  // The twin's creation, its copies and its rename back are the rebuild's
  // own, judged with it at its drop.
  const owned = new Set(
    rebuilds.flatMap(rebuild => [
      rebuild.createAt,
      rebuild.renameAt,
      ...rebuild.copies,
    ])
  );
  statements.forEach((statement, at) => {
    file.enter(partOf(at));
    const rebuild = byDrop.get(at);
    if (rebuild !== undefined) file.rebuild(rebuild, statements);
    else if (!owned.has(at)) {
      for (const step of readStatement(statement, dialect)) file.apply(step);
    }
  });
  return file.found;
}

/** The questions a walk asks, answered from facts read once. */
function factSource(facts: DeletionFacts): FactSource {
  return {
    cascadeFrom: table => facts.cascadeFrom(table),
    truncateCascadeFrom: table => facts.truncateCascadeFrom(table),
    liveColumns: table => facts.liveColumns.get(table),
    liveType: (table, column) => facts.liveColumnTypes?.get(table)?.get(column),
  };
}

/** Every deletion `statements` (one file or down section, split for `dialect`) make, in statement order, each once. */
export function fileDeletions(
  statements: readonly string[],
  dialect: SupportedDialect,
  facts: DeletionFacts
): Deletion[] {
  return walk(statements, dialect, factSource(facts)).map(
    found => found.deletion
  );
}

/**
 * The deletions of a run of files, each file's own, in run order: the files
 * read as one list against the database as it is before the run, so each
 * file is judged against the schema as the files before it leave it. A
 * table or column an earlier file creates holds only what the run put there,
 * and a table an earlier file renames is followed to the live one it is.
 * `facts` are read for every file's statements together
 * (`readDeletionFacts` over `runStatements(files)`).
 */
export function runDeletions(
  files: readonly (readonly string[])[],
  dialect: SupportedDialect,
  facts: DeletionFacts
): Deletion[][] {
  const partOf: number[] = files.flatMap((statements, part) =>
    statements.map(() => part)
  );
  const perFile: Deletion[][] = files.map(() => []);
  for (const { deletion, part } of walk(
    runStatements(files),
    dialect,
    factSource(facts),
    at => partOf[at] ?? 0
  )) {
    perFile[part]?.push(deletion);
  }
  return perFile;
}

/** A run's files' statements as one list, in run order. */
export function runStatements(files: readonly (readonly string[])[]): string[] {
  return files.flat();
}

/** A read that answers undefined rather than throwing. */
async function settle<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/**
 * The tables a removal of `root`'s rows reaches, lower-cased and sorted,
 * `root` excluded: through every foreign key referencing a reached table
 * when `every` (PostgreSQL's TRUNCATE CASCADE), through ON DELETE CASCADE
 * keys only otherwise. Each step reads who references a table
 * (`readReferencingTables`) and, for a delete, their keys' actions from the
 * diff's own reading (`introspectLiveSnapshot`). A referencing table whose
 * keys cannot be read makes the whole answer unreadable.
 */
async function reachedFrom(
  db: unknown,
  dialect: SupportedDialect,
  root: string,
  every: boolean
): Promise<string[]> {
  const reached = new Map<string, string>([[root.toLowerCase(), root]]);
  const queue = [root];
  for (
    let parent = queue.shift();
    parent !== undefined;
    parent = queue.shift()
  ) {
    const referencing = await readReferencingTables(db, dialect, parent);
    let children = referencing;
    if (!every && referencing.length > 0) {
      const snapshot = await introspectLiveSnapshot(db, dialect, referencing);
      const parentKey = parent.toLowerCase();
      children = referencing.filter(name => {
        const spec = snapshot.tables.find(
          table => table.name.toLowerCase() === name.toLowerCase()
        );
        if (spec?.foreignKeys === undefined) {
          throw NextlyError.internal({
            logContext: { reason: "foreign keys not read", table: name },
          });
        }
        return spec.foreignKeys.some(
          key =>
            key.referencesTable.toLowerCase() === parentKey &&
            key.onDelete === "cascade"
        );
      });
    }
    for (const child of children) {
      if (reached.has(child.toLowerCase())) continue;
      reached.set(child.toLowerCase(), child);
      queue.push(child);
    }
  }
  reached.delete(root.toLowerCase());
  return [...reached.keys()].sort();
}

/** Reads, once and read-only, every fact `fileDeletions` will ask about these statements. Never throws for an unreadable fact: it answers undefined. */
export async function readDeletionFacts(
  db: unknown,
  dialect: SupportedDialect,
  statements: readonly string[]
): Promise<DeletionFacts> {
  // The questions are the ones the walk itself asks, recorded by walking
  // the list once against facts that answer nothing.
  const cascade = new Set<string>();
  const truncate = new Set<string>();
  const rebuilt = new Set<string>();
  walk(statements, dialect, {
    cascadeFrom: table => {
      cascade.add(table);
      return [];
    },
    truncateCascadeFrom: table => {
      truncate.add(table);
      return [];
    },
    liveColumns: table => {
      rebuilt.add(table);
      return undefined;
    },
    liveType: () => undefined,
  });

  const asked = [...new Set([...cascade, ...truncate, ...rebuilt])];
  // Each table's live spelling, which the catalog reads need; a table the
  // database does not have yet is absent, and its facts unreadable.
  const spellings = await settle(async () => {
    const live = await introspectTableNames(db, dialect, asked);
    return new Map(live.map(name => [name.toLowerCase(), name]));
  });
  const cascades = new Map<string, readonly string[] | undefined>();
  for (const table of cascade) {
    // The runner applies every SQLite unit with foreign-key enforcement off
    // (`withSqliteForeignKeysOff`), so no cascade fires there, whatever the
    // connection's own setting: a removal that would orphan rows is refused
    // by the unit's `PRAGMA foreign_key_check` instead.
    if (dialect === "sqlite") {
      cascades.set(table, []);
      continue;
    }
    const live = spellings?.get(table);
    cascades.set(
      table,
      live === undefined
        ? undefined
        : await settle(() => reachedFrom(db, dialect, live, false))
    );
  }
  const truncates = new Map<string, readonly string[] | undefined>();
  for (const table of truncate) {
    const live = spellings?.get(table);
    truncates.set(
      table,
      live === undefined || dialect !== "postgresql"
        ? undefined
        : await settle(() => reachedFrom(db, dialect, live, true))
    );
  }

  const rebuiltLive = [...rebuilt].flatMap(table => {
    const live = spellings?.get(table);
    return live === undefined ? [] : [live];
  });
  const types =
    rebuiltLive.length === 0
      ? new Map<string, Map<string, string>>()
      : await settle(() => queryLiveColumnTypes(db, dialect, rebuiltLive));
  // The column names are derived from the one reading of the types, so the
  // two cannot disagree about which columns a table has.
  const liveColumnTypes = new Map(
    [...(types ?? [])].map(([table, columns]) => [
      table.toLowerCase(),
      new Map(
        [...columns].map(([column, type]) => [
          column.toLowerCase(),
          type.toLowerCase(),
        ])
      ),
    ])
  );
  const liveColumns: LiveColumns = new Map(
    [...liveColumnTypes].map(([table, columns]) => [
      table,
      new Set(columns.keys()),
    ])
  );

  return {
    cascadeFrom: table => cascades.get(table.toLowerCase()),
    truncateCascadeFrom: table => truncates.get(table.toLowerCase()),
    liveColumns,
    liveColumnTypes,
  };
}
