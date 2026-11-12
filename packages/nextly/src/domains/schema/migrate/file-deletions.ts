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
 *   value, so it needs consent naming the column like a drop does. A string
 *   column widened (`varchar(n)` to `text` or a `varchar` at least as long,
 *   `keepsEveryStringValue`), with nothing else that converts it stated, keeps
 *   every value and deletes nothing. The MySQL run `migrate:create` writes to
 *   change a column's nullability (`mysqlLiveRunAt`) restates its live type:
 *   it is judged as that restatement, a `column` deletion only when it makes a
 *   nullable column NOT NULL, and its rename run as the plain rename.
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
import { createHash } from "node:crypto";

import type { SupportedDialect } from "../../../database/schema-registry";
import type { LiveColumns } from "../ownership/drop-guard";
import { keepsEveryStringValue } from "../pipeline/classifier/type-widening";
import {
  MYSQL_LIVE_RUN_LENGTH,
  mysqlLiveRunAt,
  plainMysqlStatement,
  type MysqlLiveRun,
} from "../pipeline/sql-templates/mysql-live-restate";
import {
  introspectLiveColumns,
  introspectTableNames,
} from "../pipeline/diff/introspect-live";
import {
  readHiddenCode,
  readMysqlOtherCharsets,
  readPgDescendants,
  readReferencingKeys,
  readUserFunctions,
  type HiddenCode,
  type RelationRef,
} from "../pipeline/live-table-facts";

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
  /**
   * Every column (lower-cased) a row removal in `table` blanks through ON DELETE SET NULL or SET
   * DEFAULT foreign keys, in `table` and in every table its cascades reach, read with
   * `cascadeFrom` from the same reading. Undefined when unreadable; always empty on SQLite.
   */
  nulledBy(table: string): readonly NulledColumn[] | undefined;
  /**
   * Whether `table` carries code a change to it runs, which the statement does not show and which
   * may delete other data (`HiddenCode`): `rows` for a row removed, written or blanked, `rewrite`
   * for PostgreSQL's conversion of a column. Undefined when unreadable.
   */
  hiddenCode(table: string, on: keyof HiddenCode): boolean | undefined;
  /**
   * PostgreSQL: every table inheriting from `table` or partitioning it, transitively, which a
   * DELETE or TRUNCATE without ONLY also empties. Empty elsewhere; undefined when unreadable.
   */
  descendantsOf(table: string): readonly string[] | undefined;
  /**
   * Whether `table` exists before the run: a file that creates a table already there may be
   * adopted rather than run, so the table is not the run's own. Undefined when unreadable.
   */
  liveTable(table: string): boolean | undefined;
  /**
   * The functions a SELECT may call that run code the statement does not show: lower-cased names
   * of the user-defined functions (outside the system catalogs). Undefined when unreadable, when
   * a SELECT calling anything is judged as one that may delete.
   */
  userFunctions?: ReadonlySet<string>;
  /**
   * How a SQLite rebuild of a table whose live columns are unknown is judged: `"drop"` (the
   * default) as the drop of the table, `"deferred"` (`migrate:check`, which reads no database)
   * as a deletion the run itself judges, or nothing when the copy carries every column the twin
   * declares and every row.
   */
  unseenRebuild?: "drop" | "deferred";
  /** The live columns of the tables a SQLite rebuild in the file rebuilds (drop-guard's `readLiveColumns`). */
  liveColumns: LiveColumns;
  /**
   * The declared type of each of those columns as SQLite reports it, lower-cased, by lower-cased
   * table and column. A rebuild column whose type is absent here counts as converted, so facts
   * without it judge every carried column a possible deletion rather than none.
   */
  liveColumnTypes?: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /**
   * MySQL: by lower-cased table, the columns whose character set is not their table's default,
   * read for the tables whose column types are read. A `MODIFY` or `CHANGE` naming none gives the
   * column the table's default, converting its values. A table absent here was not read, and a
   * widening of its columns is judged as any type change.
   */
  otherCharsets?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * By lower-cased table, its columns that are NOT NULL, read with the column types. A MySQL
   * restatement that makes a nullable column NOT NULL turns its NULLs into a type's empty value on
   * a server not in strict mode, so it is no widening; a table absent here was not read, and such
   * a restatement of its columns is judged as any type change.
   */
  liveNotNull?: ReadonlyMap<string, ReadonlySet<string>>;
}

type Token = string | QuotedToken;

/**
 * The facts a walk asks, one question each, so the reading of facts
 * (`readDeletionFacts`) can record exactly what `fileDeletions` will ask.
 */
interface FactSource {
  cascadeFrom(table: string): readonly string[] | undefined;
  truncateCascadeFrom(table: string): readonly string[] | undefined;
  nulledBy(table: string): readonly NulledColumn[] | undefined;
  hiddenCode(table: string, on: keyof HiddenCode): boolean | undefined;
  descendantsOf(table: string): readonly string[] | undefined;
  liveTable(table: string): boolean | undefined;
  /** Whether a SELECT calling `name` may run code that deletes. */
  mayDeleteThrough(name: string): boolean;
  unseenRebuild: "drop" | "deferred";
  liveColumns(table: string): ReadonlySet<string> | undefined;
  liveType(table: string, column: string): string | undefined;
  /** MySQL: whether `column` has its table's default character set; undefined when unread. */
  keepsCharacterSet(table: string, column: string): boolean | undefined;
  /** Whether live `column` of `table` is NOT NULL; undefined when unread. */
  liveNotNull(table: string, column: string): boolean | undefined;
}

/** A column whose values a row removal elsewhere blanks. */
export interface NulledColumn {
  table: string;
  column: string;
}

/** What a foreign key a run adds does to its rows when a referenced row goes. */
type KeyAction = "cascade" | "set null" | "set default" | "none";

/** How rows go, for the triggers it fires. */
type Removal = "delete" | "truncate" | "partition";

/** How a removal of rows reaches other tables. */
type Reach = "delete" | "truncate" | "none";

/** What one statement does that can delete data, or change which name means which table. */
type Step =
  | { kind: "create"; table: string; temporary?: boolean }
  /** A table dropped; `temporary` when only a temporary table of the name can be (MySQL's DROP TEMPORARY). */
  | { kind: "drop"; table: string; temporary?: boolean }
  | { kind: "add-column"; table: string; column: string }
  | {
      kind: "add-key";
      table: string;
      columns: string[];
      references: string;
      onDelete: KeyAction;
    }
  | { kind: "create-function"; name: string }
  /** `child` made a descendant of `parent` (ATTACH PARTITION, INHERIT): a later removal from `parent` reaches it. */
  | { kind: "inherit"; parent: string; child: string }
  /** Rows written to `table`, firing the triggers of each event. */
  | {
      kind: "writes";
      table: string;
      events: ("insert" | "update")[];
      /** PostgreSQL's ONLY: the table without its descendants, whose triggers a write otherwise fires. */
      only?: boolean;
    }
  | {
      kind: "calls";
      names: string[];
      description: string;
      fingerprint?: string;
    }
  | {
      kind: "rows";
      table: string;
      reach: Reach;
      /** Which triggers the removal fires; a MySQL partition truncated fires none. */
      removal: Removal;
      /** PostgreSQL's ONLY: the table without its descendants. */
      only?: boolean;
    }
  | {
      kind: "column";
      table: string;
      column: string;
      /** The type the change gives the column, when it states nothing else that converts it (`plainTypeStated`). */
      to?: string;
      /**
       * MySQL's restatement: whether the column is NOT NULL after it (`MODIFY`
       * and `CHANGE` set nullability whatever they omit). Absent where the
       * change keeps nullability (PostgreSQL's `ALTER ... TYPE`).
       */
      notNull?: boolean;
      /**
       * The change restates the column's live type, character set and collation as the
       * database has them when it runs (`mysqlLiveRunAt`): only its nullability changes.
       */
      typeKept?: true;
    }
  | { kind: "drop-column"; table: string; column: string }
  | { kind: "rename-table"; from: string; to: string }
  | { kind: "rename-column"; table: string; from: string; to: string }
  | { kind: "unread"; description: string; fingerprint?: string };

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
  const read =
    readDefinition(cursor, tokens, dialect) ??
    readData(cursor, tokens, dialect, first);
  if (read !== null) return read;
  if (NEVER_DELETING.has(first)) return [];
  return unreadIfDeleting(tokens);
}

/** A statement on a table's or a type's definition: CREATE, DROP, ALTER; null for any other. */
function readDefinition(
  cursor: StatementCursor,
  tokens: readonly Token[],
  dialect: SupportedDialect
): Step[] | null {
  if (cursor.accept("CREATE")) return readCreate(cursor, tokens);
  if (cursor.accept("DROP")) return readDrop(cursor, tokens, dialect);
  if (cursor.accept("ALTER", "TABLE")) {
    return readAlterTable(cursor, tokens, dialect);
  }
  // MariaDB's ALTER IGNORE drops the rows a new unique key would refuse.
  if (cursor.accept("ALTER", "IGNORE")) return [unread(tokens)];
  if (cursor.accept("ALTER", "TYPE")) return readAlterType(tokens);
  return null;
}

/** A statement on a table's rows: a removal, a replacement or a write; null for any other. */
function readData(
  cursor: StatementCursor,
  tokens: readonly Token[],
  dialect: SupportedDialect,
  first: string
): Step[] | null {
  if (cursor.accept("DELETE")) return readDelete(cursor, tokens);
  if (cursor.accept("MERGE")) return readMerge(cursor, tokens);
  if (cursor.accept("TRUNCATE")) return readTruncate(cursor, tokens, dialect);
  const dialectForm = readDialectForm(cursor, tokens, dialect);
  if (dialectForm !== null) return dialectForm;
  if (first === "INSERT" || first === "UPDATE") return readWrite(tokens);
  if (UNPLACED_ROW_FORMS.has(first)) return readUnplacedRows(tokens, first);
  return null;
}

/** `DROP TABLE [IF EXISTS] a, b [CASCADE | RESTRICT]`: each table, dropped. */
function readDropTables(
  cursor: StatementCursor,
  tokens: readonly Token[]
): Step[] {
  cursor.acceptCondition();
  const tables = cursor.names();
  if (tables === undefined) return [unread(tokens)];
  if (!cursor.accept("CASCADE")) cursor.accept("RESTRICT");
  if (!cursor.done()) return [unread(tokens)];
  return tables.map(table => ({ kind: "drop", table }));
}

/**
 * The statements only some dialects have that remove rows or rename tables:
 * `REPLACE` (MySQL, SQLite), SQLite's `INSERT OR REPLACE` and `UPDATE OR
 * REPLACE`, and MySQL's `RENAME TABLE`. Null for a statement that is none
 * of them.
 */
function readDialectForm(
  cursor: StatementCursor,
  tokens: readonly Token[],
  dialect: SupportedDialect
): Step[] | null {
  if (dialect !== "postgresql" && cursor.accept("REPLACE")) {
    return readRowsInto(cursor, tokens);
  }
  if (dialect === "sqlite") return readSqliteReplace(cursor, tokens);
  if (dialect === "mysql" && cursor.accept("RENAME", "TABLE")) {
    return readRenameTables(cursor, tokens);
  }
  return null;
}

/** SQLite's `INSERT OR REPLACE` and `UPDATE OR REPLACE`; null for any other statement. */
function readSqliteReplace(
  cursor: StatementCursor,
  tokens: readonly Token[]
): Step[] | null {
  if (cursor.accept("INSERT", "OR", "REPLACE")) {
    return readRowsInto(cursor, tokens);
  }
  if (!cursor.accept("UPDATE", "OR", "REPLACE")) return null;
  // A uniqueness conflict deletes the rows in the way of the update.
  const table = cursor.name();
  return table === undefined
    ? [unread(tokens)]
    : [
        { kind: "rows", table, reach: "delete", removal: "delete" },
        { kind: "writes", table, events: ["update"] },
      ];
}

/**
 * `CREATE [TEMPORARY] TABLE t`: t is the list's own from here, unless written
 * `IF NOT EXISTS`, which may leave a live table of that name in place.
 * MariaDB's `CREATE OR REPLACE TABLE t` drops t first. Any other creation
 * deletes nothing now.
 */
function readCreate(cursor: StatementCursor, tokens: readonly Token[]): Step[] {
  const replacing = cursor.accept("OR", "REPLACE");
  // MySQL may name the definer first: `CREATE DEFINER = user FUNCTION …`.
  if (cursor.isWord("DEFINER")) return readDefinedCode(tokens);
  if (cursor.accept("FUNCTION")) return readCreateFunction(cursor);
  // A trigger runs later, on rows: the walk counts it as code the run defines.
  if (tokens.slice(1, 6).includes("TRIGGER")) return [];
  if (replacing) return readCreateOrReplace(cursor, tokens);
  if (cursor.accept("TEMPORARY") || cursor.accept("TEMP")) {
    return readCreateTemporary(cursor);
  }
  return readCreateTable(cursor, false);
}

/**
 * `CREATE OR REPLACE [TEMPORARY] TABLE t`, after `OR REPLACE`: MariaDB drops a
 * live t first, then t is the list's own. Anything else replaced deletes nothing now.
 */
function readCreateOrReplace(
  cursor: StatementCursor,
  tokens: readonly Token[]
): Step[] {
  // A temporary table replaces only a temporary one of the same name.
  if (cursor.accept("TEMPORARY")) return readCreateTemporary(cursor);
  if (!cursor.accept("TABLE")) return [];
  const table = cursor.name();
  return table === undefined
    ? [unread(tokens)]
    : [
        { kind: "drop", table },
        { kind: "create", table },
      ];
}

/**
 * A temporary table: it holds only what the run puts in it, and shadows a
 * live table of its name until it is dropped.
 */
function readCreateTemporary(cursor: StatementCursor): Step[] {
  return readCreateTable(cursor, true);
}

/**
 * `TABLE [IF NOT EXISTS] name`, after `CREATE [TEMPORARY]`: the table the
 * list makes. One created only if absent may be a live table, so it makes
 * nothing of the name.
 */
function readCreateTable(cursor: StatementCursor, temporary: boolean): Step[] {
  if (!cursor.accept("TABLE")) return [];
  if (cursor.accept("IF", "NOT", "EXISTS")) return [];
  const table = cursor.name();
  if (table === undefined) return [];
  return [
    temporary
      ? { kind: "create", table, temporary }
      : { kind: "create", table },
  ];
}

/** MySQL's `CREATE DEFINER = … FUNCTION …`: the function it creates; nothing for any other. */
function readDefinedCode(tokens: readonly Token[]): Step[] {
  const kind = tokens.indexOf("FUNCTION");
  if (kind === -1) return [];
  return readCreateFunction(new StatementCursor(tokens.slice(kind + 1)));
}

/**
 * A function the run defines, by the last part of its name (the one a later
 * unqualified call writes), which `migrate:check` counts among the functions
 * a call may reach (`functionsDefinedBy`).
 */
function readCreateFunction(cursor: StatementCursor): Step[] {
  const tokens = cursor.rest();
  const open = tokens.indexOf("(");
  const last = open > 0 ? tokens[open - 1] : undefined;
  const written = typeof last === "string" ? last : last?.name;
  // A qualified name (`public.purge`) is called by its last part.
  const name = written?.split(".").pop()?.toLowerCase();
  // One whose name cannot be read may be any function a later call names.
  return [
    {
      kind: "create-function",
      name: name === undefined || name === "" ? "*" : name,
    },
  ];
}

/** First letters of a function's name, as the tokenizer upper-cases it. */
const FUNCTION_NAME = /^[A-Z_][A-Z0-9_$.]*$/;

/**
 * What a statement defines rather than runs: the code of a function,
 * procedure or trigger, or a view's query, none of which runs now.
 */
const DEFINITION_FORMS = new Set([
  "FUNCTION",
  "PROCEDURE",
  "TRIGGER",
  "VIEW",
  "RULE",
]);

/**
 * `ALTER TYPE`: converting or dropping an attribute rewrites, with CASCADE,
 * every table typed by it, so such a statement may delete; anything else it
 * does reads as any other statement.
 */
function readAlterType(tokens: readonly Token[]): Step[] {
  const at = tokens.indexOf("ATTRIBUTE");
  const verb = at > 0 ? tokens[at - 1] : undefined;
  return verb === "ALTER" || verb === "DROP"
    ? [unread(tokens)]
    : unreadIfDeleting(tokens);
}

/**
 * The functions a statement calls, by the names it writes them with,
 * lower-cased and qualified as written: a name, plain or quoted, directly
 * before `(`. Whether one may delete is a fact about the database
 * (`mayDeleteThrough`), asked by the walk. A statement that only defines
 * code (a function, procedure, trigger or view) calls nothing now. An
 * escaped quoted name (`U&"…"`) reads as a qualified one, which may delete.
 */
function readCalls(tokens: readonly Token[]): Step | undefined {
  // A procedural statement already stands for whatever it runs.
  if (typeof tokens[0] === "string" && CODE_WORDS.has(tokens[0]))
    return undefined;
  if (tokens[0] === "CREATE" && definesCode(tokens)) return undefined;
  if (namesCodeOnly(tokens)) return undefined;
  const names = tokens.flatMap((token, at) =>
    tokens[at + 1] === "(" ? calledName(tokens, at) : []
  );
  return names.length === 0
    ? undefined
    : {
        kind: "calls",
        names,
        description: `${labelOf(tokens)} (calls a function, may delete data)`,
      };
}

/** First words of a statement that names code (a signature, a grant) without running it. */
const CALL_FREE_FORMS = new Set(["DROP", "COMMENT", "GRANT", "REVOKE"]);

/** Whether a statement only names a function: drops, comments on, grants on or alters one. */
function namesCodeOnly(tokens: readonly Token[]): boolean {
  const first = tokens[0];
  if (typeof first === "string" && CALL_FREE_FORMS.has(first)) return true;
  return (
    first === "ALTER" && (tokens[1] === "FUNCTION" || tokens[1] === "PROCEDURE")
  );
}

/**
 * Whether a CREATE statement defines code rather than running it, its kind
 * among its first words (after `OR REPLACE`, or MySQL's `DEFINER = user`).
 * A materialized view runs its query now, so it is not one.
 */
function definesCode(tokens: readonly Token[]): boolean {
  const head = tokens.slice(1, 8);
  if (head.includes("MATERIALIZED")) return false;
  return head.some(
    token => typeof token === "string" && DEFINITION_FORMS.has(token)
  );
}

/** The name a call at `at` writes, lower-cased, with any qualifier; none for a word that is not a name. */
function calledName(tokens: readonly Token[], at: number): string[] {
  const name = nameAt(tokens[at]);
  if (name === undefined) return [];
  if (tokens[at - 1] !== ".") return [name];
  const qualifier = nameAt(tokens[at - 2]);
  return [`${qualifier ?? "?"}.${name}`];
}

/** A token as a function name, lower-cased: a plain word, or a quoted name (an escaped one stands as qualified). */
function nameAt(token: Token | undefined): string | undefined {
  if (typeof token === "string") {
    return FUNCTION_NAME.test(token) ? token.toLowerCase() : undefined;
  }
  if (token?.name === undefined) return undefined;
  return token.escaped === true
    ? `?.${token.name.toLowerCase()}`
    : token.name.toLowerCase();
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
  // MySQL's DROP TEMPORARY TABLE drops only a temporary table: one the run
  // made gives its name back to what it shadowed, and one it did not make
  // held nothing a migration could have found there.
  if (cursor.accept("TEMPORARY")) {
    if (!cursor.accept("TABLE")) return [];
    return readDropTables(cursor, tokens).map(step =>
      step.kind === "drop" ? { ...step, temporary: true } : step
    );
  }
  if (cursor.accept("TABLE")) return readDropTables(cursor, tokens);
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
  const only = cursor.accept("ONLY");
  const table = cursor.name();
  cursor.accept("*");
  if (table === undefined || cursor.isWord(",")) return [unread(tokens)];
  return [{ kind: "rows", table, reach: "delete", removal: "delete", only }];
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
  const tables: { table: string; only: boolean }[] = [];
  do {
    const only = dialect === "postgresql" && cursor.accept("ONLY");
    const table = cursor.name();
    if (table === undefined) return [unread(tokens)];
    cursor.accept("*");
    tables.push({ table, only });
  } while (cursor.accept(","));
  if (!cursor.accept("RESTART", "IDENTITY")) {
    cursor.accept("CONTINUE", "IDENTITY");
  }
  const cascade = dialect === "postgresql" && cursor.accept("CASCADE");
  if (!cascade) cursor.accept("RESTRICT");
  if (!cursor.done()) return [unread(tokens)];
  return tables.map(({ table, only }) => ({
    kind: "rows",
    table,
    reach: cascade ? "truncate" : "none",
    removal: "truncate",
    only,
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
    : [
        { kind: "rows", table, reach: "delete", removal: "delete" },
        { kind: "writes", table, events: ["insert"] },
      ];
}

/**
 * PostgreSQL's MERGE: a removal of the target's rows when a branch deletes,
 * and the writes its UPDATE and INSERT branches make, which fire the target's
 * triggers.
 */
function readMerge(cursor: StatementCursor, tokens: readonly Token[]): Step[] {
  cursor.accept("INTO");
  const only = cursor.accept("ONLY");
  const table = cursor.name();
  if (table === undefined) return [unread(tokens)];
  const steps: Step[] = [];
  if (tokens.includes("DELETE")) {
    steps.push({
      kind: "rows",
      table,
      reach: "delete",
      removal: "delete",
      only,
    });
  }
  const events = (["update", "insert"] as const).filter(event =>
    tokens.includes(event.toUpperCase())
  );
  if (events.length > 0)
    steps.push({ kind: "writes", table, events: [...events], only });
  return steps;
}

/** First words of a statement that may change rows in a form the reader does not place. */
const UNPLACED_ROW_FORMS = new Set(["WITH", "COPY", "LOAD"]);

/** Words that, inside a WITH, make it change rows rather than read them. */
const ROW_CHANGE_WORDS = ["INSERT", "UPDATE", "DELETE", "MERGE"];

/**
 * A row change the reader does not place (`UNPLACED_ROW_FORMS`): a WITH that
 * writes, a `COPY … FROM` and MySQL's `LOAD DATA` (or PostgreSQL's `LOAD`
 * of a library) stand for what they may delete, which only blanket consent
 * covers; a WITH that only reads and a `COPY … TO` change nothing.
 */
function readUnplacedRows(tokens: readonly Token[], first: string): Step[] {
  if (first === "LOAD") return [unread(tokens)];
  if (first === "WITH") {
    return ROW_CHANGE_WORDS.some(word => tokens.includes(word))
      ? [unread(tokens)]
      : [];
  }
  // COPY (query) TO writes a file; COPY t FROM fills t.
  return tokens[1] !== "(" && tokens.includes("FROM") ? [unread(tokens)] : [];
}

/** SQLite's conflict actions other than REPLACE, after `INSERT OR` or `UPDATE OR`. */
const SQLITE_CONFLICT_ACTIONS = ["IGNORE", "ABORT", "FAIL", "ROLLBACK"];

/** Upper-cased words of a MySQL INSERT or UPDATE that may stand before its table. */
const WRITE_MODIFIERS = ["LOW_PRIORITY", "DELAYED", "HIGH_PRIORITY", "IGNORE"];

/**
 * An INSERT or UPDATE: the rows it writes fire the table's INSERT or UPDATE
 * triggers, an upsert (`ON CONFLICT`, `ON DUPLICATE KEY`) both. A table it
 * cannot name stands for a deletion only blanket consent covers, since its
 * triggers cannot be read.
 */
function readWrite(tokens: readonly Token[]): Step[] {
  const cursor = new StatementCursor(tokens);
  const insert = cursor.accept("INSERT");
  if (!insert) cursor.accept("UPDATE");
  // SQLite's conflict clause (`INSERT OR IGNORE`, `UPDATE OR ROLLBACK`)
  // changes what a conflict does, not what the write is; `OR REPLACE`, which
  // deletes, is read before this (`readSqliteReplace`).
  if (cursor.accept("OR")) {
    SQLITE_CONFLICT_ACTIONS.some(action => cursor.accept(action));
  }
  for (const modifier of WRITE_MODIFIERS) cursor.accept(modifier);
  // MySQL lets an INSERT leave out INTO.
  if (insert) cursor.accept("INTO");
  const only = !insert && cursor.accept("ONLY");
  const table = cursor.name();
  if (table === undefined) return [unread(tokens)];
  // A MySQL UPDATE of several tables (a join, a list) writes each of them.
  if (!insert && !reachesSet(cursor)) return [unread(tokens)];
  return [{ kind: "writes", table, events: writeEvents(insert, tokens), only }];
}

/** Whether an UPDATE's table, past an optional alias, is followed by its SET: the one table it writes. */
function reachesSet(cursor: StatementCursor): boolean {
  cursor.accept("AS");
  if (cursor.isWord("SET")) return true;
  cursor.name();
  return cursor.isWord("SET");
}

/** The events a write fires: an UPDATE its own, an INSERT its own and, as an upsert, UPDATE too. */
function writeEvents(
  insert: boolean,
  tokens: readonly Token[]
): ("insert" | "update")[] {
  if (!insert) return ["update"];
  const upsert = tokens.includes("CONFLICT") || tokens.includes("DUPLICATE");
  return upsert ? ["insert", "update"] : ["insert"];
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
  if (clause.accept("ADD")) return readAddClause(clause, table);
  if (clause.accept("DROP")) return readDropClause(clause, table);
  if (clause.accept("RENAME")) return readRenameClause(clause, table, dialect);
  if (clause.accept("ALTER")) return readAlterColumn(clause, table);
  const inherit = readInheritClause(clause, table);
  if (inherit !== null) return inherit;
  if (dialect === "mysql") {
    const mysql = readMysqlAlterClause(clause, table);
    if (mysql !== null) return mysql;
  }
  return saysDelete(clause.rest()) ? undefined : [];
}

/**
 * PostgreSQL's `ATTACH PARTITION child` and `INHERIT parent`: a table made a
 * descendant, whose rows a later removal from its parent reaches. Undefined
 * when the other table cannot be named, null for any other clause.
 */
function readInheritClause(
  clause: StatementCursor,
  table: string
): Step[] | undefined | null {
  if (clause.accept("ATTACH", "PARTITION")) {
    const child = clause.name();
    return child === undefined
      ? undefined
      : [{ kind: "inherit", parent: table, child }];
  }
  if (clause.accept("INHERIT")) {
    const parent = clause.name();
    return parent === undefined
      ? undefined
      : [{ kind: "inherit", parent, child: table }];
  }
  return null;
}

/** What may follow `ADD` that is not a column. */
const ADDED_NOT_COLUMNS = new Set([
  "CONSTRAINT",
  "INDEX",
  "KEY",
  "UNIQUE",
  "PRIMARY",
  "FOREIGN",
  "CHECK",
  "FULLTEXT",
  "SPATIAL",
  "PARTITION",
  "EXCLUDE",
]);

/**
 * An ALTER TABLE `ADD` clause: a column the run makes (its values are the
 * run's own), and any foreign key it adds with an ON DELETE action, which a
 * later removal of rows in the same run follows. Undefined for a key whose
 * referenced table cannot be named.
 */
function readAddClause(
  clause: StatementCursor,
  table: string
): Step[] | undefined {
  if (clause.accept("CONSTRAINT")) clause.name();
  if (clause.accept("FOREIGN", "KEY")) return readAddedKey(clause, table);
  const next = clause.peek();
  const column =
    clause.accept("COLUMN") ||
    typeof next !== "string" ||
    !ADDED_NOT_COLUMNS.has(next);
  if (!column) return [];
  // `IF NOT EXISTS` may find the column already there, holding live data,
  // so a conditional addition never marks it as the run's own.
  const conditional = clause.accept("IF", "NOT", "EXISTS");
  const name = clause.name();
  if (name === undefined) return [];
  const key = readReferences(clause, table, [name]);
  if (key === undefined) return undefined;
  return conditional
    ? key
    : [{ kind: "add-column", table, column: name }, ...key];
}

/** `FOREIGN KEY [name] (columns) REFERENCES …`, after `FOREIGN KEY`. */
function readAddedKey(
  clause: StatementCursor,
  table: string
): Step[] | undefined {
  // MySQL may name the key's index before its columns.
  if (!clause.isWord("(")) clause.name();
  if (!clause.accept("(")) return undefined;
  const columns = clause.names();
  if (columns === undefined || !clause.accept(")")) return undefined;
  return readReferences(clause, table, columns);
}

/**
 * The key `columns` of `table` hold, when the rest of the clause says
 * `REFERENCES parent … ON DELETE action`: nothing without a REFERENCES or an
 * action that touches rows, undefined when the parent cannot be named.
 */
function readReferences(
  clause: StatementCursor,
  table: string,
  columns: string[]
): Step[] | undefined {
  const rest = clause.rest();
  const at = rest.indexOf("REFERENCES");
  if (at === -1) return [];
  const references = new StatementCursor(rest.slice(at + 1)).name();
  if (references === undefined) return undefined;
  const onDelete = keyAction(rest.slice(at + 1));
  return onDelete === "none"
    ? []
    : [{ kind: "add-key", table, columns, references, onDelete }];
}

/** The ON DELETE action a key's clause names; none when it names none. */
function keyAction(tokens: readonly Token[]): KeyAction {
  for (let at = 0; at + 2 < tokens.length; at += 1) {
    if (tokens[at] !== "ON" || tokens[at + 1] !== "DELETE") continue;
    const action = tokens[at + 2];
    if (action === "CASCADE") return "cascade";
    if (action !== "SET") return "none";
    if (tokens[at + 3] === "NULL") return "set null";
    return tokens[at + 3] === "DEFAULT" ? "set default" : "none";
  }
  return "none";
}

/**
 * MySQL's own ALTER TABLE clauses that can lose values: `MODIFY` and
 * `CHANGE`, which restate a column's type, `CONVERT`, and `TRUNCATE
 * PARTITION`. Undefined for one that cannot be read, null for a clause that
 * is none of them.
 */
function readMysqlAlterClause(
  clause: StatementCursor,
  table: string
): Step[] | undefined | null {
  if (clause.accept("MODIFY")) {
    clause.accept("COLUMN");
    const column = clause.name();
    return column === undefined
      ? undefined
      : [restated(table, column, clause.rest())];
  }
  if (clause.accept("CHANGE")) return readChangeColumn(clause, table);
  // Converting the table's character set rewrites every text column, and
  // discarding the tablespace leaves the table without its data file.
  if (clause.isWord("CONVERT") || clause.isWord("DISCARD")) return undefined;
  if (clause.accept("TRUNCATE", "PARTITION")) {
    return [{ kind: "rows", table, reach: "none", removal: "partition" }];
  }
  return null;
}

/**
 * MySQL's `CHANGE [COLUMN] from to <type>`: it restates the column's type, so
 * its values are judged as a type change; under a new name the old one is
 * gone as well.
 */
function readChangeColumn(
  clause: StatementCursor,
  table: string
): Step[] | undefined {
  clause.accept("COLUMN");
  const from = clause.name();
  const to = clause.name();
  if (from === undefined || to === undefined) return undefined;
  const changed: Step[] = [restated(table, from, clause.rest())];
  if (from !== to) changed.push({ kind: "rename-column", table, from, to });
  return changed;
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
    return [{ kind: "rows", table, reach: "none", removal: "partition" }];
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
  return readRenameColumn(clause, table, dialect);
}

/**
 * `RENAME [COLUMN] from TO to`, a column renamed; MySQL's bare
 * `RENAME name` renames the table instead.
 */
function readRenameColumn(
  clause: StatementCursor,
  table: string,
  dialect: SupportedDialect
): Step[] | undefined {
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
    ? [typeChange(table, column, plainTypeStated(clause.rest(), column))]
    : [];
}

/** A change of `column`'s type, with the type it is given when that is all the change states. */
function typeChange(
  table: string,
  column: string,
  to: string | undefined
): Extract<Step, { kind: "column" }> {
  return to === undefined
    ? { kind: "column", table, column }
    : { kind: "column", table, column, to };
}

/**
 * MySQL's `MODIFY` or `CHANGE` of `column`, from the tokens of its new
 * definition: a type change that also sets its nullability, NOT NULL where the
 * definition says `NOT NULL` or `PRIMARY KEY` (which implies it), else
 * nullable.
 */
function restated(
  table: string,
  column: string,
  definition: readonly Token[]
): Step {
  const notNull = definition.some(
    (token, at) =>
      token === "PRIMARY" || (token === "NOT" && definition[at + 1] === "NULL")
  );
  return {
    ...typeChange(table, column, plainTypeStated(definition, column)),
    notNull,
  };
}

/**
 * Whether a column change keeps every value of a column that stands as
 * `before`: a string column widened (`keepsEveryStringValue`) with nothing
 * else converting it, that makes no nullable column NOT NULL (a server not in
 * strict mode turns its NULLs into empty strings), and on MySQL in its table's
 * default character set (`keepsCharacterSet`), which the restated column
 * takes. A type, nullability or character set not known keeps nothing. A
 * change that keeps the live type, character set and collation (`typeKept`)
 * is judged by its nullability alone.
 */
function keepsEveryValue(
  before: { type: string | undefined; notNull: boolean | undefined },
  change: Extract<Step, { kind: "column" }>,
  dialect: SupportedDialect,
  keepsCharacterSet: () => boolean | undefined
): boolean {
  if (change.notNull === true && before.notNull !== true) return false;
  if (change.typeKept === true) return true;
  if (change.to === undefined || before.type === undefined) return false;
  if (dialect === "mysql" && keepsCharacterSet() !== true) return false;
  return keepsEveryStringValue(before.type, change.to, dialect);
}

/** Words of a column's restated definition that convert its values whatever its type. */
const CONVERTING_ATTRIBUTES = new Set(["CHARACTER", "CHARSET", "COLLATE"]);

/**
 * The type a type-changing clause gives `column`, spelled for comparison, when
 * the clause states nothing else that converts a value: no character set or
 * collation, and for PostgreSQL's `USING` only the column itself, plainly cast
 * to that type. Undefined otherwise, and the change is judged as any type
 * change is.
 */
function plainTypeStated(
  tokens: readonly Token[],
  column: string
): string | undefined {
  const at = tokens.indexOf("USING");
  const stated = at === -1 ? tokens : tokens.slice(0, at);
  if (
    stated.some(
      token => typeof token === "string" && CONVERTING_ATTRIBUTES.has(token)
    )
  ) {
    return undefined;
  }
  const type = declaredType(stated);
  if (type === undefined || type === "") return undefined;
  if (at === -1) return type;
  const using = new StatementCursor(tokens.slice(at + 1));
  if (using.name() !== column) return undefined;
  // A quoted unit in the cast (a string, a name) makes it no plain cast.
  const cast: string[] = [];
  for (const token of using.rest()) {
    if (typeof token !== "string") return undefined;
    cast.push(token);
  }
  const spelled = typeSpelling(cast.join(""));
  return spelled === "" || spelled === `::${type}` ? type : undefined;
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
  const into = readCopyColumns(cursor, columns);
  if (into === undefined) return undefined;
  return readCopySelect(cursor, into, conflict);
}

/** The twin columns a copy fills, in order: its list, or every twin column without one. */
function readCopyColumns(
  cursor: StatementCursor,
  columns: readonly TwinColumn[]
): string[] | undefined {
  if (!cursor.accept("(")) return columns.map(column => column.name);
  const names = cursor.names();
  return names !== undefined && cursor.accept(")") ? names : undefined;
}

/** A copy's `SELECT … FROM source`: where it reads, whether it takes every row, and the columns it fills. */
function readCopySelect(
  cursor: StatementCursor,
  into: readonly string[],
  conflict: boolean
):
  | { from: string | undefined; allRows: boolean; filled: Map<string, string> }
  | undefined {
  if (!cursor.accept("SELECT")) return undefined;
  const distinct = cursor.accept("DISTINCT");
  cursor.accept("ALL");
  const rest = cursor.rest();
  const fromAt = topLevelIndex(rest, "FROM");
  if (fromAt === -1) return undefined;
  const items = splitTopLevel(rest.slice(0, fromAt));
  const source = new StatementCursor(rest.slice(fromAt + 1));
  const from = source.name();
  return {
    from,
    allRows: !conflict && !distinct && from !== undefined && source.done(),
    filled: filledColumns(items, into),
  };
}

/**
 * Each twin column a copy fills straight from a source column, by the
 * source column's name: a select item that is a plain name, at the place of
 * the column it fills. Empty when the items and the columns do not line up.
 */
function filledColumns(
  items: readonly (readonly Token[])[],
  into: readonly string[]
): Map<string, string> {
  const filled = new Map<string, string>();
  if (items.length !== into.length) return filled;
  items.forEach((item, at) => {
    const reading = new StatementCursor(item);
    const name = reading.name();
    if (name !== undefined && reading.done()) filled.set(into[at], name);
  });
  return filled;
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
  /** Per live table, the columns the list added, by the names they have now. */
  private readonly madeColumns = new Map<string, Set<string>>();
  /** Each temporary table's name, with what the name reached before it. */
  private readonly shadowed = new Map<string, string | null | undefined>();
  /** Per table, the tables the list made its descendants. */
  private readonly attached = new Map<string, Set<string>>();
  /** The functions the list defines, by the last part of their names; `*` for one it cannot name. */
  private readonly functions = new Set<string>();
  /** The foreign keys with an ON DELETE action the list added, in order. */
  private readonly addedKeys: {
    parent: string;
    child: string;
    live: boolean;
    columns: string[];
    onDelete: KeyAction;
  }[] = [];

  /**
   * Per live table and column (`table` NUL `column`), the type and
   * nullability the list's last change of it left, each undefined when not
   * known: a later change is judged against them rather than the live ones.
   */
  private readonly changedColumns = new Map<
    string,
    { type: string | undefined; notNull: boolean | undefined }
  >();

  constructor(
    private readonly facts: FactSource,
    private readonly dialect: SupportedDialect
  ) {}

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
        ? `unnamed:${deletion.description}:${deletion.fingerprint ?? ""}`
        : deletion.kind === "column"
          ? `column:${deletion.table}.${deletion.column}`
          : `${deletion.kind}:${deletion.table}`;
    const once = `${String(this.part)}|${key}`;
    if (this.seen.has(once)) return;
    this.seen.add(once);
    this.found.push({ deletion, part: this.part });
  }

  apply(step: Step): void {
    if (this.applyToTable(step) || this.applyToColumn(step)) return;
    this.applyToCode(step);
  }

  /** A step on a table or its rows; false for any other. */
  private applyToTable(step: Step): boolean {
    switch (step.kind) {
      case "create":
        this.create(step.table, step.temporary === true);
        return true;
      case "drop":
        this.drop(step.table, step.temporary === true);
        return true;
      case "rows":
        this.removeRows(step);
        return true;
      case "writes":
        this.write(step);
        return true;
      case "rename-table":
        this.renameTable(step.from, step.to);
        return true;
      case "add-key":
        this.addKey(step);
        return true;
      case "inherit":
        this.inherit(step.parent, step.child);
        return true;
      default:
        return false;
    }
  }

  /** A step on a column; false for any other. */
  private applyToColumn(step: Step): boolean {
    switch (step.kind) {
      case "column":
        this.changeColumn(step);
        return true;
      case "drop-column":
        this.dropColumn(step.table, step.column);
        return true;
      case "add-column":
        this.addColumn(step.table, step.column);
        return true;
      case "rename-column":
        this.renameColumn(step.table, step.from, step.to);
        return true;
      default:
        return false;
    }
  }

  /** A step that runs or defines code, or that could not be read. */
  private applyToCode(step: Step): void {
    switch (step.kind) {
      case "create-function":
        this.functions.add(step.name);
        return;
      case "calls":
        this.call(step);
        return;
      case "unread":
        this.emit(unnamedOf(step));
        return;
      default:
        return;
    }
  }

  /** The name a table goes by in the walk's keys: its live table, or the run's own name. */
  private identity(name: string): string {
    return this.origin(name) ?? name;
  }

  /** Whether `column` of live `table` is one the list itself added. */
  private made(table: string, column: string): boolean {
    return this.madeColumns.get(table)?.has(column) === true;
  }

  private create(table: string, temporary: boolean): void {
    // A temporary table shadows the name until it is dropped again.
    if (temporary) this.shadowed.set(table, this.origins.get(table));
    // A table already there is not the run's: its file may be adopted rather
    // than run, and the live rows stay. Unknown counts as there.
    else if (
      this.origin(table) !== null &&
      this.facts.liveTable(table) !== false
    )
      return;
    this.origins.set(table, null);
  }

  private drop(name: string, temporary: boolean): void {
    if (this.shadowed.has(name)) {
      // Dropping a temporary table loses only what the run put in it, and
      // the name reaches what it reached before again.
      const before = this.shadowed.get(name);
      this.shadowed.delete(name);
      if (before === undefined) this.origins.delete(name);
      else this.origins.set(name, before);
      return;
    }
    // A temporary drop of a name the run made no temporary table for drops
    // a session's temporary table, never the live one.
    if (temporary) return;
    const table = this.origin(name);
    if (table !== null) this.emit({ kind: "table", table });
    this.origins.set(name, null);
  }

  private changeColumn(step: Extract<Step, { kind: "column" }>): void {
    const table = this.origin(step.table);
    if (table === null) return;
    if (!this.made(table, step.column)) {
      const live = this.columnOrigin(table, step.column);
      const before = this.columnNow(table, live);
      if (
        !keepsEveryValue(before, step, this.dialect, () =>
          this.facts.keepsCharacterSet(table, live)
        )
      ) {
        this.emit({ kind: "column", table, column: live });
      }
      this.changedColumns.set(`${table}\0${live}`, {
        type: step.typeKept === true ? before.type : step.to,
        notNull: step.notNull ?? before.notNull,
      });
    }
    this.rewrite(table);
  }

  /** Live `column`'s type and nullability as the list has left them so far. */
  private columnNow(
    table: string,
    column: string
  ): { type: string | undefined; notNull: boolean | undefined } {
    return (
      this.changedColumns.get(`${table}\0${column}`) ?? {
        type: this.facts.liveType(table, column),
        notNull: this.facts.liveNotNull(table, column),
      }
    );
  }

  /**
   * PostgreSQL's conversion of a column rewrites its live table and re-checks
   * every row against the table's CHECK constraints: one calling a function
   * runs it, which only blanket consent covers (`HiddenCode.rewrite`).
   */
  private rewrite(table: string): void {
    const runs = this.facts.hiddenCode(table, "rewrite");
    if (runs === false) return;
    this.emit({
      kind: "unnamed",
      description:
        runs === true
          ? `converting a column of ${table} re-checks its CHECK constraints, which call a function and may delete other data`
          : `converting a column of ${table} re-checks CHECK constraints that could not be read`,
    });
  }

  private dropColumn(name: string, column: string): void {
    const table = this.origin(name);
    if (table === null) return;
    if (this.made(table, column)) {
      this.madeColumns.get(table)?.delete(column);
      return;
    }
    const live = this.columnOrigin(table, column);
    this.emit({ kind: "column", table, column: live });
    const names = this.columnsOf(table);
    names.renamed.delete(column);
    names.away.add(live);
  }

  private addColumn(name: string, column: string): void {
    const table = this.origin(name);
    if (table === null) return;
    // A column the live table may already hold is not the run's own.
    const live = this.facts.liveColumns(table);
    if (live === undefined || live.has(column)) return;
    const made = this.madeColumns.get(table) ?? new Set<string>();
    made.add(column);
    this.madeColumns.set(table, made);
  }

  private addKey(step: Extract<Step, { kind: "add-key" }>): void {
    const child = this.origin(step.table);
    this.addedKeys.push({
      parent: this.identity(step.references),
      child: this.identity(step.table),
      live: child !== null,
      columns:
        child === null
          ? step.columns
          : step.columns.map(column => this.columnOrigin(child, column)),
      onDelete: step.onDelete,
    });
  }

  private renameTable(from: string, to: string): void {
    if (this.shadowed.has(from)) {
      // A temporary table renamed away gives its old name back to what it
      // shadowed, and shadows its new one instead.
      const before = this.shadowed.get(from);
      this.shadowed.delete(from);
      this.shadowed.set(to, this.origins.get(to));
      if (before === undefined) this.origins.delete(from);
      else this.origins.set(from, before);
      this.origins.set(to, null);
      return;
    }
    this.origins.set(to, this.origin(from));
    this.origins.set(from, null);
  }

  private renameColumn(name: string, from: string, to: string): void {
    const table = this.origin(name);
    if (table === null) return;
    if (this.made(table, from)) {
      this.madeColumns.get(table)?.delete(from);
      this.addColumn(name, to);
      return;
    }
    const column = this.columnOrigin(table, from);
    const names = this.columnsOf(table);
    names.renamed.delete(from);
    if (to === column) {
      names.away.delete(column);
    } else {
      names.renamed.set(to, column);
      names.away.add(column);
    }
  }

  /** A statement calling a function the list defined, or one that may delete. */
  private call(step: Extract<Step, { kind: "calls" }>): void {
    const deleting =
      this.functions.has("*") ||
      step.names.some(
        name => this.functions.has(name) || this.facts.mayDeleteThrough(name)
      );
    if (deleting) this.emit(unnamedOf(step));
  }

  /**
   * A removal of the rows of the table `name` means, and of what its foreign
   * keys reach: the live keys as read before the run, and the keys the list
   * itself added before this statement, from a table the list made as well.
   */
  private removeRows(step: Extract<Step, { kind: "rows" }>): void {
    const table = this.origin(step.table);
    if (table !== null) this.emit({ kind: "rows", table });
    // The live tables whose rows go, for the triggers they fire.
    const removed = table === null ? [] : [table];
    // Without ONLY, PostgreSQL's DELETE and TRUNCATE reach every descendant.
    if (table !== null && step.only !== true && step.removal !== "partition") {
      removed.push(...this.descendants(table));
    }
    if (step.reach !== "none") {
      const start = [this.identity(step.table), ...removed.slice(1)];
      removed.push(...this.reach(start, table !== null, step.reach));
    }
    // A MySQL partition truncated fires none of its table's triggers.
    if (step.removal !== "partition") this.hidden(removed, "rows removed from");
  }

  /**
   * Every live table the keys reach from `start` (the first maybe one the list
   * made, when `live` is false), named; the live tables reached.
   */
  private reach(
    start: readonly string[],
    live: boolean,
    reach: Reach
  ): string[] {
    const queue = start.map((table, at) => ({
      table,
      askLive: at > 0 || live,
    }));
    const visited = new Set<string>();
    const removed: string[] = [];
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      if (visited.has(next.table)) continue;
      visited.add(next.table);
      const reached = next.askLive ? this.reachLive(next.table, reach) : [];
      removed.push(...reached);
      // A live table its keys reach may be one the list added a key to.
      queue.push(...reached.map(other => ({ table: other, askLive: false })));
      const added = this.reachAdded(next.table, reach);
      removed.push(...added.filter(key => key.askLive).map(key => key.table));
      queue.push(...added);
    }
    return removed;
  }

  /** The descendants a removal of `table`'s rows reaches, named; none when unreadable, which only blanket consent covers. */
  private descendants(table: string): readonly string[] {
    const found = this.facts.descendantsOf(table);
    if (found === undefined) {
      this.emit({
        kind: "unnamed",
        description: `rows removed from tables that inherit from ${table} or partition it, which could not be read`,
      });
    }
    const all = [...(found ?? []), ...this.attachedTo(table)];
    for (const other of all) this.emit({ kind: "rows", table: other });
    return all;
  }

  /** The live tables the list made descendants of `table`, followed through their own. */
  private attachedTo(table: string): string[] {
    const found: string[] = [];
    const queue = [table];
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      for (const child of this.attached.get(next) ?? []) {
        if (found.includes(child)) continue;
        found.push(child);
        queue.push(child);
      }
    }
    return found.filter(child => this.origin(child) !== null);
  }

  private inherit(parent: string, child: string): void {
    const key = this.identity(parent);
    const children = this.attached.get(key) ?? new Set<string>();
    children.add(this.identity(child));
    this.attached.set(key, children);
  }

  /**
   * Code a live table carries runs when a row change reaches it (`HiddenCode`):
   * each such table stands for a deletion only blanket consent covers, as does
   * one whose code could not be read. `change` says how its rows are reached.
   */
  private hidden(tables: readonly string[], change: string): void {
    for (const table of new Set(tables)) {
      const runs = this.facts.hiddenCode(table, "rows");
      if (runs === false) continue;
      this.emit({
        kind: "unnamed",
        description:
          runs === true
            ? `${change} ${table} run code the table carries (a trigger, a rule, or a default or check calling a function), which may delete other data`
            : `${change} ${table} may run code the table carries, which could not be read`,
      });
    }
  }

  /**
   * Rows written to a live table run the code it carries; a table the list
   * made holds only the run's rows, and code the list defines makes the write
   * unread before it gets here (`placed`).
   */
  private write(step: Extract<Step, { kind: "writes" }>): void {
    const table = this.origin(step.table);
    if (table === null) return;
    // Without ONLY, PostgreSQL writes through a parent reach its descendants
    // (an UPDATE their rows, an INSERT into a partitioned table its
    // partitions), whose own code runs.
    const written =
      step.only === true ? [table] : [table, ...this.writtenDescendants(table)];
    this.hidden(written, "rows written to");
  }

  /** The descendants a write through `table` may reach; none when unreadable, which only blanket consent covers. */
  private writtenDescendants(table: string): readonly string[] {
    const found = this.facts.descendantsOf(table);
    if (found === undefined) {
      this.emit({
        kind: "unnamed",
        description: `rows written to tables that inherit from ${table} or partition it, whose triggers could not be read`,
      });
    }
    return [...(found ?? []), ...this.attachedTo(table)];
  }

  /** What the live keys of `table` reach, named; the tables reached. */
  private reachLive(table: string, reach: Reach): readonly string[] {
    const reached =
      reach === "delete"
        ? this.facts.cascadeFrom(table)
        : this.facts.truncateCascadeFrom(table);
    const nulled = reach === "delete" ? this.facts.nulledBy(table) : [];
    if (reached === undefined || nulled === undefined) {
      // Fails closed: tables nobody could read cannot be named, so only
      // consent without targets covers them.
      this.emit({
        kind: "unnamed",
        description:
          reach === "delete"
            ? `rows removed from tables ${table}'s foreign keys cascade to, which could not be read`
            : `rows removed from tables TRUNCATE ${table} CASCADE also empties, which could not be read`,
      });
      return [];
    }
    for (const other of reached) this.emit({ kind: "rows", table: other });
    for (const { table: on, column } of nulled) {
      this.emit({ kind: "column", table: on, column });
    }
    // Blanking a key updates the child's rows, which runs the code it carries.
    this.hidden(
      nulled.map(({ table: on }) => on),
      "rows changed in"
    );
    return reached;
  }

  /**
   * What the keys the list added on `table` do: a cascade (or a TRUNCATE
   * CASCADE, whatever the action) removes a live child's rows, a SET NULL or
   * SET DEFAULT blanks its key columns. Returns the children to follow on.
   */
  private reachAdded(
    table: string,
    reach: Reach
  ): { table: string; askLive: boolean }[] {
    const follow: { table: string; askLive: boolean }[] = [];
    for (const key of this.addedKeys) {
      if (key.parent !== table) continue;
      if (reach === "truncate" || key.onDelete === "cascade") {
        if (key.live) this.emit({ kind: "rows", table: key.child });
        follow.push({ table: key.child, askLive: key.live });
      } else if (key.live) {
        this.blank(key.child, key.columns);
      }
    }
    return follow;
  }

  /** The key columns of live `table` a SET NULL or SET DEFAULT blanks; a column the list added holds only its own values. */
  private blank(table: string, columns: readonly string[]): void {
    for (const column of columns) {
      if (!this.made(table, column))
        this.emit({ kind: "column", table, column });
    }
    this.hidden([table], "rows changed in");
  }

  /**
   * One live column of a rebuilt table: named when the twin does not carry
   * it, or carries it converted (an unreadable type counts as converted), and
   * followed under the name the twin gives it. `filled` is the copy's
   * twin-to-source columns, undefined without a single copy from the table,
   * when a column the twin declares counts as carried.
   */
  private rebuildColumn(
    table: string,
    liveColumn: string,
    declared: ReadonlyMap<string, TwinColumn>,
    filled: ReadonlyMap<string, string> | undefined,
    after: ColumnNames
  ): void {
    const current = this.currentColumn(table, liveColumn);
    const twinColumn =
      current === undefined
        ? undefined
        : declared.get(carriedAs(current, declared, filled) ?? "");
    if (twinColumn === undefined) {
      // Gone before the rebuild already, or left out by it.
      if (current !== undefined) {
        this.emit({ kind: "column", table, column: liveColumn });
      }
      after.away.add(liveColumn);
      return;
    }
    const liveType = this.facts.liveType(table, liveColumn);
    if (liveType === undefined || typeSpelling(liveType) !== twinColumn.type) {
      this.emit({ kind: "column", table, column: liveColumn });
    }
    if (twinColumn.name !== liveColumn) {
      after.renamed.set(twinColumn.name, liveColumn);
      after.away.add(liveColumn);
    }
  }

  /**
   * A rebuild of a table whose live columns are unknown: the drop it then is,
   * unless the facts defer it to the run (`migrate:check`), which names it as
   * one the run judges, and nothing when its copy carries every column the
   * twin declares, by the same name, and every row.
   */
  private rebuildUnseen(
    rebuild: Rebuild,
    statements: readonly string[],
    table: string
  ): void {
    if (this.facts.unseenRebuild === "drop") {
      this.emit({ kind: "table", table });
      return;
    }
    if (carriesEverything(rebuild, statements)) return;
    this.emit({
      kind: "unnamed",
      description: `${table} rebuilt (may delete data, checked at run time)`,
    });
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
      this.rebuildUnseen(rebuild, statements, table);
      return;
    }
    const { filled, allRows } = readRebuildCopy(rebuild, statements);
    const declared = new Map(
      rebuild.columns.map(column => [column.name, column])
    );
    const after: ColumnNames = { renamed: new Map(), away: new Set() };
    for (const liveColumn of live) {
      this.rebuildColumn(table, liveColumn, declared, filled, after);
    }
    if (filled === undefined || !allRows) this.emit({ kind: "rows", table });
    this.columnNames.set(table, after);
  }
}

/** Whether a rebuild's one copy takes every row, and fills every twin column from a column of its name. */
function carriesEverything(
  rebuild: Rebuild,
  statements: readonly string[]
): boolean {
  if (rebuild.copies.length !== 1) return false;
  const copy = readCopy(
    statements[rebuild.copies[0]],
    rebuild.twin,
    rebuild.columns
  );
  if (copy?.from !== rebuild.table || !copy.allRows) return false;
  return rebuild.columns.every(
    column => copy.filled.get(column.name) === column.name
  );
}

/**
 * What a rebuild copies from its table: with one copy from the table, the
 * twin columns it fills from which columns, and whether it takes every row.
 * Without one, nothing is filled and the rows are gone, and a column the twin
 * declares counts as carried.
 */
function readRebuildCopy(
  rebuild: Rebuild,
  statements: readonly string[]
): { filled: Map<string, string> | undefined; allRows: boolean } {
  const copy =
    rebuild.copies.length === 1
      ? readCopy(statements[rebuild.copies[0]], rebuild.twin, rebuild.columns)
      : undefined;
  if (copy === undefined || copy.from !== rebuild.table) {
    return { filled: undefined, allRows: false };
  }
  return { filled: copy.filled, allRows: copy.allRows };
}

/**
 * The twin column a rebuild carries the column now named `current` into:
 * the one the copy fills from it, or, without a copy to read, the twin's
 * column of the same name.
 */
function carriedAs(
  current: string,
  declared: ReadonlyMap<string, TwinColumn>,
  filled: ReadonlyMap<string, string> | undefined
): string | undefined {
  if (filled === undefined) return declared.has(current) ? current : undefined;
  return [...filled].find(([, source]) => source === current)?.[0];
}

/** The deletion an unread statement, or a call that may delete, stands for. */
function unnamedOf(
  step: Extract<Step, { kind: "unread" | "calls" }>
): Deletion {
  return {
    kind: "unnamed",
    description: step.description,
    ...(step.fingerprint === undefined
      ? {}
      : { fingerprint: step.fingerprint }),
  };
}

/**
 * An unread step names the statement it was judged from by its whole text,
 * strings and bodies included, so agreeing to one statement before the lock
 * never agrees to a different one under it, and two different statements
 * under one label stay two deletions.
 */
function fingerprinted(step: Step, statement: string): Step {
  if (step.kind !== "unread" && step.kind !== "calls") return step;
  return {
    ...step,
    fingerprint: createHash("sha256").update(statement).digest("hex"),
  };
}

/**
 * What a MySQL run `migrate:create` writes does, named as statements name
 * things (lower-cased): a rename renames the column and deletes nothing; a
 * nullability change keeps the column's type, character set and collation,
 * and is judged by its nullability (`keepsEveryValue`).
 */
function liveRunSteps(run: MysqlLiveRun): Step[] {
  const table = run.tableName.toLowerCase();
  return run.kind === "rename"
    ? [
        {
          kind: "rename-column",
          table,
          from: run.fromColumn.toLowerCase(),
          to: run.toColumn.toLowerCase(),
        },
      ]
    : [
        {
          kind: "column",
          table,
          column: run.columnName.toLowerCase(),
          notNull: !run.toNullable,
          typeKept: true,
        },
      ];
}

/** Every step of the list, with each SQLite rebuild judged as one. */
function walk(
  statements: readonly string[],
  dialect: SupportedDialect,
  facts: FactSource,
  partOf: (at: number) => number = () => 0
): { deletion: Deletion; part: number }[] {
  const file = new FileWalk(facts, dialect);
  const rebuilds = rebuildsIn(statements, dialect);
  const byDrop = new Map(rebuilds.map(rebuild => [rebuild.dropAt, rebuild]));
  // The twin's creation, its copies and its rename back are the rebuild's
  // own, judged with it at its drop.
  const state: WalkState = { pathMoved: false, codeDefined: false };
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
      // A MySQL run `migrate:create` writes builds its statement from the
      // catalog when the file runs: read as what it amounts to, its later
      // statements its own.
      const run =
        dialect === "mysql" ? mysqlLiveRunAt(statements, at) : undefined;
      if (run !== undefined) {
        for (let k = 1; k < MYSQL_LIVE_RUN_LENGTH; k++) owned.add(at + k);
      }
      const read = run === undefined ? statement : plainMysqlStatement(run);
      const tokens = tokensOf(read, dialect);
      for (const step of placed(
        run === undefined
          ? readStatement(statement, dialect)
          : liveRunSteps(run),
        tokens,
        state
      )) {
        file.apply(fingerprinted(step, statement));
      }
      const call = readCalls(tokens);
      if (call !== undefined) file.apply(fingerprinted(call, statement));
      advance(state, tokens);
    }
  });
  return file.found;
}

/**
 * The settings whose change moves where an unqualified name points:
 * PostgreSQL's search path (`SCHEMA` is its alias), the role its `"$user"`
 * entry resolves to, and `ALL`, which resets both.
 */
const NAME_SETTINGS = new Set([
  "SEARCH_PATH",
  "SCHEMA",
  "ROLE",
  "AUTHORIZATION",
  "ALL",
]);

/**
 * Whether a statement changes where an unqualified name points: a
 * `SET`/`RESET` of a setting names resolve by (`NAME_SETTINGS`, after an
 * optional `SESSION` or `LOCAL`), PostgreSQL's `DISCARD` (`ALL` resets the
 * path, `TEMP` gives shadowed names back), a `set_config` call, which may set it, and MySQL's `USE`. The live
 * facts were read for the names as they pointed before.
 */
function movesPath(tokens: readonly Token[]): boolean {
  const [first] = tokens;
  if (first === "USE" || first === "DISCARD") return true;
  if (first === "SET" || first === "RESET") {
    // The setting follows SESSION or LOCAL when one is written: `SET
    // CONSTRAINTS ALL` names no setting.
    const at = tokens[1] === "SESSION" || tokens[1] === "LOCAL" ? 2 : 1;
    const setting = tokens[at];
    return typeof setting === "string" && NAME_SETTINGS.has(setting);
  }
  return tokens.some(
    (token, at) =>
      (token === "SET_CONFIG" || token === "PG_CATALOG.SET_CONFIG") &&
      tokens[at + 1] === "("
  );
}

/** The kinds of step that place data in a table by its name. */
const PLACING = new Set<Step["kind"]>([
  "rows",
  "drop",
  "drop-column",
  "column",
  "writes",
]);

/**
 * A statement's steps once the path may have moved: one that places data by a
 * name stands as a statement that could not be read, which only the consent
 * without targets covers.
 */
function placed(
  steps: Step[],
  tokens: readonly Token[],
  state: WalkState
): Step[] {
  const why = unplacedBecause(steps, state);
  if (why === undefined) return steps;
  return [
    {
      kind: "unread",
      description: `${labelOf(tokens)} (${why}, not read, may delete data)`,
    },
  ];
}

/** Why a statement's steps cannot be placed: the path moved before it, or the list defined code before a row change. */
function unplacedBecause(
  steps: readonly Step[],
  state: WalkState
): string | undefined {
  if (state.pathMoved && steps.some(step => PLACING.has(step.kind))) {
    return "search path changed";
  }
  if (state.codeDefined && steps.some(step => ROW_CHANGES.has(step.kind))) {
    return "the run defined code before it";
  }
  return undefined;
}

/** The kinds of step that change rows, which code the list defines may reach. */
const ROW_CHANGES = new Set<Step["kind"]>(["rows", "writes"]);

/** What the walk carries from one statement to the next. */
interface WalkState {
  /** The search path moved (`movesPath`): names may point elsewhere. */
  pathMoved: boolean;
  /** The list defined code (`definesRunCode`): any later row change may run it. */
  codeDefined: boolean;
}

/** `state` once `tokens` ran. */
function advance(state: WalkState, tokens: readonly Token[]): void {
  state.pathMoved ||= movesPath(tokens);
  state.codeDefined ||= definesRunCode(tokens);
}

/**
 * What a CREATE defines that runs later, on rows or calls, unseen by any
 * catalog read before the run: a function, procedure, trigger (an event
 * trigger too), rule, aggregate, operator, cast, or MySQL's event.
 */
const RUN_CODE_FORMS = new Set([
  "FUNCTION",
  "PROCEDURE",
  "TRIGGER",
  "RULE",
  "AGGREGATE",
  "OPERATOR",
  "CAST",
  "EVENT",
]);

/** Whether a statement defines code the run may later reach (`RUN_CODE_FORMS`), qualified or not, after `OR REPLACE` or a MySQL definer. */
function definesRunCode(tokens: readonly Token[]): boolean {
  if (tokens[0] !== "CREATE") return false;
  return tokens
    .slice(1, 10)
    .some(token => typeof token === "string" && RUN_CODE_FORMS.has(token));
}

/**
 * Whether a SELECT calling `name` may run code that deletes: a function the
 * database defines outside its system catalogs. A name qualified by another
 * schema, or any name when the functions could not be read, may.
 */
function mayDeleteThrough(
  name: string,
  userFunctions: ReadonlySet<string> | undefined
): boolean {
  // Only a call the catalog proves to be the system's is harmless: a name
  // alone (setval, nextval) proves nothing, since a user function may have it.
  if (name.startsWith("pg_catalog.")) return false;
  if (userFunctions === undefined || name.includes(".")) return true;
  return userFunctions.has(name);
}

/** The questions a walk asks, answered from facts read once. */
function factSource(facts: DeletionFacts): FactSource {
  return {
    cascadeFrom: table => facts.cascadeFrom(table),
    truncateCascadeFrom: table => facts.truncateCascadeFrom(table),
    nulledBy: table => facts.nulledBy(table),
    hiddenCode: (table, on) => facts.hiddenCode(table, on),
    descendantsOf: table => facts.descendantsOf(table),
    liveTable: table => facts.liveTable(table),
    mayDeleteThrough: name => mayDeleteThrough(name, facts.userFunctions),
    unseenRebuild: facts.unseenRebuild ?? "drop",
    liveColumns: table => facts.liveColumns.get(table),
    liveType: (table, column) => facts.liveColumnTypes?.get(table)?.get(column),
    keepsCharacterSet: (table, column) => {
      const other = facts.otherCharsets?.get(table);
      return other === undefined ? undefined : !other.has(column);
    },
    liveNotNull: (table, column) => facts.liveNotNull?.get(table)?.has(column),
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

/**
 * The functions a statement list defines (`CREATE [OR REPLACE] FUNCTION`),
 * lower-cased: what `migrate:check`, which reads no catalog, counts as
 * user-defined.
 */
export function functionsDefinedBy(
  statements: readonly string[],
  dialect: SupportedDialect
): string[] {
  return statements.flatMap(statement =>
    readStatement(statement, dialect).flatMap(step =>
      step.kind === "create-function" ? [step.name] : []
    )
  );
}

/** A read that answers undefined rather than throwing. */
async function settle<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/** What a removal of a table's rows reaches through foreign keys: the tables whose rows go, and the columns blanked. */
interface Reached {
  rows: string[];
  nulled: NulledColumn[];
}

/** A relation's identity, for telling two same-named tables apart. */
function relationKey(ref: RelationRef): string {
  return `${ref.schema ?? ""}.${ref.table}`.toLowerCase();
}

/**
 * What a removal of `root`'s rows reaches, followed transitively and by
 * relation identity (`readReferencingKeys`), so a child in another schema or
 * database is never confused with a same-named table the search path shows:
 * the tables whose rows go, lower-cased and sorted, `root` excluded, through
 * every referencing key when `every` (PostgreSQL's TRUNCATE CASCADE) and
 * through ON DELETE CASCADE keys otherwise; and, for a delete, each column a
 * SET NULL or SET DEFAULT key on a reached table blanks.
 */
async function reachedFrom(
  db: unknown,
  dialect: "postgresql" | "mysql",
  root: string,
  every: boolean
): Promise<Reached> {
  const rows = new Set<string>();
  const nulled: NulledColumn[] = [];
  const queue: RelationRef[] = [{ table: root }];
  const seen = new Set([relationKey(queue[0])]);
  for (
    let parent = queue.shift();
    parent !== undefined;
    parent = queue.shift()
  ) {
    for (const key of await readReferencingKeys(db, dialect, parent)) {
      if (every || key.onDelete === "cascade") {
        if (seen.has(relationKey(key.ref))) continue;
        seen.add(relationKey(key.ref));
        rows.add(key.child.toLowerCase());
        queue.push(key.ref);
      } else if (
        key.onDelete === "set null" ||
        key.onDelete === "set default"
      ) {
        const table = key.child.toLowerCase();
        nulled.push(
          ...key.columns.map(column => ({
            table,
            column: column.toLowerCase(),
          }))
        );
      }
    }
  }
  rows.delete(root.toLowerCase());
  return { rows: [...rows].sort(), nulled };
}

/** The questions a walk asked that no reading has answered yet. */
interface Questions {
  cascade: Set<string>;
  truncate: Set<string>;
  rebuilt: Set<string>;
  /** Tables a row change reaches, asked what code they carry. */
  hidden: Set<string>;
  descendants: Set<string>;
  /** Tables the list creates, asked whether they exist already. */
  live: Set<string>;
  calls: boolean;
}

/** Whether a walk asked nothing new. */
function answered(asked: Questions): boolean {
  return (
    !asked.calls &&
    [
      asked.cascade,
      asked.truncate,
      asked.rebuilt,
      asked.hidden,
      asked.descendants,
      asked.live,
    ].every(set => set.size === 0)
  );
}

/** A known answer, or the question recorded in `pending` when there is none yet. */
function lookup<T>(
  known: ReadonlyMap<string, T>,
  key: string,
  pending: Set<string>
): { value: T } | undefined {
  if (known.has(key)) return { value: known.get(key) as T };
  pending.add(key);
  return undefined;
}

/**
 * The live facts read so far, by lower-cased table: a walk asks them, and
 * what it asks beyond them is recorded, read, and answered on the next walk.
 * An answer that could not be read is undefined, which the walk fails closed on.
 */
class FactReading {
  private readonly cascades = new Map<string, Reached | undefined>();
  private readonly truncates = new Map<string, readonly string[] | undefined>();
  private readonly hidden = new Map<string, HiddenCode | undefined>();
  private readonly liveTables = new Map<string, boolean | undefined>();
  /** Set once the tables could not be read: whether one exists is then unknown. */
  private spellFailed = false;
  private readonly descendants = new Map<
    string,
    readonly string[] | undefined
  >();
  private readonly columnTypes = new Map<
    string,
    Map<string, string> | undefined
  >();
  /** MySQL: per table read with its column types, its columns of another character set. */
  private readonly charsets = new Map<string, Set<string> | undefined>();
  /** Per table read with its column types, its NOT NULL columns, from the same reading. */
  private readonly notNulls = new Map<string, Set<string> | undefined>();
  private readonly spellings = new Map<string, string>();
  /**
   * Lower-cased names two live tables share but for case ("Posts" beside posts, which
   * PostgreSQL's quoted names and MySQL on a case-sensitive file system allow): which one a
   * statement means cannot be told, so every fact for such a name reads unknown.
   */
  private readonly twins = new Set<string>();
  /** Null until a walk calls a function; undefined when they could not be read. */
  private userFunctions: ReadonlySet<string> | undefined | null = null;

  constructor(
    private readonly db: unknown,
    private readonly dialect: SupportedDialect
  ) {}

  /** What a walk of `statements` asks that is not answered yet. */
  ask(statements: readonly string[]): Questions {
    const asked: Questions = {
      cascade: new Set(),
      truncate: new Set(),
      rebuilt: new Set(),
      hidden: new Set(),
      descendants: new Set(),
      live: new Set(),
      calls: false,
    };
    walk(statements, this.dialect, this.answering(asked));
    return asked;
  }

  /** Facts answering from what is known, recording into `asked` what is not. */
  private answering(asked: Questions): FactSource {
    const reached = (table: string) =>
      lookup(this.cascades, table, asked.cascade);
    return {
      cascadeFrom: table => {
        const known = reached(table);
        return known === undefined ? [] : known.value?.rows;
      },
      nulledBy: table => {
        const known = reached(table);
        return known === undefined ? [] : known.value?.nulled;
      },
      truncateCascadeFrom: table => {
        const known = lookup(this.truncates, table, asked.truncate);
        return known === undefined ? [] : known.value;
      },
      hiddenCode: (table, on) => {
        const known = lookup(this.hidden, table, asked.hidden);
        return known === undefined ? false : known.value?.[on];
      },
      descendantsOf: table => {
        const known = lookup(this.descendants, table, asked.descendants);
        return known === undefined ? [] : known.value;
      },
      liveTable: table => {
        const known = lookup(this.liveTables, table, asked.live);
        return known === undefined ? false : known.value;
      },
      mayDeleteThrough: name => {
        if (this.userFunctions !== null)
          return mayDeleteThrough(name, this.userFunctions);
        asked.calls = true;
        return false;
      },
      unseenRebuild: "drop",
      liveColumns: table => {
        const known = lookup(this.columnTypes, table, asked.rebuilt);
        return known?.value === undefined
          ? undefined
          : new Set(known.value.keys());
      },
      // Asked for a column whose type a statement changes: its table's
      // column types (and, on MySQL, character sets) are read with a
      // rebuilt table's, in one reading.
      liveType: (table, column) =>
        lookup(this.columnTypes, table, asked.rebuilt)?.value?.get(column),
      keepsCharacterSet: (table, column) => {
        const other = lookup(this.charsets, table, asked.rebuilt)?.value;
        return other === undefined ? undefined : !other.has(column);
      },
      liveNotNull: (table, column) =>
        lookup(this.notNulls, table, asked.rebuilt)?.value?.has(column),
    };
  }

  /** Reads what `asked` asks, read-only; a fact that cannot be read is recorded as undefined. */
  async answer(asked: Questions): Promise<void> {
    await this.spell([
      ...asked.cascade,
      ...asked.truncate,
      ...asked.rebuilt,
      ...asked.descendants,
      ...asked.live,
      ...asked.hidden,
    ]);
    for (const table of asked.live) {
      this.liveTables.set(
        table,
        this.spellFailed ? undefined : this.spellings.has(table)
      );
    }
    for (const table of asked.cascade)
      this.cascades.set(table, await this.readCascade(table));
    for (const table of asked.truncate)
      this.truncates.set(table, await this.readTruncate(table));
    for (const table of asked.hidden) {
      this.hidden.set(table, await this.readHidden(table));
    }
    for (const table of asked.descendants) {
      this.descendants.set(table, await this.readDescendants(table));
    }
    await this.readColumnTypes([...asked.rebuilt]);
    if (asked.calls)
      this.userFunctions = await settle(() =>
        readUserFunctions(this.db, this.dialect)
      );
  }

  /** The live spelling of each table not spelled yet; a table the database lacks has none. */
  private async spell(tables: readonly string[]): Promise<void> {
    const unspelled = [...new Set(tables)].filter(
      table => !this.spellings.has(table)
    );
    if (unspelled.length === 0) return;
    const live = await settle(() =>
      introspectTableNames(this.db, this.dialect, unspelled)
    );
    if (live === undefined) this.spellFailed = true;
    for (const name of live ?? []) {
      const key = name.toLowerCase();
      const spelled = this.spellings.get(key);
      if (spelled !== undefined && spelled !== name) this.twins.add(key);
      this.spellings.set(key, name);
    }
  }

  /** How a table is named to the catalog: its live spelling, or a PostgreSQL name already qualified (a descendant's). */
  private live(table: string): string | undefined {
    // A name two live tables share but for case names neither for certain.
    if (this.twins.has(table)) return undefined;
    const spelled = this.spellings.get(table);
    if (spelled !== undefined) return spelled;
    return this.dialect === "postgresql" && table.includes(".")
      ? table
      : undefined;
  }

  private async readCascade(table: string): Promise<Reached | undefined> {
    // The runner applies every SQLite unit with foreign-key enforcement off
    // (`withSqliteForeignKeysOff`), so no cascade fires there, whatever the
    // connection's own setting: a removal that would orphan rows is refused
    // by the unit's `PRAGMA foreign_key_check` instead.
    if (this.dialect === "sqlite") return { rows: [], nulled: [] };
    const live = this.live(table);
    const dialect = this.dialect;
    return live === undefined
      ? undefined
      : await settle(() => reachedFrom(this.db, dialect, live, false));
  }

  private async readTruncate(
    table: string
  ): Promise<readonly string[] | undefined> {
    const live = this.live(table);
    if (live === undefined || this.dialect !== "postgresql") return undefined;
    return (await settle(() => reachedFrom(this.db, "postgresql", live, true)))
      ?.rows;
  }

  private async readHidden(table: string): Promise<HiddenCode | undefined> {
    const live = this.live(table);
    if (live === undefined) return undefined;
    return settle(() => readHiddenCode(this.db, this.dialect, live));
  }

  private async readDescendants(
    table: string
  ): Promise<readonly string[] | undefined> {
    if (this.dialect !== "postgresql") return [];
    const live = this.live(table);
    if (live === undefined) return undefined;
    const found = await settle(() => readPgDescendants(this.db, live));
    return found?.map(name => name.toLowerCase());
  }

  /**
   * The live columns, types and nullability of the tables asked (a rebuilt
   * table's, or one whose column a statement changes), from one reading.
   */
  private async readColumnTypes(tables: readonly string[]): Promise<void> {
    if (tables.length === 0) return;
    const live = tables.flatMap(table => {
      const name = this.live(table);
      return name === undefined ? [] : [name];
    });
    const snapshot =
      live.length === 0
        ? { tables: [] }
        : await settle(() =>
            introspectLiveColumns(this.db, this.dialect, live)
          );
    const byTable = new Map(
      (snapshot?.tables ?? []).map(found => [
        found.name.toLowerCase(),
        found.columns,
      ])
    );
    for (const table of tables) {
      const columns = byTable.get(table);
      this.columnTypes.set(
        table,
        columns === undefined
          ? undefined
          : new Map(
              columns.map(c => [c.name.toLowerCase(), c.type.toLowerCase()])
            )
      );
      this.notNulls.set(
        table,
        columns === undefined
          ? undefined
          : new Set(
              columns.filter(c => !c.nullable).map(c => c.name.toLowerCase())
            )
      );
    }
    // Elsewhere a type change keeps the column's character set, so nothing
    // is read; a MySQL table whose sets could not be read stays unknown.
    const other =
      this.dialect !== "mysql"
        ? new Map<string, Set<string>>()
        : await settle(() => readMysqlOtherCharsets(this.db, live));
    for (const table of tables) {
      this.charsets.set(
        table,
        other === undefined
          ? undefined
          : (other.get(table) ?? new Set<string>())
      );
    }
  }

  /** The facts read, as the walk's judgement takes them. */
  facts(): DeletionFacts {
    // The column names are derived from the one reading of the types, so the
    // two cannot disagree about which columns a table has.
    const liveColumnTypes = new Map<string, Map<string, string>>();
    for (const [table, columns] of this.columnTypes) {
      if (columns !== undefined) liveColumnTypes.set(table, columns);
    }
    const otherCharsets = new Map<string, Set<string>>();
    for (const [table, columns] of this.charsets) {
      if (columns !== undefined) otherCharsets.set(table, columns);
    }
    const liveNotNull = new Map<string, Set<string>>();
    for (const [table, columns] of this.notNulls) {
      if (columns !== undefined) liveNotNull.set(table, columns);
    }
    const liveColumns: LiveColumns = new Map(
      [...liveColumnTypes].map(([table, columns]) => [
        table,
        new Set(columns.keys()),
      ])
    );
    const userFunctions =
      this.userFunctions === null ? new Set<string>() : this.userFunctions;
    return {
      cascadeFrom: table => this.cascades.get(table.toLowerCase())?.rows,
      nulledBy: table => this.cascades.get(table.toLowerCase())?.nulled,
      truncateCascadeFrom: table => this.truncates.get(table.toLowerCase()),
      hiddenCode: (table, on) => this.hidden.get(table.toLowerCase())?.[on],
      descendantsOf: table => this.descendants.get(table.toLowerCase()),
      liveTable: table => this.liveTables.get(table.toLowerCase()),
      ...(userFunctions === undefined ? {} : { userFunctions }),
      liveColumns,
      liveColumnTypes,
      otherCharsets,
      liveNotNull,
    };
  }
}

/**
 * How many times the facts are read before what is still unasked is left
 * unread: each round answers questions earlier answers raised (a
 * descendant's cascades, a cascaded table's triggers), so a list needs one
 * round per level it reaches through.
 */
const FACT_ROUNDS = 8;

/**
 * Reads, read-only, every fact `fileDeletions` will ask about these
 * statements. The questions are the walk's own: it is walked against the
 * facts read so far, what it asks beyond them is read, and it is walked
 * again, until it asks nothing new. Never throws for an unreadable fact: it
 * answers undefined, and the walk fails closed on it.
 */
export async function readDeletionFacts(
  db: unknown,
  dialect: SupportedDialect,
  statements: readonly string[]
): Promise<DeletionFacts> {
  const reading = new FactReading(db, dialect);
  for (let round = 0; round < FACT_ROUNDS; round += 1) {
    const asked = reading.ask(statements);
    if (answered(asked)) break;
    await reading.answer(asked);
  }
  return reading.facts();
}
