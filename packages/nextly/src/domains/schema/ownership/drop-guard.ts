/**
 * Never drop a table on behalf of an owner that does not own it.
 *
 * Two mechanisms are needed because two different executors run DDL, and they
 * fail differently.
 *
 * **Dev push** goes through `filterUnsafeStatements`, which already blocks
 * drops of tables outside the desired set and allows the in-desired drop a
 * SQLite rebuild needs. Both rules stay exactly as they are; the push side of
 * this module adds one more, and only in the direction of refusing.
 *
 * **File migrations do not pass through that filter at all** — `executeSql`
 * runs the SQL verbatim. Filtering statements there would be worse than
 * useless: a file with some statements removed would be recorded as APPLIED,
 * so the ledger would claim a migration ran that partly did not. So a
 * migration is judged WHOLE, before its first statement executes, and refused
 * outright.
 *
 * **What this guard is for.** Plugins are trusted code: they already run
 * in-process with raw database access (`ctx.db.raw`), so nothing that reads
 * their migration text can be a security boundary against a hostile plugin.
 * The guard exists to stop a migration dropping another owner's table BY
 * MISTAKE, and to refuse rather than guess whenever the text is ambiguous.
 * The two errors are not symmetric: reading a table that is not really
 * dropped at worst refuses a migration, while missing one that is lets the
 * migration take another owner's table with the guard's approval. So wherever
 * a rule below has to choose between two readings, it takes the one that
 * reads more drops or refuses.
 *
 * **How the text is read.** Each statement is walked as CODE by a small lexer
 * that knows the dialect it will run on, because which text is a comment, a
 * string or a name differs between them: `#` starts a comment only in MySQL,
 * MySQL's `--1` is arithmetic, PostgreSQL's block comments nest, and a
 * string may hold `drop table` as data. Comments and string literals are
 * skipped, so text inside them is never read as a drop; a PostgreSQL
 * dollar-quoted body is read as code, because it usually is one (a `DO`
 * block or a function body). Anything the lexer cannot place with certainty
 * — an unterminated string or comment, a backslash whose meaning depends on
 * a server setting, a MySQL executable comment — refuses the statement.
 *
 * **Renames count as taking the table.** A migration that renames another
 * owner's table (or moves it with PostgreSQL's `SET SCHEMA`) is refused like
 * a drop of it. Following renames within one statement list is not enough:
 * the rename can ship in one module and the drop of the new name in a later
 * one, or in an uninstall's DOWN, and by then no owner row names the table
 * by what it is called. PostgreSQL also renames a table through
 * `ALTER INDEX ... RENAME TO`, so a name such a rename names that no live
 * index has is judged as a table rename; and it renames a plain table's
 * column through `ALTER VIEW`, `ALTER MATERIALIZED VIEW` and
 * `ALTER FOREIGN TABLE` (`RENAME [COLUMN]`) and `ALTER TYPE ... RENAME
 * ATTRIBUTE`, each read as `ALTER TABLE ... RENAME COLUMN` is.
 *
 * **Emptying a table, or changing its partitions, counts too.** `TRUNCATE`
 * of another owner's table is refused, and so is a partition change to one:
 * PostgreSQL's `ATTACH|DETACH PARTITION` and `CREATE TABLE ... PARTITION
 * OF`, MySQL's `DROP|TRUNCATE|EXCHANGE|DISCARD|IMPORT PARTITION`. A table
 * attached as a partition, or exchanged with one, is judged too, since a
 * later drop of the parent takes it or its rows.
 *
 * **A SQLite rebuild keeps more than rows.** A complete rebuild of another
 * owner's table must keep its live primary key, its unique constraints, and
 * each kept column's declared type, NOT NULL and default, and the table may
 * have no triggers, which no twin can declare (`shapeKept`).
 *
 * **Names are compared as the database stores them.** PostgreSQL cuts a name
 * longer than 63 bytes to its whole characters within them, so on
 * PostgreSQL both the names a statement writes and those the owner rows
 * record are cut the same way before they are compared.
 *
 * **Code written as a string is refused.** A string literal is data to this
 * reader, so a statement that runs one as code is refused: `EXECUTE` and
 * `PREPARE`, which run SQL assembled at run time, and on PostgreSQL a `DO`,
 * `CREATE FUNCTION` or `CREATE PROCEDURE` whose body is a quoted string
 * rather than dollar-quoted.
 *
 * **What a drop takes with it.** On PostgreSQL, `CASCADE` on a DROP of
 * anything but a table also removes whatever depends on the object — the
 * columns of a dropped type or domain, a generated column calling a dropped
 * function, a table typed by a dropped type — none of which the text names,
 * so it is refused, and so is `CASCADE` on an ALTER TABLE's drop of a column
 * or constraint, which takes another table's foreign key or a view with it.
 * Without `CASCADE` PostgreSQL itself refuses the drop while anything depends
 * on the object. `ALTER TYPE ... CASCADE` is refused too: it changes every
 * table typed by the type.
 *
 * **What a statement reaches below a table.** On PostgreSQL an
 * `ALTER TABLE` or `TRUNCATE` without `ONLY` acts on every table inheriting
 * from the one it names and every partition of it, at any depth, and a
 * `DROP TABLE` takes its partitions and, with `CASCADE`, its inheriting
 * tables. The text names none of them, so they are read from the live
 * catalog (`readLiveTables`), and each is judged as the table the statement
 * names: one the stream does not hold is refused.
 *
 * **A form the guard cannot read.** An ALTER TABLE clause this reader does
 * not model is refused on another owner's table, and on any table another
 * owner has a column, index or constraint on, since it may change those:
 * `CONVERT TO CHARACTER SET` rewrites every column. MySQL table options that
 * change no element (a comment, the lock or algorithm, the default
 * character set) are let through on a table the stream holds. MariaDB's
 * `WAIT n` and `NOWAIT` before the clauses, and its `IF EXISTS` inside a
 * column clause, are stepped past, so the clause after them is read.
 *
 * **A name looked up before the list runs.** An index named without its
 * table, and a PostgreSQL ALTER TABLE target that may be an index, are found
 * in the live database once, before the list runs. A statement naming one
 * after an earlier statement dropped, renamed or moved a relation of that
 * name is refused, since the name may then reach a relation it shadowed.
 *
 * **What a change to another owner's table is credited for.** A column or
 * constraint a list adds is the list's to change afterwards only where the
 * text proves the addition: `ADD COLUMN c`, `ADD` with a quoted name, or a
 * named constraint, in an ALTER TABLE that opens its statement. One inside a
 * routine body may never run, and a bare word after `ADD` may be a keyword.
 *
 * **Known limit.** Only text is read. SQL passed as a string to a function
 * that runs it is data to this reader, not code. And on PostgreSQL a
 * `DROP TABLE ... CASCADE`, which generated migrations write, also removes
 * the views and foreign keys that depend on the table, which only the
 * database knows. What a
 * statement does to rows it keeps the table for is not judged: `DELETE`,
 * `UPDATE`, and a column's type changed in place (`ALTER COLUMN ... TYPE`).
 * Nor are MySQL's partition changes that keep every row (`REORGANIZE`,
 * `COALESCE`). A view, materialized view, foreign table or type is judged
 * by the owner rows of its name as a table is, so a plugin renaming a column
 * of a view no row records as its own is refused.
 *
 * @module domains/schema/ownership/drop-guard
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import { CORE_TABLE_NAMES } from "../../../schemas";
import { scanSql, type SqlSegment } from "../migrate/sql-scan";
import type { ContributedElements, TableSpec } from "../pipeline/diff/types";

import type { OwnerRecord } from "./owner-registry";
import { SchemaOwnersRepository } from "./schema-owners-repository";

/**
 * SQLite rebuilds a table through a `__new_<table>` twin.
 *
 * A statement naming `__new_dc_posts` is really about `dc_posts`, so the
 * prefix is stripped before the owner is looked up. Without this a rebuild's
 * intermediate drop would be attributed to a table nobody owns and waved
 * through, which is the one case where waving through is wrong.
 */
function canonicalTableName(name: string): string {
  return name.startsWith("__new_") ? name.slice("__new_".length) : name;
}

/**
 * Where a statement could not be read for the tables it drops, and why —
 * refused rather than guessed at.
 *
 * A `NextlyError` carrying the foreign-drop refusal's code, so the CLI prints
 * it the way it prints that refusal — the public message and the log context
 * naming the statement and the reason — rather than as an unexpected crash
 * with a stack. Kept as a named class because tests identify it by type.
 */
export class UnparsableDropTarget extends NextlyError {
  constructor(
    readonly statement: string,
    readonly reason: string,
    /** The migration file or module, when the caller knows it. */
    source?: string
  ) {
    super({
      // The foreign-drop refusal's code: a drop whose target cannot be read
      // is refused for the same reason, that it may take another owner's
      // table. The `reason` in its log context, which the foreign-drop
      // refusal does not carry, is what tells the two apart.
      code: "DROP_OF_FOREIGN_TABLE",
      publicMessage:
        "A migration contains SQL whose drops cannot be read, so which owner's tables it drops cannot be checked. It has been refused.",
      logContext: { reason, statement, source },
    });
    this.name = "UnparsableDropTarget";
  }
}

/**
 * One lexical token of a statement.
 *
 * Comments and whitespace produce nothing. `end` marks where one statement
 * ends and the next begins: a `;`, or either edge of a PostgreSQL
 * dollar-quoted body, whose contents are a statement list of their own;
 * `body` says which edge, so a walk knows when it is inside one.
 */
type Token =
  /** A bare word: a keyword or an unquoted name. */
  | { kind: "word"; upper: string; text: string }
  /** A quoted name, with its quoting removed. */
  | { kind: "name"; name: string }
  /**
   * A string literal. `asName` is set where the dialect also accepts the
   * same text as a name: MySQL's `"..."` under ANSI_QUOTES, and SQLite's
   * `'...'`, which it takes as a name wherever one is expected.
   */
  | { kind: "string"; asName?: string }
  /** PostgreSQL's `U&"..."`: a name spelled with escapes this does not decode. */
  | { kind: "escaped-name" }
  | { kind: "punct"; char: string }
  | { kind: "end"; body?: "open" | "close" };

/**
 * Characters of a bare word. Every byte at or above 0x80 continues an
 * identifier in PostgreSQL, and MySQL permits U+0080..U+FFFF, so the
 * non-ASCII range is included whole: stopping at `é` in `fx__notesé,
 * app_notes` would end a name early while the database kept reading.
 */
const WORD = /(?:[\w$]|[^\p{ASCII}])+/uy;

/**
 * Lexes one statement's text into tokens, from the segments the shared
 * scanner (`sql-scan.ts`) finds — the scanner the splitter uses, so the text
 * this reads as a string, a comment or a body is the text the executor was
 * handed as one. Every refusal names the whole statement.
 */
class Lexer {
  constructor(
    private readonly dialect: SupportedDialect,
    private readonly statement: string
  ) {}

  private refuse(reason: string): never {
    throw new UnparsableDropTarget(this.statement, reason);
  }

  tokens(text: string, out: Token[] = []): Token[] {
    for (const segment of scanSql(text, this.dialect)) {
      this.segmentTokens(text, segment, out);
    }
    return out;
  }

  /**
   * The tokens one segment produces. Anything the scan could not place with
   * certainty is refused: an unterminated string, name, comment or body, a
   * backslash whose meaning depends on a server setting where it decides
   * where a string ends, and a MySQL executable comment, which MySQL and
   * MariaDB run while every other reader skips it.
   */
  private segmentTokens(text: string, segment: SqlSegment, out: Token[]): void {
    switch (segment.kind) {
      case "code":
        this.codeTokens(text.slice(segment.start, segment.end), out);
        return;
      case "line-comment":
        return;
      case "block-comment":
        this.assertSkippableComment(segment);
        return;
      case "string":
        out.push(this.stringToken(segment));
        return;
      case "quoted-name":
        out.push(this.quotedNameToken(segment));
        return;
      case "dollar-body":
        this.dollarBodyTokens(text, segment, out);
        return;
    }
  }

  /**
   * A block comment produces no token, and is refused when it is not one a
   * database skips: MySQL's executable comment, or one that never closes.
   */
  private assertSkippableComment(
    segment: Extract<SqlSegment, { kind: "block-comment" }>
  ): void {
    if (segment.executable) {
      this.refuse(
        "a MySQL executable comment (/*! ... */) runs text this guard reads as a comment"
      );
    }
    if (segment.unterminated) this.refuse("unterminated block comment");
  }

  /**
   * A string literal's token, refused when where it ends is not certain: it
   * never closes, or a backslash before a quote inside it ends it in a place
   * a server setting decides.
   */
  private stringToken(segment: Extract<SqlSegment, { kind: "string" }>): Token {
    if (segment.unterminated) {
      this.refuse(
        segment.quote === "'"
          ? "unterminated string"
          : "unterminated quoted name"
      );
    }
    if (segment.ambiguousBackslash) {
      this.refuse(
        "a backslash before a quote ends the string in a place that depends on server settings"
      );
    }
    return {
      kind: "string",
      asName: this.stringReadsAsName(segment.quote)
        ? segment.content
        : undefined,
    };
  }

  /**
   * Whether the dialect also takes a string in these quotes as a name:
   * SQLite takes a `'...'` string as a name wherever one is expected, and
   * MySQL's ANSI_QUOTES mode reads `"..."` as one.
   */
  private stringReadsAsName(quote: "'" | '"'): boolean {
    return (
      (this.dialect === "sqlite" && quote === "'") ||
      (this.dialect === "mysql" && quote === '"')
    );
  }

  /** A quoted name's token, refused when the name never closes. */
  private quotedNameToken(
    segment: Extract<SqlSegment, { kind: "quoted-name" }>
  ): Token {
    if (segment.unterminated) {
      this.refuse(
        segment.bracketed
          ? "unterminated bracketed name"
          : "unterminated quoted name"
      );
    }
    return segment.unicodeEscaped
      ? { kind: "escaped-name" }
      : { kind: "name", name: segment.content };
  }

  /**
   * A dollar-quoted body, read as code and bracketed by `end` tokens: its
   * contents are a statement list of their own, so a drop inside a `DO`
   * block or a function body is read like any other, and a drop's target
   * list cannot run past the body's edge.
   */
  private dollarBodyTokens(
    text: string,
    segment: Extract<SqlSegment, { kind: "dollar-body" }>,
    out: Token[]
  ): void {
    if (segment.unterminated) {
      this.refuse("unterminated dollar-quoted body");
    }
    out.push({ kind: "end", body: "open" });
    this.tokens(text.slice(segment.bodyStart, segment.bodyEnd), out);
    out.push({ kind: "end", body: "close" });
  }

  /** Words, punctuation and statement ends in a stretch of code. */
  private codeTokens(code: string, out: Token[]): void {
    let i = 0;
    while (i < code.length) {
      if (/\s/.test(code[i])) {
        i += 1;
        continue;
      }
      if (code[i] === ";") {
        out.push({ kind: "end" });
        i += 1;
        continue;
      }
      WORD.lastIndex = i;
      const word = WORD.exec(code)?.[0];
      if (word === undefined) {
        out.push({ kind: "punct", char: code[i] });
        i += 1;
        continue;
      }
      out.push({ kind: "word", upper: word.toUpperCase(), text: word });
      i += word.length;
    }
  }
}

/**
 * Words after an ALTER TABLE clause's DROP that drop something other than a
 * column.
 */
const NOT_COLUMN_DROPS = new Set([
  "CONSTRAINT",
  "INDEX",
  "KEY",
  "FOREIGN",
  "PRIMARY",
  "CHECK",
  "PARTITION",
]);

/**
 * The words before `PARTITION` in an ALTER TABLE clause that empty the table,
 * replace its rows or change which partitions it has: PostgreSQL's `ATTACH`
 * and `DETACH`, MySQL's `DROP`, `TRUNCATE`, `EXCHANGE`, `DISCARD` and
 * `IMPORT`. Those that reorganise rows without losing them are not here.
 */
/**
 * What an `ALTER` clause names when it alters something other than a column:
 * a constraint, an index, a key, a check or a partition, the first word after
 * `ALTER` in those spellings.
 */
const NOT_COLUMN_ALTERS = new Set([
  "CONSTRAINT",
  "INDEX",
  "KEY",
  "CHECK",
  "PRIMARY",
  "FOREIGN",
  "PARTITION",
]);

/** The element an `ALTER <word>` clause changes in place, by its word. */
/** The clause words an ALTER TABLE this reader models can start with. */
const MODELLED_CLAUSE_WORDS = new Set([
  "ADD",
  "DROP",
  "RENAME",
  "ALTER",
  "CHANGE",
  "MODIFY",
  "VALIDATE",
  "ENGINE",
  "ATTACH",
  "DETACH",
]);

/**
 * The words after ADD that name the kind of element added: a column, a
 * constraint, an index, a key or a partition. MariaDB's `IF NOT EXISTS`
 * may follow ADD directly, and `NOT` starts a `NOT NULL` constraint. A bare word after ADD that is none of these is
 * not read as a column (`isModelledClauseAt`).
 */
const ADDED_ELEMENT_WORDS = new Set([
  "COLUMN",
  "CONSTRAINT",
  "INDEX",
  "KEY",
  "UNIQUE",
  "PRIMARY",
  "FOREIGN",
  "CHECK",
  "EXCLUDE",
  "FULLTEXT",
  "SPATIAL",
  "VECTOR",
  "PARTITION",
  "IF",
  "NOT",
]);

/**
 * MySQL table options that change none of a table's columns, indexes or
 * constraints (`isTableOptionsAt`), each taking one value.
 */
const TABLE_OPTION_WORDS = new Set([
  "COMMENT",
  "AUTO_INCREMENT",
  "ALGORITHM",
  "LOCK",
  "ROW_FORMAT",
  "CHARSET",
  "COLLATE",
]);

/** The words a constraint starts with when its name was omitted. */
const ANONYMOUS_CONSTRAINT_WORDS = new Set([
  "CHECK",
  "FOREIGN",
  "PRIMARY",
  "UNIQUE",
  "EXCLUDE",
]);

/** The element kind an added constraint is, from the word after its name. */
function addedConstraintKind(word: string | undefined): TakenElementKind {
  switch (word) {
    case "CHECK":
      return "check";
    case "FOREIGN":
      return "fk";
    case "PRIMARY":
    case "UNIQUE":
    case "EXCLUDE":
      return "index";
    default:
      return "constraint";
  }
}

/** The act a refusal of an unmodelled form takes. */
const UNMODELLED_ACT = "use a form the guard cannot read";

const ALTERED_ELEMENT_KINDS = new Map<string, TakenElementKind>([
  ["CONSTRAINT", "constraint"],
  ["CHECK", "check"],
  ["INDEX", "index"],
  ["KEY", "index"],
]);

/**
 * The word after a column's name in an in-place change: `TYPE`, `SET`,
 * `DROP`, `ADD` or `RESTART`, the forms `ALTER COLUMN` takes. A name followed
 * by anything else is not changed in place.
 */
const IN_PLACE_CHANGE_WORDS = new Set([
  "TYPE",
  "SET",
  "DROP",
  "ADD",
  "RESET",
  "RESTART",
]);

const PARTITION_CHANGES = new Set([
  "ATTACH",
  "DETACH",
  "DROP",
  "TRUNCATE",
  "EXCHANGE",
  "DISCARD",
  "IMPORT",
]);

/**
 * PostgreSQL's ALTER forms whose `RENAME [COLUMN]` or `RENAME ATTRIBUTE`
 * renames a plain table's column too, by their first word and the second
 * word the form needs, if any.
 */
const RELATION_KIND_WORDS: ReadonlyMap<string, { next?: string }> = new Map([
  ["VIEW", {}],
  ["TYPE", {}],
  ["MATERIALIZED", { next: "VIEW" }],
  ["FOREIGN", { next: "TABLE" }],
]);

/** The kinds of object PostgreSQL names with two words, by the first. */
const TWO_WORD_KINDS = new Set(["MATERIALIZED", "FOREIGN"]);

/**
 * PostgreSQL relation kinds other than tables and indexes that an ALTER can
 * rename or move to another schema (`readRelationMove`), by the first word.
 */
const MOVABLE_RELATION_KINDS = new Set([
  "VIEW",
  "MATERIALIZED",
  "SEQUENCE",
  "FOREIGN",
  "TYPE",
]);

/** What may stand between `CREATE OR REPLACE` and `INDEX` in MariaDB. */
const INDEX_KIND_WORDS = new Set(["UNIQUE", "FULLTEXT", "SPATIAL", "VECTOR"]);

/** What may stand between CREATE and TABLE in a table's creation. */
const CREATE_TABLE_MODIFIERS = new Set([
  "TEMPORARY",
  "TEMP",
  "GLOBAL",
  "LOCAL",
  "UNLOGGED",
]);

/** What PostgreSQL's CREATE makes when its body follows `AS`. */
const ROUTINE_DEFINITIONS = new Set(["FUNCTION", "PROCEDURE"]);

/** Statement keywords that drop tables without naming them. */
const NAMELESS_DROPS = new Set(["SCHEMA", "DATABASE", "OWNED"]);

/**
 * Whether a name with these qualifiers before it is local (`TableRef`): it
 * has none, or it is SQLite's `temp.`, whose table an unqualified name
 * reaches before the main one.
 */
function qualifierIsLocal(
  qualifiers: readonly string[],
  dialect: SupportedDialect
): boolean {
  if (qualifiers.length === 0) return true;
  return dialect === "sqlite" && qualifiers.join(".") === "temp";
}

/**
 * Names that may change which table an unqualified name reaches wherever
 * they appear, bare or quoted: PostgreSQL's `search_path` setting, which a
 * `SET`, a function's `SET` clause or `set_config()` changes.
 */
const NAME_RESOLUTION_WORDS = new Set(["SEARCH_PATH", "SET_CONFIG"]);

/**
 * Statements that may change which table an unqualified name reaches, by the
 * word that opens them. PostgreSQL's `SET`, `RESET` and `DISCARD` may change
 * the search path or the role whose schema (`$user`) it starts with, or drop
 * the temporary tables that shadowed others; which setting a `SET` changes is
 * not read, since any of them may. Inside a dollar-quoted body they are read
 * wherever they stand, because a PL/pgSQL statement may follow `BEGIN`,
 * `THEN` or a label rather than a `;`. MySQL's `USE` changes the default
 * database.
 */
const NAME_RESOLUTION_STATEMENTS: Partial<
  Record<SupportedDialect, ReadonlySet<string>>
> = {
  postgresql: new Set(["SET", "RESET", "DISCARD"]),
  mysql: new Set(["USE"]),
};

/**
 * Words that, before `SCHEMA`, make or rename a PostgreSQL schema — which
 * may then be the `$user` schema the search path starts with.
 */
const SCHEMA_DEFINITIONS = new Set(["CREATE", "ALTER"]);

/** A name as a token spells it, before any case folding. */
function writtenName(token: Token | undefined): string | undefined {
  switch (token?.kind) {
    case "word":
      return token.text;
    case "name":
      return token.name;
    case "string":
      return token.asName;
    default:
      return undefined;
  }
}

/**
 * Whether `token` may change which table an unqualified name reaches.
 * `opensStatement` says whether it stands where a statement may start (first
 * in its statement, or anywhere in a dollar-quoted body); `next` is the word
 * after it.
 */
function changesNameResolution(
  token: Token,
  opensStatement: boolean,
  next: string | undefined,
  dialect: SupportedDialect
): boolean {
  if (token.kind === "name") {
    return NAME_RESOLUTION_WORDS.has(token.name.toUpperCase());
  }
  if (token.kind !== "word") return false;
  return (
    NAME_RESOLUTION_WORDS.has(token.upper) ||
    definesPostgresSchema(token.upper, next, dialect) ||
    (opensStatement &&
      (NAME_RESOLUTION_STATEMENTS[dialect]?.has(token.upper) ?? false))
  );
}

/** PostgreSQL's `CREATE SCHEMA` or `ALTER SCHEMA`, from its first word. */
function definesPostgresSchema(
  word: string,
  next: string | undefined,
  dialect: SupportedDialect
): boolean {
  return (
    dialect === "postgresql" &&
    next === "SCHEMA" &&
    SCHEMA_DEFINITIONS.has(word)
  );
}

/**
 * The longest name PostgreSQL stores, in bytes (`NAMEDATALEN - 1`). A longer
 * name is cut to its whole characters within it, in every statement, so
 * `DROP TABLE` of a name 70 bytes long drops the table its first 63 bytes
 * name.
 */
const POSTGRES_NAME_BYTES = 63;

const utf8 = new TextEncoder();

/** `name` cut as PostgreSQL cuts an over-long name: to whole characters. */
function truncatedAsPostgres(name: string): string {
  if (utf8.encode(name).length <= POSTGRES_NAME_BYTES) return name;
  let bytes = 0;
  let kept = "";
  for (const char of name) {
    bytes += utf8.encode(char).length;
    if (bytes > POSTGRES_NAME_BYTES) break;
    kept += char;
  }
  return kept;
}

/**
 * The key a name is compared under: lower-cased, and on PostgreSQL first cut
 * to the length it stores, so a name written longer is matched to the table,
 * column or element it reaches. Applied to the names a statement writes and
 * to the names the owner rows record alike.
 */
function storedNameKey(name: string, dialect: SupportedDialect): string {
  return (
    dialect === "postgresql" ? truncatedAsPostgres(name) : name
  ).toLowerCase();
}

/** PostgreSQL's folding of an unquoted name, which lowers ASCII only. */
function foldAscii(name: string): string {
  return name.replace(/[A-Z]+/g, upper => upper.toLowerCase());
}

/**
 * Whether the name `token` spells is, lower-cased, exactly the name the
 * database stores — so a creation under it can be matched against a later
 * statement naming it. A quoted name, and on MySQL and SQLite an unquoted one
 * too, is stored as written, and `"Auth__Identities"` is another table than
 * `auth__identities` wherever case is significant; PostgreSQL lowers an
 * unquoted name's ASCII letters and nothing else.
 */
function spelledAsStored(
  token: Token | undefined,
  dialect: SupportedDialect
): boolean {
  const written = writtenName(token);
  if (written === undefined) return false;
  const stored =
    token?.kind === "word" && dialect === "postgresql"
      ? foldAscii(written)
      : written;
  return stored === written.toLowerCase();
}

/** What MySQL's `RENAME COLUMN|INDEX|KEY` renames instead of the table. */
const MYSQL_NON_TABLE_RENAMES = new Set(["COLUMN", "INDEX", "KEY"]);

/**
 * Where the new name is in a MySQL table rename other than `RENAME TO`,
 * given the RENAME at `at` and the word after it: `RENAME AS <new>` and
 * `RENAME <new>`. Undefined for a column, index or key rename.
 */
function mysqlRenameTargetAt(
  at: number,
  next: string | undefined
): number | undefined {
  if (next === "AS") return at + 2;
  if (next !== undefined && MYSQL_NON_TABLE_RENAMES.has(next)) {
    return undefined;
  }
  return at + 1;
}

/**
 * A table as one statement names it: the table's name, lower-cased, and
 * whether that name reaches the table an unqualified name reaches (`local`).
 *
 * Only a local name can be matched against what the same list created. A
 * name with a schema or database before it may reach a different table of
 * the same name: `CREATE TABLE scratch.users` creates nothing a later
 * `DROP TABLE users` drops, and `DROP TABLE public.users` after an
 * unqualified `CREATE TABLE users` may drop the table that create did not
 * make. SQLite's `temp.` is the one qualifier that stays local: a temporary
 * table shadows the main one, so an unqualified name reaches it first. Nor
 * is a name whose lower-cased form may not be the one the database stores
 * (`spelledAsStored`): `"Users"` may be another table than `users`.
 */
interface TableRef {
  name: string;
  local: boolean;
}

/** A column a statement list drops or renames away, and its table. */
export interface TakenColumn {
  table: string;
  column: string;
  /** The order the change was read in, and whether its name is spelled as stored. */
  seq?: number;
  exact?: boolean;
}

/**
 * What kind of named table element a statement takes away. `constraint` is
 * PostgreSQL's and MySQL's `DROP CONSTRAINT` / `RENAME CONSTRAINT`, which
 * names a foreign key, a check or a unique constraint alike, and MySQL's
 * nameless `DROP PRIMARY KEY`.
 */
export type TakenElementKind = "index" | "fk" | "check" | "constraint";

/**
 * An index or constraint a statement list drops or renames away. `table` is
 * undefined when the statement names only the element — PostgreSQL's and
 * SQLite's `DROP INDEX`, PostgreSQL's `ALTER INDEX ... RENAME` — and the
 * table is then the one the live database has it on (`readLiveIndexTables`).
 */
export interface TakenElement {
  table: string | undefined;
  name: string;
  kind: TakenElementKind;
  /** The order the change was read in, and whether its name is spelled as stored. */
  seq?: number;
  exact?: boolean;
}

/**
 * Reads a statement list's tokens for the tables it drops.
 *
 * One reader per statement list, because table renames carry across
 * statements: after `ALTER TABLE app_notes RENAME TO zz`, a later
 * `DROP TABLE zz` drops `app_notes`, and judging it by the name `zz`, which
 * no owner row claims, would approve it.
 */
class DropReader {
  /** Current name → the name the table had before this list renamed it. */
  private readonly renamedFrom = new Map<string, string>();
  readonly dropped: string[] = [];
  /**
   * Tables this list renames or moves to another schema, by every name the
   * table is known by in the list: the name it had before the list and the
   * name the rename was written against, when they differ.
   */
  readonly renamed: string[] = [];
  /**
   * Columns this list drops or renames away, with the table named by the
   * name it had before the list renamed it.
   */
  readonly columns: TakenColumn[] = [];
  /**
   * Columns this list changes in place without renaming or dropping them: a
   * type, a nullability, a default, or a MySQL redefinition under the same
   * name. Judged as a drop or rename is, except that the act is a change.
   */
  readonly alteredColumns: TakenColumn[] = [];
  /** Indexes and constraints this list changes in place (`changeElement`). */
  readonly alteredElements: TakenElement[] = [];
  /**
   * Tables a statement alters in a form this reader does not model. The guard
   * fails closed on them: a foreign one is refused, naming it.
   */
  readonly unmodelled: string[] = [];
  /**
   * Tables a statement alters in a form this reader does not model that may
   * change their columns, indexes or constraints. Each other owner's element
   * recorded on one is judged too, whoever holds the table.
   */
  readonly unreadOnElements: string[] = [];
  /** Storage or unmodelled changes through a schema-qualified name. */
  readonly qualifiedTargets: string[] = [];
  private sequence = 0;
  /** Every table an ALTER TABLE names, which may be an index's name. */
  readonly alterTargets: string[] = [];
  /** Columns this list adds to a table, which it may then change. */
  readonly addedColumns: TakenColumn[] = [];
  /** Constraints this list adds to a table, which it may then change. */
  readonly addedElements: TakenElement[] = [];
  /**
   * Indexes and constraints this list drops or renames away, with the table
   * named by the name it had before the list renamed it.
   */
  readonly elements: TakenElement[] = [];
  /**
   * Tables this list rebuilds in complete blocks that keep them, with the
   * table named by the name it had before the list renamed it, and the
   * indexes and constraints each block puts back on it.
   */
  readonly rebuilt: RebuiltTable[] = [];
  /**
   * The names PostgreSQL's `ALTER INDEX ... RENAME TO` renames, by the name
   * each had before the list renamed it. PostgreSQL renames a TABLE through
   * `ALTER INDEX` too, so each is judged as a possible table rename where no
   * live index has the name (`assertNoForeignDrops`).
   */
  readonly relationRenames: string[] = [];
  /**
   * Tables this list empties or whose partitions it changes, without dropping
   * them, and what it does to each (`TableChange`).
   */
  readonly changed: ChangedTable[] = [];
  /**
   * Tables this list itself created, by their current name, while it has not
   * dropped them again. A drop or rename of one of these takes nothing from
   * anybody: the table did not exist before the list ran.
   */
  private readonly created = new Set<string>();
  /**
   * Every local name the list creates a table under, credited or not — by a
   * CREATE, or by renaming a table it created: the names whose existence
   * before the list runs decides their credit (`tablesCreatedBy`).
   */
  readonly creating = new Set<string>();
  /**
   * Whether the list holds a statement that may change which table an
   * unqualified name reaches (`changesNameResolution`). Once it does, no
   * creation is credited anywhere in the list (`readStatements`).
   */
  resolutionMayChange = false;
  /**
   * The tables a PostgreSQL statement acts on together with every table that
   * inherits from them or is a partition of them, by the name each had before
   * the list renamed it, and what it does to them (`reach`). The text names
   * none of those descendants; the guard judges each from the live catalog
   * (`LiveTables.descendants`).
   */
  readonly reaching: Array<{ table: string; act: DescendantAct }> = [];
  /**
   * Names a later statement looks up in the live database, as an index named
   * without its table or a PostgreSQL ALTER TABLE target, after an earlier
   * statement of the list dropped, renamed or moved a table or index of that
   * name (`lookUp`). The lookup was made once, before the list ran, so what
   * the name reaches by then is not known.
   */
  readonly lookupsAfterVacating: string[] = [];
  /**
   * Types a PostgreSQL `ALTER TYPE ... CASCADE` changes together with every
   * table typed by them, which the text does not name.
   */
  readonly typesCascaded: string[] = [];
  /**
   * Relation names an earlier statement dropped, renamed or moved away and
   * none has filled again since, with the statement that did it.
   */
  private readonly vacated = new Map<string, number>();
  /** Which statement of the list is being read: each `end` starts another. */
  private statementIndex = 0;

  constructor(
    readonly dialect: SupportedDialect,
    /**
     * The tables that exist before the list runs, among those it creates.
     * Undefined when that is not known, and then no creation is credited.
     */
    private readonly liveTables: ReadonlySet<string> | undefined,
    /**
     * Names an earlier list of the same run vacated (`LiveTables.vacated`),
     * vacated before this list's first statement.
     */
    vacatedBefore: Iterable<string> = []
  ) {
    for (const name of vacatedBefore) this.vacated.set(name, 0);
  }

  /** The relation names this list leaves vacated, earlier lists' included. */
  get stillVacated(): ReadonlySet<string> {
    return new Set(this.vacated.keys());
  }

  read(statement: string): void {
    this.nextStatement();
    const tokens = new Lexer(this.dialect, statement).tokens(statement);
    new StatementWalk(this, tokens, statement).run();
  }

  /**
   * Starts the next statement: a new entry of the list, or one that follows
   * an `end` inside it, such as a statement of a routine body.
   */
  nextStatement(): void {
    this.statementIndex += 1;
  }

  /**
   * Records a PostgreSQL statement that acts on `table` and on every table
   * descending from it (`reaching`). Other dialects have no inheritance.
   */
  reach(table: TableRef, act: DescendantAct): void {
    if (!this.isPostgres) return;
    this.reaching.push({
      table: this.renamedFrom.get(table.name) ?? table.name,
      act,
    });
  }

  /**
   * A relation name that a statement drops, renames or moves away: a later
   * lookup of it may reach a relation it shadowed (`lookupsAfterVacating`).
   */
  vacate(name: string): void {
    this.vacated.set(name, this.statementIndex);
  }

  /**
   * Each table this list renamed, by the name it ends the list under, with
   * the name it had before the list.
   */
  get renames(): ReadonlyMap<string, string> {
    return this.renamedFrom;
  }

  /** A name a CREATE or a rename fills again: it reaches what the list put there. */
  private occupy(table: TableRef): void {
    if (table.local) this.vacated.delete(table.name);
  }

  /**
   * A name looked up in the live database before the list ran. Refused when
   * an earlier statement vacated it; one statement's own drop or rename does
   * not count against its own lookup, which PostgreSQL resolves first.
   */
  private lookUp(name: string): void {
    const at = this.vacated.get(name);
    if (at !== undefined && at < this.statementIndex) {
      this.lookupsAfterVacating.push(name);
    }
  }

  /**
   * Records a table this list creates, credited to it only under a local name
   * no live table had before the list ran. A CREATE naming a table that
   * already exists cannot have made that table, so whatever it did make — in
   * another schema, under another case, on another search path — a later
   * statement naming the existing table reaches the existing table.
   */
  create(table: TableRef): void {
    this.occupy(table);
    if (!table.local) return;
    this.creating.add(table.name);
    if (this.absentBefore(table)) this.created.add(table.name);
  }

  /**
   * Whether no table stood under `table`'s local name before the list ran,
   * as the live reading shows — false when that is not known.
   */
  private absentBefore(table: TableRef): boolean {
    return (
      table.local &&
      this.liveTables !== undefined &&
      !this.liveTables.has(table.name)
    );
  }

  /**
   * Records a CREATE that replaces any table of the name: the drop of the
   * table that stood there before the list ran — judged like any drop — and
   * then the creation. Where the live reading shows none stood there, the
   * only table it can replace is one this list put there: a table it
   * created, which is its own, or one it renamed there, a rename already
   * judged as taking that table.
   */
  replace(table: TableRef): void {
    if (!this.absentBefore(table)) this.drop(table);
    this.create(table);
  }

  /**
   * Whether `table` is one this list created, which it stops being: it is
   * dropped, renamed or moved.
   */
  private takeCreated(table: TableRef): boolean {
    return table.local && this.created.delete(table.name);
  }

  /** Records a dropped name, and the original name if a rename made it. */
  drop(table: TableRef): void {
    this.vacate(table.name);
    if (this.takeCreated(table)) return;
    const original = this.renamedFrom.get(table.name);
    if (original !== undefined) this.dropped.push(original);
    this.dropped.push(table.name);
  }

  rename(from: TableRef, to: TableRef): void {
    this.vacate(from.name);
    if (this.takeCreated(from)) {
      this.create(to);
      return;
    }
    const original = this.relocate(from);
    this.renamedFrom.delete(from.name);
    if (to.name === original) this.renamedFrom.delete(to.name);
    else this.renamedFrom.set(to.name, original);
    this.occupy(to);
  }

  /**
   * Records that the table currently called `table` leaves that name — a
   * rename, or a move to another schema — and returns the name it had before
   * this list.
   */
  relocate(table: TableRef): string {
    const { name } = table;
    this.vacate(name);
    if (this.takeCreated(table)) return name;
    const original = this.renamedFrom.get(name) ?? name;
    this.renamed.push(original);
    if (original !== name) this.renamed.push(name);
    return original;
  }

  /**
   * Records a column of `table` dropped or renamed away. A column of a table
   * this list created is its own, and is not recorded.
   */
  takeColumn(table: TableRef, column: string): void {
    if (table.local && this.created.has(table.name)) return;
    this.columns.push({
      table: this.renamedFrom.get(table.name) ?? table.name,
      column,
    });
  }

  /**
   * Records a table an ALTER TABLE names, which the live database is asked
   * about as a possible index's name (`readLiveIndexTables`).
   */
  targetAltered(table: string): void {
    this.lookUp(table);
    this.alterTargets.push(table);
  }

  /** Records a storage or unmodelled change through a qualified name. */
  leaveQualifiedTarget(table: string): void {
    this.qualifiedTargets.push(table);
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  /**
   * Records a column this list adds to a table. Only an addition credited
   * for a later change is recorded: its name is spelled as stored, and its
   * table is one the list reaches by its own name. Any other addition is
   * left out, so a later change to that column is judged as its owner's.
   */
  addColumn(table: TableRef, column: string, exact: boolean): void {
    if (table.local && this.created.has(table.name)) return;
    if (!exact || !table.local) return;
    this.addedColumns.push({
      table: this.renamedFrom.get(table.name) ?? table.name,
      column,
      seq: this.nextSequence(),
      exact,
    });
  }

  /** Records a constraint this list adds to a table, under the same rule. */
  addElement(
    table: TableRef,
    name: string,
    kind: TakenElementKind,
    exact: boolean
  ): void {
    if (table.local && this.created.has(table.name)) return;
    if (!exact || !table.local) return;
    this.addedElements.push({
      table: this.renamedFrom.get(table.name) ?? table.name,
      name,
      kind,
      seq: this.nextSequence(),
      exact,
    });
  }

  /** Records a table an ALTER alters in a form this reader does not model. */
  leaveUnmodelled(table: string): void {
    this.unmodelled.push(table);
  }

  /**
   * Records a table an ALTER alters in a form this reader does not model
   * that may change its columns, indexes or constraints, by the name it had
   * before this list renamed it (`unreadOnElements`).
   */
  leaveUnreadOnElements(table: TableRef): void {
    this.unreadOnElements.push(this.renamedFrom.get(table.name) ?? table.name);
  }

  /** Records a column an ALTER changes in place (`alteredColumns`). */
  changeColumn(table: TableRef, column: string, exact: boolean): void {
    if (table.local && this.created.has(table.name)) return;
    this.alteredColumns.push({
      table: this.renamedFrom.get(table.name) ?? table.name,
      column,
      seq: this.nextSequence(),
      exact,
    });
  }

  /**
   * Records an index or constraint this list changes in place: its deferral,
   * its enforcement, its visibility or its tablespace. One on a table this
   * list created is its own, and is not recorded.
   */
  changeElement(
    table: TableRef | undefined,
    name: string,
    kind: TakenElementKind,
    exact: boolean
  ): void {
    // An index named alone is found through the live database.
    if (table === undefined) this.lookUp(name);
    if (table?.local && this.created.has(table.name)) return;
    this.alteredElements.push({
      table:
        table === undefined
          ? undefined
          : (this.renamedFrom.get(table.name) ?? table.name),
      name,
      kind,
      seq: this.nextSequence(),
      exact,
    });
  }

  /**
   * Records an index or constraint dropped or renamed away. One on a table
   * this list created is its own, and is not recorded.
   */
  takeElement(
    table: TableRef | undefined,
    name: string,
    kind: TakenElementKind
  ): void {
    // An index named alone is found through the live database, and once it
    // is dropped or renamed its name may reach a relation it shadowed.
    if (table === undefined) {
      this.lookUp(name);
      this.vacate(name);
    }
    if (table?.local && this.created.has(table.name)) return;
    this.elements.push({
      table:
        table === undefined
          ? undefined
          : (this.renamedFrom.get(table.name) ?? table.name),
      name,
      kind,
    });
  }

  /**
   * Records a table this list empties or changes the partitions of, by every
   * name it is known by in the list, as `drop` records one. A table this
   * list created is its own, and is not recorded; it stays its own.
   */
  changeTable(table: TableRef, act: TableChange): void {
    if (table.local && this.created.has(table.name)) return;
    const original = this.renamedFrom.get(table.name);
    if (original !== undefined) this.changed.push({ table: original, act });
    this.changed.push({ table: table.name, act });
  }

  /** Records a name an `ALTER INDEX ... RENAME` renames (`relationRenames`). */
  renameRelation(name: string): void {
    this.relationRenames.push(this.renamedFrom.get(name) ?? name);
  }

  /**
   * Records a table a complete rebuild block keeps, and what the block puts
   * back on it. A table this list created is its own, and is not recorded.
   */
  keepTable(table: string, recreated: Recreated): void {
    if (this.created.has(table)) return;
    this.rebuilt.push({
      table: this.renamedFrom.get(table) ?? table,
      recreated,
    });
  }

  get isMysql(): boolean {
    return this.dialect === "mysql";
  }

  get isPostgres(): boolean {
    return this.dialect === "postgresql";
  }
}

/**
 * What a statement does to a table it neither drops nor renames, as a refusal
 * names it: empties it (`TRUNCATE`, a partition's `DROP` or `TRUNCATE`),
 * changes which partitions it has, or makes it a partition of another table,
 * which a later drop of that table takes with it.
 */
type TableChange =
  | "change the storage of"
  | "truncate"
  | "change the partitions of"
  | "attach as a partition"
  | "detach as a partition"
  | "exchange a partition with";

/**
 * What a PostgreSQL statement does to the descendants of a table it acts on
 * (`DropReader.reach`): an ALTER TABLE or TRUNCATE without `ONLY` alters or
 * empties every table inheriting from the one it names, and every partition
 * of it; a DROP TABLE drops its partitions, and with CASCADE its inheriting
 * tables.
 */
type DescendantAct = "alter" | "truncate" | "drop";

/** A table a statement list empties or changes the partitions of. */
interface ChangedTable {
  table: string;
  act: TableChange;
}

/** One walk over one statement's tokens. */
class StatementWalk {
  /**
   * State of the statement the walk is inside, reset at every `end`: its
   * first word, whether TRIGGER has appeared in it, whether it is inside
   * a GRANT/REVOKE privilege list, and whether it is an ALTER TABLE, whose
   * DROP clauses drop parts of the table.
   */
  private firstWord: string | undefined;
  private sawTrigger = false;
  private inPrivileges = false;
  private inAlterTable = false;
  /** How many dollar-quoted bodies the walk is inside. */
  private bodyDepth = 0;

  constructor(
    private readonly reader: DropReader,
    private readonly tokens: readonly Token[],
    private readonly statement: string
  ) {}

  private refuse(reason: string): never {
    throw new UnparsableDropTarget(this.statement, reason);
  }

  private word(at: number): string | undefined {
    const token = this.tokens[at];
    return token?.kind === "word" ? token.upper : undefined;
  }

  private punct(at: number): string | undefined {
    const token = this.tokens[at];
    return token?.kind === "punct" ? token.char : undefined;
  }

  private atStatementEnd(at: number): boolean {
    const token = this.tokens[at];
    return token === undefined || token.kind === "end";
  }

  run(): void {
    let k = 0;
    while (k < this.tokens.length) k = this.step(k);
  }

  /** Reads the token at `at`. Returns where to resume. */
  private step(at: number): number {
    const token = this.tokens[at];
    if (token.kind === "end") {
      this.endStatement(token);
      return at + 1;
    }
    const first = this.firstWord === undefined;
    this.noteResolutionChange(token, at, first);
    if (token.kind !== "word") return at + 1;
    if (first) this.firstWord = token.upper;
    this.trackStatementState(token.upper);
    return this.readKeyword(token.upper, at, first);
  }

  /** Resets the per-statement state, and follows a body's edges. */
  private endStatement(token: Extract<Token, { kind: "end" }>): void {
    this.firstWord = undefined;
    this.sawTrigger = false;
    this.inPrivileges = false;
    this.inAlterTable = false;
    this.reader.nextStatement();
    if (token.body === "open") this.bodyDepth += 1;
    else if (token.body === "close") this.bodyDepth -= 1;
  }

  /**
   * Marks the list as one that may change which table an unqualified name
   * reaches, when the token at `at` may (`changesNameResolution`).
   */
  private noteResolutionChange(token: Token, at: number, first: boolean): void {
    const opensStatement = first || this.bodyDepth > 0;
    if (
      changesNameResolution(
        token,
        opensStatement,
        this.word(at + 1),
        this.reader.dialect
      )
    ) {
      this.reader.resolutionMayChange = true;
    }
  }

  /** Updates the per-statement state a word changes. */
  private trackStatementState(word: string): void {
    switch (word) {
      case "TRIGGER":
        this.sawTrigger = true;
        break;
      case "GRANT":
      case "REVOKE":
        this.inPrivileges = true;
        break;
      case "ON":
        this.inPrivileges = false;
        break;
    }
  }

  /**
   * Reads the statement a keyword starts or refuses it. Returns where to
   * resume: past a DROP's or a RENAME TABLE's names, otherwise the next token.
   */
  private readKeyword(word: string, at: number, first: boolean): number {
    switch (word) {
      case "PREPARE":
        return this.refuse(
          "PREPARE builds a statement at run time, and a dynamically built statement cannot be judged"
        );
      case "EXECUTE":
        this.assertStaticExecute(at);
        break;
      case "DROP":
        return this.readDrop(at);
      case "RENAME":
        return this.readRenameStatement(at, first);
      case "TRUNCATE":
        return this.readTruncateStatement(at, first);
      case "DO":
        this.readDo(at, first);
        break;
    }
    this.readDefinition(word, at);
    return at + 1;
  }

  /**
   * An ALTER, for the tables and columns it renames or drops, or a CREATE,
   * for the table it creates. The tokens are not consumed.
   */
  private readDefinition(word: string, at: number): void {
    if (word === "ALTER") {
      if (this.alteredTableAt(at) !== undefined) this.inAlterTable = true;
      this.readAlterTableRenames(at);
      this.readAlterTableColumns(at);
      this.readAlterIndexRename(at);
      this.readAlterForeignTable(at);
      this.readRelationColumnRename(at);
      this.readTypeCascade(at);
      this.readRelationMove(at);
    } else if (word === "CREATE") {
      this.readCreateTable(at);
      this.readReplacedIndex(at);
      this.readPartitionOf(at);
      if (this.reader.isPostgres) this.assertDollarQuotedRoutine(at);
    }
  }

  /**
   * A TRUNCATE word: the statement of that name where it is one
   * (`opensTruncate`), otherwise nothing to read here. Returns where to
   * resume.
   */
  private readTruncateStatement(at: number, first: boolean): number {
    return this.opensTruncate(first) ? this.readTruncate(at) : at + 1;
  }

  /** A DO word: PostgreSQL's `DO` statement when it opens one. */
  private readDo(at: number, first: boolean): void {
    if (first && this.reader.isPostgres) this.assertDollarQuotedDo(at);
  }

  /**
   * Whether a TRUNCATE at this point is the statement of that name: it opens
   * its statement, or stands anywhere in a dollar-quoted body, where a
   * PL/pgSQL statement may follow `BEGIN` or `THEN` rather than a `;` — but
   * not as an ALTER TABLE's `TRUNCATE PARTITION` clause, a privilege in a
   * GRANT or REVOKE, or a trigger's event.
   */
  private opensTruncate(first: boolean): boolean {
    if (first) return true;
    return (
      this.bodyDepth > 0 &&
      !this.inAlterTable &&
      !this.inPrivileges &&
      !this.sawTrigger
    );
  }

  /**
   * `TRUNCATE [TABLE] [ONLY] t [*] [, ...]`, from the TRUNCATE keyword: every
   * table it empties, recorded as such. What may follow the list is read as
   * a DROP's tail is: PostgreSQL's identity option, then CASCADE or RESTRICT,
   * and nothing else. PostgreSQL's CASCADE also empties every table with a
   * foreign key to one of these, which the text does not name, so it is
   * refused. Returns where to resume.
   */
  private readTruncate(at: number): number {
    let k = this.readTruncatedTable(
      this.word(at + 1) === "TABLE" ? at + 2 : at + 1
    );
    while (this.punct(k) === ",") k = this.readTruncatedTable(k + 1);
    if (this.word(k + 1) === "IDENTITY") k += 2;
    if (this.reader.isPostgres && this.word(k) === "CASCADE") {
      this.refuse(
        "TRUNCATE ... CASCADE also empties every table with a foreign key to these, which may be another owner's; truncate those explicitly, without CASCADE"
      );
    }
    return this.dropTail(k);
  }

  /**
   * One table of a TRUNCATE's list, from `at`, past an optional `ONLY`,
   * recorded as emptied. Returns where its name, and any `*`, ends.
   */
  private readTruncatedTable(at: number): number {
    const only = this.word(at) === "ONLY";
    const table = this.qualifiedName(only ? at + 1 : at);
    if (table === undefined) {
      this.refuse("a TRUNCATE whose table names cannot be read");
    }
    this.reader.changeTable(table, "truncate");
    // Without ONLY, PostgreSQL empties every descendant of the table too.
    if (!only) this.reader.reach(table, "truncate");
    return this.pastDescendants(table.next);
  }

  /**
   * PostgreSQL's `DO [LANGUAGE lang] body` runs its body as code. A
   * dollar-quoted body is lexed as code and read like any other statement;
   * a body written as a string literal (`DO 'BEGIN DROP TABLE x; END'`) is
   * skipped as data by the lexer, so what it drops cannot be read and the
   * statement is refused. The lexer marks the start of a dollar-quoted body
   * with an `end` token, which is what must follow the keyword and its
   * optional LANGUAGE clause.
   */
  private assertDollarQuotedDo(at: number): void {
    const bodyAt = this.word(at + 1) === "LANGUAGE" ? at + 3 : at + 1;
    if (this.tokens[bodyAt]?.kind === "end") return;
    this.refuse(
      "DO runs a body written as a string, which this guard reads as data rather than code"
    );
  }

  /**
   * PostgreSQL's `CREATE [OR REPLACE] FUNCTION|PROCEDURE`, refused when its
   * body is a quoted string, for the reason a `DO` is: the lexer skips the
   * string as data, so a drop — or a `set_config('search_path', ...)` — in a
   * body that a later `SELECT f()` or `CALL p()` runs would go unread. The
   * body follows `AS`; a dollar-quoted one is read as code, and a SQL-standard
   * `RETURN` or `BEGIN ATOMIC` body is code already. Read wherever a CREATE
   * stands, since inside a `DO` block one may follow `BEGIN`.
   */
  private assertDollarQuotedRoutine(at: number): void {
    const kindAt =
      this.word(at + 1) === "OR" && this.word(at + 2) === "REPLACE"
        ? at + 3
        : at + 1;
    if (!ROUTINE_DEFINITIONS.has(this.word(kindAt) ?? "")) return;
    for (let k = kindAt + 1; !this.atStatementEnd(k); k += 1) {
      if (this.word(k) === "AS" && this.isStringConstantAt(k + 1)) {
        this.refuse(
          "a function or procedure body written as a quoted string is read as data rather than code; write it dollar-quoted ($$ ... $$)"
        );
      }
    }
  }

  /**
   * Whether a quoted string constant starts at `at`: `'...'` or `E'...'`,
   * which the lexer makes one string token, or `U&'...'`, which it reads as
   * the word `U`, an `&` and a string.
   */
  private isStringConstantAt(at: number): boolean {
    if (this.tokens[at]?.kind === "string") return true;
    return this.word(at) === "U" && this.punct(at + 1) === "&";
  }

  /**
   * A RENAME word: MySQL's `RENAME TABLE` statement when it opens one,
   * otherwise nothing to read here.
   */
  private readRenameStatement(at: number, first: boolean): number {
    if (first && this.reader.isMysql && this.word(at + 1) === "TABLE") {
      return this.readRenameTable(at + 2);
    }
    return at + 1;
  }

  /**
   * EXECUTE runs SQL assembled at run time — PL/pgSQL's `EXECUTE 'DROP ...'`,
   * MySQL's `EXECUTE stmt` — whose text this reader never sees, so it is
   * refused. Two spellings run nothing dynamic and are allowed:
   *
   * - A trigger's `EXECUTE FUNCTION f(...)` / `EXECUTE PROCEDURE f(...)`,
   *   only inside a CREATE ... TRIGGER statement and only in that shape. In
   *   PL/pgSQL `function` is not reserved, so a variable of that name can
   *   hold SQL: `EXECUTE function;` elsewhere is dynamic.
   * - The EXECUTE privilege in a GRANT or REVOKE list, followed by a comma
   *   or ON.
   */
  private assertStaticExecute(at: number): void {
    if (this.isExecutePrivilege(at) || this.isTriggerExecute(at)) return;
    this.refuse(
      "EXECUTE runs a statement built at run time, and a dynamically built statement cannot be judged"
    );
  }

  /** The EXECUTE privilege in a GRANT or REVOKE list. */
  private isExecutePrivilege(at: number): boolean {
    return (
      this.inPrivileges &&
      (this.punct(at + 1) === "," || this.word(at + 1) === "ON")
    );
  }

  /**
   * A trigger's `EXECUTE FUNCTION f(...)` / `EXECUTE PROCEDURE f(...)`,
   * inside a CREATE ... TRIGGER statement.
   */
  private isTriggerExecute(at: number): boolean {
    if (this.firstWord !== "CREATE" || !this.sawTrigger) return false;
    const kind = this.word(at + 1);
    if (kind !== "FUNCTION" && kind !== "PROCEDURE") return false;
    const called = this.qualifiedName(at + 2);
    return called !== undefined && this.punct(called.next) === "(";
  }

  /**
   * One name as the dialect stores it, lower-cased (`storedNameKey`).
   * Undefined when the token is not one.
   */
  private nameAt(at: number): string | undefined {
    const token = this.tokens[at];
    if (token?.kind === "escaped-name") {
      return this.refuse(
        'a unicode-escaped name (U&"...") cannot be read without decoding it'
      );
    }
    const written = writtenName(token);
    return written && storedNameKey(written, this.reader.dialect);
  }

  /**
   * A possibly schema-qualified name starting at `at`; the last part is the
   * table, and `local` says whether it reaches what an unqualified name does
   * under the lower-cased name (`TableRef`). Undefined when no name starts
   * there; a qualifier with nothing after its dot is refused.
   */
  private qualifiedName(
    at: number
  ): (TableRef & { next: number; twin: boolean }) | undefined {
    const first = this.nameAt(at);
    if (first === undefined) return undefined;
    const parts = [first];
    let k = at + 1;
    while (this.punct(k) === ".") {
      const part = this.nameAt(k + 1);
      if (part === undefined) this.refuse("no name after a qualifier");
      parts.push(part);
      k += 2;
    }
    const name = parts[parts.length - 1];
    const canonical = canonicalTableName(name);
    const { dialect } = this.reader;
    return {
      name: canonical,
      local:
        qualifierIsLocal(parts.slice(0, -1), dialect) &&
        spelledAsStored(this.tokens[k - 1], dialect),
      next: k,
      twin: canonical !== name,
    };
  }

  /**
   * One DROP, from the DROP keyword. Returns where to resume.
   *
   * Every name in the target list is read, not just the first: `DROP TABLE
   * a, b` is one statement naming two tables, and reading only `a` let a
   * module drop `b` — belonging to another stream — with the guard approving
   * it, because the name it checked was the one the module was entitled to.
   *
   * After the list only CASCADE or RESTRICT and the end of the statement
   * may follow. Anything else is text this reader did not understand, and a
   * list it misunderstood is refused rather than trusted.
   */
  private readDrop(at: number): number {
    // A statement of its own. Inside an ALTER TABLE, MySQL's `DROP INDEX i`
    // is a clause naming its table, read by `readElementClause`.
    if (!this.inAlterTable && this.word(at + 1) === "INDEX") {
      return this.readDropIndex(at);
    }
    const listAt = this.dropTableListAt(at);
    if (listAt === undefined) {
      this.assertNoDependentsDropped(at);
      if (!this.inAlterTable) this.vacateDroppedNames(at);
      return at + 1;
    }
    return this.dropTail(this.readDropTargets(listAt));
  }

  /**
   * PostgreSQL's `CASCADE` on a DROP of anything but a table, refused: it
   * also drops whatever depends on the object, and that is not in the text.
   * A dropped type or domain takes every column of that type with it, in
   * whoever's table; a dropped function takes a generated column calling
   * it; a dropped type takes the tables typed by it (`CREATE TABLE ... OF`);
   * an extension takes all of these for every object it installed; a view
   * or sequence takes the views, routines and defaults that use it. Which
   * table those belong to only the database knows, so no ownership can be
   * judged. Without `CASCADE` PostgreSQL refuses the drop while anything
   * depends on the object, so an object only this module used drops without
   * it, after the module drops what it added that uses it.
   *
   * A DROP clause of an ALTER TABLE drops part of the table, judged as such
   * (`readAlterTableColumns`, `readElementClause`), and its `CASCADE` is
   * refused for the same reason: dropping a column or a constraint with it
   * also drops what depends on it — another table's foreign key on a unique
   * constraint or key, a view over the column — none of which the clause
   * names, and which may be another owner's. CASCADE ends the clause, or the
   * statement, so the word before that end is read. MySQL accepts `CASCADE`
   * and ignores it; SQLite has none.
   */
  private assertNoDependentsDropped(at: number): void {
    if (!this.reader.isPostgres) return;
    const end = this.inAlterTable ? this.clauseEnd(at) : this.statementEnd(at);
    if (this.word(end - 1) !== "CASCADE") return;
    this.refuse(
      this.inAlterTable
        ? "CASCADE on an ALTER TABLE drop also drops whatever depends on the column or constraint, such as another table's foreign key or a view, which may be another owner's; drop those dependents explicitly, then drop without CASCADE"
        : "CASCADE on a DROP of anything but a table also drops whatever depends on the object, which may be another owner's columns or tables; drop those dependents explicitly, then drop the object without CASCADE"
    );
  }

  /**
   * The names a PostgreSQL DROP of something other than a table or an index
   * drops, from the DROP at `at`, each vacated (`DropReader.vacate`): a
   * view, materialized view, sequence, foreign table or type shares the
   * relation namespace with indexes, so one may have shadowed an index of
   * its name on the search path, which a later lookup then reaches.
   */
  private vacateDroppedNames(at: number): void {
    if (!this.reader.isPostgres) return;
    const kindAt = TWO_WORD_KINDS.has(this.word(at + 1) ?? "")
      ? at + 2
      : at + 1;
    let k = this.skipIfExists(kindAt + 1);
    for (;;) {
      const name = this.qualifiedName(k);
      if (name === undefined) return;
      this.reader.vacate(name.name);
      if (this.punct(name.next) !== ",") return;
      k = name.next + 1;
    }
  }

  /**
   * PostgreSQL's `ALTER VIEW|MATERIALIZED VIEW|SEQUENCE|FOREIGN TABLE|TYPE`
   * that renames the relation or moves it to another schema: its name is
   * vacated (`DropReader.vacate`), as a dropped one is.
   */
  private readRelationMove(at: number): void {
    const relation = this.movableRelationAt(at);
    if (relation !== undefined && this.movesAwayFrom(relation.next)) {
      this.reader.vacate(relation.name);
    }
  }

  /**
   * The relation a PostgreSQL ALTER at `at` of a kind `MOVABLE_RELATION_KINDS`
   * lists names, past `IF EXISTS` and `ONLY`; undefined for any other ALTER.
   */
  private movableRelationAt(
    at: number
  ): (TableRef & { next: number }) | undefined {
    if (!this.reader.isPostgres) return undefined;
    const word = this.word(at + 1) ?? "";
    if (!MOVABLE_RELATION_KINDS.has(word)) return undefined;
    const kindAt = TWO_WORD_KINDS.has(word) ? at + 2 : at + 1;
    return this.qualifiedName(this.pastOnly(this.skipIfExists(kindAt + 1)));
  }

  /**
   * Whether the statement renames its relation (`RENAME TO`) or moves it to
   * another schema (`SET SCHEMA`), from `at` on.
   */
  private movesAwayFrom(at: number): boolean {
    for (let k = at; !this.atStatementEnd(k); k += 1) {
      if (this.word(k) === "RENAME" && this.word(k + 1) === "TO") return true;
      if (this.isSetSchemaAt(k)) return true;
    }
    return false;
  }

  /** Where the statement holding the token at `at` ends. */
  private statementEnd(at: number): number {
    let end = at + 1;
    while (!this.atStatementEnd(end)) end += 1;
    return end;
  }

  /**
   * Where the ALTER TABLE clause holding the token at `at` ends: its
   * statement's end, or the first comma outside parentheses, since a clause's
   * own expressions (a default, a check) may hold commas of their own.
   */
  private clauseEnd(at: number): number {
    let depth = 0;
    let end = at + 1;
    while (!this.atStatementEnd(end)) {
      const char = this.punct(end);
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === "," && depth === 0) break;
      end += 1;
    }
    return end;
  }

  /**
   * `DROP INDEX`, from the DROP keyword: every index in its list, recorded as
   * taken from its table. PostgreSQL's (`[CONCURRENTLY] [IF EXISTS] a, b`)
   * and SQLite's name only the index; MySQL's names its table after `ON`.
   * PostgreSQL's CASCADE is refused as on any drop of something that is not a
   * table. Returns where to resume.
   */
  private readDropIndex(at: number): number {
    this.assertNoDependentsDropped(at);
    let k = this.word(at + 2) === "CONCURRENTLY" ? at + 3 : at + 2;
    k = this.skipIfExists(k);
    for (;;) {
      const index = this.qualifiedName(k);
      if (index === undefined) {
        this.refuse("an index drop whose name cannot be read");
      }
      k = index.next;
      let table: TableRef | undefined;
      if (this.reader.isMysql && this.word(k) === "ON") {
        const on = this.qualifiedName(k + 1);
        if (on === undefined) {
          this.refuse("an index drop whose table name cannot be read");
        }
        table = on;
        k = on.next;
      }
      this.reader.takeElement(table, index.name, "index");
      if (this.punct(k) !== ",") return k;
      k += 1;
    }
  }

  /**
   * Where a DROP TABLE's target list starts, or undefined when the DROP
   * drops something other than tables by name.
   */
  private dropTableListAt(at: number): number | undefined {
    let k = at + 1;
    let keyword = this.word(k);
    if (keyword && NAMELESS_DROPS.has(keyword)) {
      this.refuse(`DROP ${keyword} removes tables without naming them`);
    }
    // MySQL's `DROP TEMPORARY TABLE` only touches a temporary table, but a
    // temporary table can shadow a real one by name, so it is read like any
    // other drop rather than trusted.
    if (keyword === "TEMPORARY") {
      k += 1;
      keyword = this.word(k);
    }
    // MySQL accepts `DROP TABLES` as a synonym.
    if (keyword !== "TABLE" && keyword !== "TABLES") return undefined;
    return this.skipIfExists(k + 1);
  }

  /**
   * Past `IF EXISTS` at `at`, if it is there. `IF` is only the start of IF
   * EXISTS when EXISTS follows; otherwise it is a table PostgreSQL lets be
   * called `if`.
   */
  private skipIfExists(at: number): number {
    return this.word(at) === "IF" && this.word(at + 1) === "EXISTS"
      ? at + 2
      : at;
  }

  /** Records every name in a DROP's target list; returns where it ends. */
  private readDropTargets(at: number): number {
    let k = at;
    for (;;) {
      const target = this.qualifiedName(k);
      if (!target) this.refuse("no readable table name");
      // PostgreSQL drops a table's partitions with it, and with CASCADE the
      // tables inheriting from it; without CASCADE it refuses while one does.
      this.reader.reach(target, "drop");
      this.reader.drop(target);
      k = target.next;
      if (this.punct(k) !== ",") return k;
      k += 1;
    }
  }

  /**
   * What follows a DROP's target list: CASCADE or RESTRICT at most, then
   * the end of the statement. Returns where the statement ends.
   */
  private dropTail(at: number): number {
    const tail = this.word(at);
    const k = tail === "CASCADE" || tail === "RESTRICT" ? at + 1 : at;
    if (!this.atStatementEnd(k)) {
      this.refuse("text after the table list that is not part of a DROP");
    }
    return k;
  }

  /**
   * Table renames inside one ALTER TABLE, recorded so a later drop of the
   * new name is judged as a drop of the table it was.
   *
   * `RENAME TO <new>` renames the table in every dialect; MySQL also takes
   * `RENAME AS <new>` and `RENAME <new>`. Column, constraint and index
   * renames are not table renames: `RENAME [COLUMN] a TO b` and `RENAME
   * CONSTRAINT` in PostgreSQL and SQLite, `RENAME COLUMN|INDEX|KEY` in MySQL.
   * PostgreSQL's `SET SCHEMA <schema>` moves the table out from under its
   * name, and is recorded as the table leaving it.
   * The tokens are not consumed, so the walk still sees every word in the
   * statement.
   */
  private readAlterTableRenames(at: number): void {
    const tableAt = this.alteredTableAt(at);
    if (tableAt === undefined) return;
    // The table's name is read only once a table rename is found, so an
    // ALTER TABLE that renames nothing is never refused over its name.
    let table: TableRef | undefined;
    for (let k = tableAt + 1; !this.atStatementEnd(k); k += 1) {
      table = this.readTableRenameAt(k, tableAt, table);
    }
  }

  /**
   * Records the SET SCHEMA or table rename at `k`, if one is there, of the
   * table named at `tableAt` and called `table` so far — undefined while its
   * name has not been read. Returns what the table is called after `k`.
   */
  private readTableRenameAt(
    k: number,
    tableAt: number,
    table: TableRef | undefined
  ): TableRef | undefined {
    if (this.isSetSchemaAt(k)) {
      const moved = table ?? this.qualifiedName(tableAt);
      if (moved === undefined) {
        this.refuse("a SET SCHEMA whose table name cannot be read");
      }
      this.reader.relocate(moved);
      return moved;
    }
    const newNameAt = this.tableRenameTargetAt(k);
    if (newNameAt === undefined) return table;
    return this.recordTableRename(
      table ?? this.qualifiedName(tableAt),
      newNameAt
    );
  }

  /**
   * A `CREATE [TEMPORARY] TABLE <name>` that must create a new table to
   * succeed. `IF NOT EXISTS` may create nothing, and a rebuild's twin is
   * judged as the table it rebuilds, so neither is recorded; nor is a name
   * that is not local (`TableRef`), which the reader declines to record.
   */
  private readCreateTable(at: number): void {
    // Only a statement that opens with CREATE: one inside a routine body is
    // not run where it is written, so it creates nothing here.
    if (at !== 0) return;
    const replacing =
      this.word(at + 1) === "OR" && this.word(at + 2) === "REPLACE";
    const nameAt = this.createdTableNameAt(replacing ? at + 3 : at + 1);
    if (nameAt === undefined) return;
    if (replacing) this.readReplacedTable(nameAt);
    else this.readCreatedTable(nameAt);
  }

  /**
   * Where the table's name starts in a CREATE whose modifiers start at `at`,
   * or undefined when it creates something other than a table.
   */
  private createdTableNameAt(at: number): number | undefined {
    let k = at;
    while (CREATE_TABLE_MODIFIERS.has(this.word(k) ?? "")) k += 1;
    return this.word(k) === "TABLE" ? k + 1 : undefined;
  }

  /**
   * MariaDB's `CREATE OR REPLACE [UNIQUE|FULLTEXT|SPATIAL|VECTOR] INDEX i ON t`,
   * which drops the index `i` on `t` when there is one and creates it anew:
   * read as the index taken from its table. Other dialects reject it.
   */
  private readReplacedIndex(at: number): void {
    const nameAt = this.replacedIndexNameAt(at);
    if (nameAt === undefined) return;
    const index = this.qualifiedName(nameAt);
    const table =
      index !== undefined && this.word(index.next) === "ON"
        ? this.qualifiedName(index.next + 1)
        : undefined;
    if (index === undefined || table === undefined) {
      this.refuse("a CREATE OR REPLACE INDEX whose names cannot be read");
    }
    this.reader.takeElement(table, index.name, "index");
  }

  /**
   * Where the index's name starts in MariaDB's `CREATE OR REPLACE ... INDEX
   * [IF NOT EXISTS]` from the CREATE at `at`; undefined for any other CREATE.
   */
  private replacedIndexNameAt(at: number): number | undefined {
    if (!this.reader.isMysql) return undefined;
    if (this.word(at + 1) !== "OR" || this.word(at + 2) !== "REPLACE") {
      return undefined;
    }
    const kindAt = INDEX_KIND_WORDS.has(this.word(at + 3) ?? "")
      ? at + 4
      : at + 3;
    if (this.word(kindAt) !== "INDEX") return undefined;
    return this.word(kindAt + 1) === "IF" ? kindAt + 4 : kindAt + 1;
  }

  /** The table a plain `CREATE TABLE` names at `at`, recorded as created. */
  private readCreatedTable(at: number): void {
    if (this.word(at) === "IF") return;
    const created = this.qualifiedName(at);
    if (created === undefined || created.twin) return;
    this.reader.create(created);
  }

  /**
   * MariaDB's `CREATE OR REPLACE TABLE <name>`, which drops the table of
   * that name when there is one and creates it anew: read as that drop and
   * then that creation (`DropReader.replace`). Other dialects reject the
   * syntax, so reading it the same way there refuses nothing they run.
   * MariaDB rejects it with `IF NOT EXISTS` too, and the guard refuses the
   * pair rather than read a name after it.
   */
  private readReplacedTable(at: number): void {
    const table = this.word(at) === "IF" ? undefined : this.qualifiedName(at);
    if (table === undefined) {
      this.refuse("a CREATE OR REPLACE TABLE whose table name cannot be read");
    }
    this.reader.replace(table);
  }

  /**
   * The columns one ALTER TABLE drops or renames away. Read at the start of
   * each of its clauses — after the table name and after every comma outside
   * parentheses — because a DROP inside a clause drops something else: a
   * default, `NOT NULL`, an identity. The tokens are not consumed.
   */
  private readAlterTableColumns(at: number): void {
    const tableAt = this.alteredTableAt(at);
    if (tableAt === undefined) return;
    const table = this.qualifiedName(tableAt);
    if (table !== undefined) this.recordPostgresTarget(table);
    const clausesAt = this.pastLockWait(
      this.pastDescendants(table?.next ?? tableAt + 1)
    );
    if (table !== undefined) this.readAlterReach(table, tableAt, clausesAt);
    for (const clause of this.clauseStarts(clausesAt)) {
      this.readAddedClause(table, clause, at);
      this.readColumnClause(table, clause);
      this.readColumnChangeClause(table, clause);
      this.readTableStorageClause(table, clause);
      this.readUnmodelledClause(table, clause);
      this.readElementClause(table, clause);
      this.readElementChangeClause(table, clause);
      this.readPartitionClause(table, clause);
    }
  }

  /**
   * PostgreSQL's ALTER TABLE can name an index (MySQL's cannot), so its
   * target is recorded for the live lookup. A schema-qualified target is
   * looked up by its name alone, which may not reach the schema the statement
   * names, so every such form is refused.
   */
  private recordPostgresTarget(table: TableRef): void {
    if (!this.reader.isPostgres) return;
    this.reader.targetAltered(table.name);
    if (!table.local) this.reader.leaveQualifiedTarget(table.name);
  }

  /**
   * Records an ALTER TABLE as reaching the descendants of the table named at
   * `tableAt`, unless `ONLY` precedes the name or its clauses, from
   * `clausesAt`, act on the table alone (`actsOnTableAlone`).
   */
  private readAlterReach(
    table: TableRef,
    tableAt: number,
    clausesAt: number
  ): void {
    if (this.word(tableAt - 1) === "ONLY") return;
    if (this.actsOnTableAlone(clausesAt)) return;
    this.reader.reach(table, "alter");
  }

  /**
   * Whether the ALTER TABLE whose clauses start at `at` acts on the table it
   * names alone, whatever its descendants: PostgreSQL's table rename, its
   * `SET SCHEMA`, and `DETACH PARTITION`, which takes no `ONLY` and changes
   * the partition it names (judged as such) and no other. Every other form
   * reaches the descendants too unless `ONLY` is written, and is read so —
   * `ATTACH PARTITION` among them: it changes the default partition's
   * constraint, and clones indexes, constraints and triggers into the
   * partition tree.
   */
  private actsOnTableAlone(at: number): boolean {
    if (this.isSetSchemaAt(at)) return true;
    if (this.word(at) === "RENAME" && this.word(at + 1) === "TO") return true;
    return this.word(at) === "DETACH" && this.word(at + 1) === "PARTITION";
  }

  /**
   * One ALTER TABLE clause starting at `at`, for a partition change to the
   * table (`PARTITION_CHANGES`), recorded as one. PostgreSQL's
   * `ATTACH PARTITION y` also makes `y` a partition of the table, which a
   * drop of the table then takes with it; MySQL's
   * `EXCHANGE PARTITION p WITH TABLE y` swaps `y`'s rows with the
   * partition's. Either way `y` is recorded as well.
   */
  private readPartitionClause(table: TableRef | undefined, at: number): void {
    const change = this.word(at) ?? "";
    // MariaDB's `CONVERT TABLE x TO PARTITION p ...` makes `x` a partition of
    // the table: `x` is gone under its own name, its rows the table's.
    const converts = change === "CONVERT" && this.word(at + 1) === "TABLE";
    const partitions =
      this.word(at + 1) === "PARTITION" && PARTITION_CHANGES.has(change);
    if (!converts && !partitions) return;
    if (table === undefined) {
      this.refuse("a partition change whose table name cannot be read");
    }
    this.reader.changeTable(table, "change the partitions of");
    if (converts) {
      this.recordPartitionTable(at + 2, "attach as a partition");
    } else {
      this.recordPartitionChangeTable(change, at + 2);
    }
  }

  /**
   * The other table a partition clause names, from its partition's name at
   * `at`: PostgreSQL's `ATTACH` and `DETACH PARTITION y`, whose `y` joins or
   * leaves the table's tree, and MySQL's `EXCHANGE PARTITION p WITH TABLE y`.
   */
  private recordPartitionChangeTable(change: string, at: number): void {
    if (change === "ATTACH") {
      this.recordPartitionTable(at, "attach as a partition");
    } else if (change === "DETACH" && this.reader.isPostgres) {
      this.recordPartitionTable(at, "detach as a partition");
    } else if (change === "EXCHANGE") {
      this.recordPartitionTable(
        this.exchangedTableAt(at),
        "exchange a partition with"
      );
    }
  }

  /** The table named at `at`, recorded as `act` changes it. */
  private recordPartitionTable(at: number, act: TableChange): void {
    const table = this.qualifiedName(at);
    if (table === undefined) {
      this.refuse("a partition change whose table name cannot be read");
    }
    this.reader.changeTable(table, act);
  }

  /**
   * Where the table of MySQL's `EXCHANGE PARTITION p WITH TABLE t` is named,
   * from the partition's name at `at`: past `WITH TABLE`. Where that is not
   * there, the name read there fails to be one and the clause is refused.
   */
  private exchangedTableAt(at: number): number {
    return this.word(at + 1) === "WITH" && this.word(at + 2) === "TABLE"
      ? at + 3
      : at + 1;
  }

  /**
   * PostgreSQL's `CREATE TABLE p PARTITION OF t`, with or without `IF NOT
   * EXISTS`: the new table becomes a partition of `t`, so rows written to
   * `t` may land in it, and a later drop of `p` takes them. Recorded as a
   * change to `t`'s partitions. Read wherever a CREATE stands, since one in
   * a dollar-quoted body runs too.
   */
  private readPartitionOf(at: number): void {
    const nameAt = this.createdTableNameAt(at + 1);
    if (nameAt === undefined) return;
    const created = this.qualifiedName(
      this.word(nameAt) === "IF" ? nameAt + 3 : nameAt
    );
    if (created === undefined) return;
    if (
      this.word(created.next) !== "PARTITION" ||
      this.word(created.next + 1) !== "OF"
    ) {
      return;
    }
    this.recordPartitionParent(created.next + 2);
  }

  /** The parent named at `at` of a new partition, recorded as changed. */
  private recordPartitionParent(at: number): void {
    const parent = this.qualifiedName(at);
    if (parent === undefined) {
      this.refuse("a PARTITION OF whose parent table cannot be read");
    }
    this.reader.changeTable(parent, "change the partitions of");
  }

  /**
   * PostgreSQL's renames of a column through another kind of relation:
   * `ALTER VIEW`, `ALTER MATERIALIZED VIEW` and `ALTER FOREIGN TABLE` with
   * `RENAME [COLUMN] a TO b`, and `ALTER TYPE t RENAME ATTRIBUTE a TO b`.
   * PostgreSQL runs each of them on a plain table too, renaming its column,
   * so each is read as `ALTER TABLE t RENAME COLUMN a TO b` is. Their other
   * forms PostgreSQL refuses on a table. The tokens are not consumed.
   */
  private readRelationColumnRename(at: number): void {
    if (!this.reader.isPostgres) return;
    const nameAt = this.renamedRelationAt(at + 1);
    if (nameAt === undefined) return;
    const relation = this.qualifiedName(nameAt);
    if (relation === undefined) return;
    const renameAt = this.pastDescendants(relation.next);
    if (this.word(renameAt) !== "RENAME") return;
    if (this.word(renameAt + 1) === "ATTRIBUTE") {
      const attribute = this.nameAt(renameAt + 2);
      if (attribute === undefined) {
        this.refuse("a column drop or rename whose names cannot be read");
      }
      this.reader.takeColumn(relation, attribute);
      return;
    }
    this.readColumnClause(relation, renameAt);
  }

  /**
   * Where the relation's name starts after `ALTER` in PostgreSQL's
   * `ALTER VIEW|MATERIALIZED VIEW|FOREIGN TABLE|TYPE`, from the word at
   * `at`, past `IF EXISTS` and `ONLY`; undefined for any other ALTER.
   */
  private renamedRelationAt(at: number): number | undefined {
    const kind = RELATION_KIND_WORDS.get(this.word(at) ?? "");
    if (kind === undefined) return undefined;
    let k = at + 1;
    if (kind.next !== undefined) {
      if (this.word(k) !== kind.next) return undefined;
      k += 1;
    }
    return this.pastOnly(this.skipIfExists(k));
  }

  /**
   * Past MariaDB's `WAIT n` or `NOWAIT` after an ALTER TABLE's table name,
   * which says how long to wait for the table's lock. Read as the first
   * clause, it hid the clause after it.
   */
  private pastLockWait(at: number): number {
    if (!this.reader.isMysql) return at;
    if (this.word(at) === "NOWAIT") return at + 1;
    return this.word(at) === "WAIT" && /^\d+$/.test(this.word(at + 1) ?? "")
      ? at + 2
      : at;
  }

  /** Past PostgreSQL's `ONLY` before a relation's name, if it is there. */
  private pastOnly(at: number): number {
    return this.word(at) === "ONLY" ? at + 1 : at;
  }

  /**
   * Past PostgreSQL's `*` after an ALTER TABLE's table name, which alters the
   * tables inheriting from it too: `ALTER TABLE users * DROP COLUMN email`
   * drops `email` from `users` itself. Read as the first clause, the `*` hid
   * the DROP after it. Other dialects reject the `*`, so stepping past it
   * there reads nothing they run.
   */
  private pastDescendants(at: number): number {
    return this.punct(at) === "*" ? at + 1 : at;
  }

  /**
   * PostgreSQL's `ALTER INDEX [IF EXISTS] a RENAME TO b`, recorded as `a`
   * taken from its table: after the rename no record names it. The tokens
   * are not consumed.
   */
  /**
   * PostgreSQL's `ALTER FOREIGN TABLE [IF EXISTS] [ONLY] t ...`: its clauses
   * are not read, so the table is recorded as unmodelled. A foreign table can
   * inherit and be inherited from, so without `ONLY` its descendants are
   * altered too.
   */
  private readAlterForeignTable(at: number): void {
    if (this.word(at + 1) !== "FOREIGN" || this.word(at + 2) !== "TABLE") {
      return;
    }
    const nameAt = this.skipIfExists(at + 3);
    const relation = this.qualifiedName(this.pastOnly(nameAt));
    if (relation === undefined) return;
    this.reader.leaveUnmodelled(relation.name);
    if (this.word(nameAt) !== "ONLY") this.reader.reach(relation, "alter");
  }

  /**
   * PostgreSQL's `ALTER TYPE t ... CASCADE`, recorded (`typesCascaded`):
   * CASCADE carries an attribute's addition, removal, type change or rename
   * to every table typed by the type (`CREATE TABLE ... OF`), and their
   * descendants, none of which the text names. Without CASCADE PostgreSQL
   * refuses the change while any such table exists.
   */
  private readTypeCascade(at: number): void {
    if (!this.reader.isPostgres || this.word(at + 1) !== "TYPE") return;
    for (let k = at + 2; !this.atStatementEnd(k); k += 1) {
      if (this.word(k) !== "CASCADE") continue;
      this.reader.typesCascaded.push(this.nameAt(at + 2) ?? "a type");
      return;
    }
  }

  /**
   * A PostgreSQL `ALTER INDEX i <form>` other than `RENAME`: the index is
   * changed in place, and an attached partition index is changed as well.
   * The bulk `ALL IN TABLESPACE` form names no index, so it is refused.
   */
  private readPostgresIndexChange(
    at: number,
    index: { name: string; next: number }
  ): void {
    if (this.word(at + 2) === "ALL") {
      this.refuse(
        "an ALTER INDEX ALL IN TABLESPACE, whose indexes cannot be named"
      );
    }
    this.reader.changeElement(
      undefined,
      index.name,
      "index",
      this.spelledAsStoredAt(this.skipIfExists(at + 2))
    );
    if (
      this.word(index.next) === "ATTACH" &&
      this.word(index.next + 1) === "PARTITION"
    ) {
      const child = this.qualifiedName(index.next + 2);
      if (child === undefined) {
        this.refuse(
          "an index attached as a partition whose name cannot be read"
        );
      }
      this.reader.changeElement(
        undefined,
        child.name,
        "index",
        child.local && this.spelledAsStoredAt(index.next + 2)
      );
    }
  }

  private readAlterIndexRename(at: number): void {
    if (this.word(at + 1) !== "INDEX") return;
    const index = this.qualifiedName(this.skipIfExists(at + 2));
    if (index === undefined) return;
    // Every PostgreSQL ALTER INDEX form other than RENAME changes the index
    // in place, so the index is judged as one.
    if (this.reader.isPostgres && this.word(index.next) !== "RENAME") {
      // A schema-qualified index is looked up by its name alone, which may
      // not reach the schema the statement names, so it is refused.
      if (!index.local) {
        this.refuse("an ALTER INDEX of an index named with a schema qualifier");
      }
      this.readPostgresIndexChange(at, index);
      return;
    }
    if (
      this.word(index.next) !== "RENAME" ||
      this.word(index.next + 1) !== "TO"
    ) {
      return;
    }
    this.reader.takeElement(undefined, index.name, "index");
    // PostgreSQL renames a table through ALTER INDEX as well.
    if (this.reader.isPostgres) this.reader.renameRelation(index.name);
  }

  /**
   * One ALTER TABLE clause starting at `at`, for an index or constraint it
   * drops or renames away.
   */
  private readElementClause(table: TableRef | undefined, at: number): void {
    const element = this.takenElementAt(at);
    if (element === undefined) return;
    if (element === null || table === undefined) {
      this.refuse(
        "an index or constraint drop or rename whose names cannot be read"
      );
    }
    this.reader.takeElement(table, element.name, element.kind);
  }

  /** Whether the name at `at` is spelled as stored, so folding cannot change it. */
  private spelledAsStoredAt(at: number): boolean {
    return spelledAsStored(this.tokens[at], this.reader.dialect);
  }

  /**
   * Whether the name `name` read from the clause at `at` or the next token is
   * spelled as stored. A column named `column` is read at `at + 1`, or past
   * an optional `COLUMN` keyword and MariaDB's `IF EXISTS`, up to `at + 4`.
   */
  private spelledAsStoredNear(at: number, name: string): boolean {
    for (const p of [at + 1, at + 2, at + 3, at + 4]) {
      if (this.nameAt(p) === name) return this.spelledAsStoredAt(p);
    }
    return false;
  }

  /**
   * One ALTER TABLE clause starting at `at` that adds a column or a named
   * constraint, which the same list may then change. `alterAt` is where the
   * statement's ALTER stands.
   */
  private readAddedClause(
    table: TableRef | undefined,
    at: number,
    alterAt: number
  ): void {
    if (table === undefined || this.word(at) !== "ADD") return;
    // A takeover is judged wherever it is written, inside a routine or not.
    this.readUsingIndexClause(table, at);
    // Only an ALTER TABLE that opens its statement is run as written. One
    // anywhere else is inside a routine body — PostgreSQL's dollar-quoted
    // body, MySQL's `CREATE PROCEDURE ... BEGIN ... END`, MariaDB's
    // `BEGIN NOT ATOMIC` — whose branch may not be taken, whose exception
    // may be swallowed, or which may never be called. It is not credited.
    if (alterAt !== 0) return;
    const first = this.word(at + 1) ?? "";
    if (first === "CONSTRAINT") {
      this.readAddedConstraint(table, at + 2);
      return;
    }
    if (first === "COLUMN") {
      this.readAddedColumn(table, at + 2);
      return;
    }
    // Without COLUMN, only a quoted name proves a column is added. A bare
    // word may be a keyword of a table-level form: MariaDB's
    // `ADD SYSTEM VERSIONING` and `ADD PERIOD FOR`, an index's `ADD KEY` or
    // `ADD FULLTEXT`, or one no list here names. It is not credited.
    if (this.tokens[at + 1]?.kind === "word") return;
    this.readAddedColumn(table, at + 1);
  }

  /** The token position of `USING INDEX` in an ADD clause, if it has one. */
  private usingIndexAt(at: number): number | undefined {
    for (let p = at + 1; p <= at + 5; p += 1) {
      if (this.word(p) === "USING" && this.word(p + 1) === "INDEX") return p;
    }
    return undefined;
  }

  /**
   * Whether a constraint's `INDEX` or `KEY` word is followed by an index name
   * of its own. MariaDB creates that index under the name it is given, not
   * under the constraint's symbol, so the symbol does not name what is added.
   */
  private namesIndexAt(at: number): boolean {
    for (let p = at + 1; p <= at + 4; p += 1) {
      // The index prefix ends at the first parenthesis, where a CHECK's
      // expression or a column list begins; words past it are not index syntax.
      if (this.punct(p) === "(") return false;
      const word = this.word(p);
      if (
        (word === "INDEX" || word === "KEY") &&
        this.nameAt(p + 1) !== undefined
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * `ADD [CONSTRAINT c] UNIQUE|PRIMARY KEY USING INDEX i` takes over the
   * existing index i and renames it, so i is judged as a change to its owner.
   */
  private readUsingIndexClause(table: TableRef | undefined, at: number): void {
    const using = this.usingIndexAt(at);
    if (using === undefined) return;
    const name = this.nameAt(using + 2);
    if (table === undefined || name === undefined) {
      this.refuse(
        "an index an ADD ... USING INDEX takes over, whose name cannot be read"
      );
    }
    this.reader.changeElement(
      table,
      name,
      "index",
      this.spelledAsStoredAt(using + 2)
    );
  }

  /** The column an `ADD [COLUMN]` clause adds, from the name at `k`. */
  private readAddedColumn(table: TableRef, k: number): void {
    // A conditional add may be a no-op on a column that already exists, so
    // it is not credited to this list.
    if (this.isConditionalAddAt(k)) return;
    const column = this.nameAt(k);
    if (column !== undefined) {
      this.reader.addColumn(table, column, this.spelledAsStoredAt(k));
    }
  }

  /**
   * `ADD CONSTRAINT name <type>`. MySQL and MariaDB allow the name to be
   * omitted, so a constraint whose first word is its type has no name of its
   * own, and is not credited.
   */
  private readAddedConstraint(table: TableRef, at: number): void {
    if (ANONYMOUS_CONSTRAINT_WORDS.has(this.word(at) ?? "")) return;
    // MySQL and MariaDB ignore a primary key's symbol and name the index
    // PRIMARY, so the name given does not identify the added index.
    if (this.word(at + 1) === "PRIMARY") return;
    // A constraint that takes over an index, or may be a no-op, is not credited.
    if (this.usingIndexAt(at) !== undefined) return;
    if (this.namesIndexAt(at)) return;
    for (let p = at + 1; p <= at + 4; p += 1) {
      if (this.isConditionalAddAt(p)) return;
    }
    const name = this.nameAt(at);
    if (name === undefined) return;
    this.reader.addElement(
      table,
      name,
      addedConstraintKind(this.word(at + 1)),
      this.spelledAsStoredAt(at)
    );
  }

  private isConditionalAddAt(at: number): boolean {
    return (
      this.word(at) === "IF" &&
      this.word(at + 1) === "NOT" &&
      this.word(at + 2) === "EXISTS"
    );
  }

  /**
   * One ALTER TABLE clause starting at `at` in a form this reader does not
   * model: any clause whose first word is not one it reads. The table is
   * recorded, so a foreign one is refused.
   */
  private readUnmodelledClause(table: TableRef | undefined, at: number): void {
    if (table === undefined || this.isModelledClauseAt(at)) return;
    if (!table.local) this.reader.leaveQualifiedTarget(table.name);
    this.reader.leaveUnmodelled(table.name);
    // A table option that changes none of the table's columns, indexes or
    // constraints leaves the other owners' elements on it as they were.
    if (!this.isTableOptionsAt(at)) this.reader.leaveUnreadOnElements(table);
  }

  private isModelledClauseAt(at: number): boolean {
    const word = this.word(at) ?? "";
    if (word === "SET") {
      return ["TABLESPACE", "ACCESS"].includes(this.word(at + 1) ?? "");
    }
    // On MySQL and MariaDB, an ADD whose next word is a bare word that names
    // no kind of element may be a keyword of a table-level form (MariaDB's
    // `ADD SYSTEM VERSIONING`, `ADD PERIOD FOR`) as well as a column's name.
    // PostgreSQL's and SQLite's grammars have no such form: there it is a
    // column.
    if (
      word === "ADD" &&
      this.reader.isMysql &&
      this.tokens[at + 1]?.kind === "word"
    ) {
      return ADDED_ELEMENT_WORDS.has(this.word(at + 1) ?? "");
    }
    return MODELLED_CLAUSE_WORDS.has(word);
  }

  /**
   * Whether the clause starting at `at` is MySQL table options alone, each
   * `option [=] value`, which change none of the table's columns, indexes
   * or constraints: a comment, the next auto-increment value, the algorithm
   * or lock the change runs with, the row format, the default character set
   * or collation for new columns, a rebuild (`FORCE`) and a row order
   * (`ORDER BY c`). `CONVERT TO CHARACTER SET`, which rewrites every
   * column, is not one.
   */
  private isTableOptionsAt(at: number): boolean {
    if (!this.reader.isMysql) return false;
    const end = this.clauseEnd(at);
    let k: number | undefined = at;
    while (k !== undefined && k < end) k = this.pastTableOption(k, end);
    return k !== undefined;
  }

  /**
   * Past one table option at `at` that `isTableOptionsAt` allows, ending by
   * `end`; undefined when none stands there. `FORCE` and `ORDER BY c` take
   * no value; the rest are `[DEFAULT] option [=] value`.
   */
  private pastTableOption(at: number, end: number): number | undefined {
    if (this.word(at) === "FORCE") return at + 1;
    if (this.word(at) === "ORDER" && this.word(at + 1) === "BY") {
      return this.nameAt(at + 2) === undefined ? undefined : at + 3;
    }
    const valueAt = this.tableOptionValueAt(at);
    if (valueAt === undefined || valueAt >= end) return undefined;
    return this.tokens[valueAt]?.kind === "punct" ? undefined : valueAt + 1;
  }

  /**
   * Where the value of a `[DEFAULT] option [=]` starting at `at` stands, or
   * undefined when no option `TABLE_OPTION_WORDS` lists starts there.
   */
  private tableOptionValueAt(at: number): number | undefined {
    const k = this.word(at) === "DEFAULT" ? at + 1 : at;
    let next: number;
    if (this.word(k) === "CHARACTER" && this.word(k + 1) === "SET")
      next = k + 2;
    else if (TABLE_OPTION_WORDS.has(this.word(k) ?? "")) next = k + 1;
    else return undefined;
    return this.punct(next) === "=" ? next + 1 : next;
  }

  /**
   * One ALTER TABLE clause starting at `at`, for a change to the table's
   * storage: PostgreSQL's `SET ACCESS METHOD` and `SET TABLESPACE`, and
   * MySQL's `ENGINE`. Such a change rewrites or moves the table's data.
   */
  private readTableStorageClause(
    table: TableRef | undefined,
    at: number
  ): void {
    if (table === undefined || !this.isTableStorageAt(at)) return;
    if (!table.local) this.reader.leaveQualifiedTarget(table.name);
    this.reader.changeTable(table, "change the storage of");
  }

  private isTableStorageAt(at: number): boolean {
    if (this.reader.isPostgres && this.word(at) === "SET") {
      return (
        this.word(at + 1) === "TABLESPACE" ||
        (this.word(at + 1) === "ACCESS" && this.word(at + 2) === "METHOD")
      );
    }
    return this.reader.isMysql && this.word(at) === "ENGINE";
  }

  /**
   * One ALTER TABLE clause starting at `at`, for an index or constraint it
   * changes in place: PostgreSQL's `ALTER CONSTRAINT c`, and MySQL's
   * `ALTER INDEX|KEY i` (visibility) and `ALTER CHECK c` (enforcement).
   */
  private readElementChangeClause(
    table: TableRef | undefined,
    at: number
  ): void {
    const kind = this.changedElementKindAt(at);
    if (kind === undefined) return;
    const nameAt = this.skipIfExists(at + 2);
    const element = this.elementNamedAt(nameAt, kind);
    if (element === null || table === undefined) {
      this.refuse("an index or constraint change whose names cannot be read");
    }
    this.reader.changeElement(
      table,
      element.name,
      element.kind,
      this.spelledAsStoredAt(nameAt)
    );
  }

  /** The element kind a clause changes in place, from its first word. */
  private changedElementKindAt(at: number): TakenElementKind | undefined {
    if (this.word(at) === "VALIDATE") {
      return this.word(at + 1) === "CONSTRAINT" ? "constraint" : undefined;
    }
    if (this.word(at) !== "ALTER") return undefined;
    return ALTERED_ELEMENT_KINDS.get(this.word(at + 1) ?? "");
  }

  /**
   * The index or constraint a clause drops or renames away: its name and
   * kind, `undefined` when the clause takes none, or `null` when it does and
   * the name cannot be read.
   *
   * - `DROP CONSTRAINT [IF EXISTS] c` (PostgreSQL, MySQL).
   * - MySQL's `DROP INDEX|KEY i`, `DROP FOREIGN KEY f`, `DROP CHECK c` and
   *   `DROP PRIMARY KEY`, which has no name of its own.
   * - `RENAME CONSTRAINT c TO d` (PostgreSQL) and MySQL's
   *   `RENAME INDEX|KEY i TO j`.
   */
  private takenElementAt(
    at: number
  ): { name: string; kind: TakenElementKind } | null | undefined {
    if (this.word(at) === "DROP") return this.droppedElementAt(at + 1);
    if (this.word(at) === "RENAME") return this.renamedElementAt(at + 1);
    return undefined;
  }

  private droppedElementAt(
    at: number
  ): { name: string; kind: TakenElementKind } | null | undefined {
    switch (this.word(at)) {
      case "CONSTRAINT":
        return this.elementNamedAt(this.skipIfExists(at + 1), "constraint");
      case "INDEX":
      case "KEY":
        return this.elementNamedAt(this.skipIfExists(at + 1), "index");
      case "FOREIGN":
        return this.word(at + 1) === "KEY"
          ? this.elementNamedAt(this.skipIfExists(at + 2), "fk")
          : null;
      case "CHECK":
        return this.elementNamedAt(at + 1, "check");
      case "PRIMARY":
        return this.word(at + 1) === "KEY"
          ? { name: "primary", kind: "constraint" }
          : null;
      default:
        return undefined;
    }
  }

  private renamedElementAt(
    at: number
  ): { name: string; kind: TakenElementKind } | null | undefined {
    const what = this.word(at);
    const nameAt = this.skipIfExists(at + 1);
    if (what === "CONSTRAINT") return this.elementNamedAt(nameAt, "constraint");
    if (this.reader.isMysql && (what === "INDEX" || what === "KEY")) {
      return this.elementNamedAt(nameAt, "index");
    }
    return undefined;
  }

  /** The element named at `at`, or null when no name can be read there. */
  private elementNamedAt(
    at: number,
    kind: TakenElementKind
  ): { name: string; kind: TakenElementKind } | null {
    const name = this.nameAt(at);
    return name === undefined ? null : { name, kind };
  }

  /**
   * Where each clause of a statement starts, from `from`: there, and after
   * every comma outside parentheses.
   */
  private clauseStarts(from: number): number[] {
    const starts = [from];
    let depth = 0;
    for (let k = from; !this.atStatementEnd(k); k += 1) {
      const char = this.punct(k);
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === "," && depth === 0) starts.push(k + 1);
    }
    return starts;
  }

  /**
   * One ALTER TABLE clause starting at `at`, for a column it changes in place:
   * its type, nullability or default, or a MySQL redefinition under the same
   * name. A drop, a rename or a clause that names no column is read elsewhere.
   */
  private readColumnChangeClause(
    table: TableRef | undefined,
    at: number
  ): void {
    const column = this.changedInPlaceColumnAt(at);
    if (column === undefined) return;
    if (column === null || table === undefined) {
      this.refuse("a column change whose names cannot be read");
    }
    this.reader.changeColumn(
      table,
      column,
      this.spelledAsStoredNear(at, column)
    );
  }

  /**
   * The column a clause changes in place, `undefined` when the clause changes
   * none, or `null` when it does and the name cannot be read.
   *
   * - `ALTER [COLUMN] c TYPE|SET|DROP|ADD ...` in PostgreSQL, and MySQL's
   *   `ALTER [COLUMN] c SET|DROP DEFAULT`.
   * - MySQL's `MODIFY [COLUMN] c ...`.
   * - MySQL's `CHANGE [COLUMN] c c ...`, a redefinition under the same name.
   */
  private changedInPlaceColumnAt(at: number): string | null | undefined {
    switch (this.word(at)) {
      case "ALTER":
        return this.alteredColumnAt(at + 1);
      case "MODIFY": {
        if (!this.reader.isMysql) return undefined;
        // MariaDB's `MODIFY [COLUMN] [IF EXISTS] c`.
        const named = this.word(at + 1) === "COLUMN" ? at + 2 : at + 1;
        return this.nameAt(this.skipIfExists(named)) ?? null;
      }
      case "CHANGE":
        return this.reader.isMysql ? this.redefinedColumnAt(at + 1) : undefined;
      default:
        return undefined;
    }
  }

  /** The column an `ALTER` clause changes in place, from past `ALTER`. */
  private alteredColumnAt(at: number): string | null | undefined {
    const keyword = this.word(at) === "COLUMN" ? at + 1 : at;
    if (keyword === at && NOT_COLUMN_ALTERS.has(this.word(at) ?? "")) {
      return undefined;
    }
    // MariaDB's `ALTER [COLUMN] [IF EXISTS] c`.
    const named = this.skipIfExists(keyword);
    const column = this.nameAt(named);
    if (column === undefined) {
      return named === at ? undefined : null;
    }
    return IN_PLACE_CHANGE_WORDS.has(this.word(named + 1) ?? "")
      ? column
      : undefined;
  }

  /** MySQL's `CHANGE [COLUMN] [IF EXISTS] c c`: the same name, so no rename. */
  private redefinedColumnAt(at: number): string | undefined {
    const k = this.skipIfExists(this.word(at) === "COLUMN" ? at + 1 : at);
    const from = this.nameAt(k);
    const to = this.nameAt(k + 1);
    return from !== undefined && from === to ? from : undefined;
  }

  /** One ALTER TABLE clause starting at `at`, for a column it takes away. */
  private readColumnClause(table: TableRef | undefined, at: number): void {
    const column = this.takenColumnAt(at);
    if (column === undefined) return;
    if (column === null || table === undefined) {
      this.refuse("a column drop or rename whose names cannot be read");
    }
    this.reader.takeColumn(table, column);
  }

  /**
   * The column a clause drops or renames away: its name, `undefined` when the
   * clause takes no column, or `null` when it does and the name cannot be
   * read.
   *
   * - `DROP [COLUMN] [IF EXISTS] c` in every dialect; `DROP CONSTRAINT`,
   *   `INDEX`, `KEY`, `FOREIGN KEY`, `PRIMARY KEY`, `CHECK` and `PARTITION`
   *   drop something else.
   * - `RENAME COLUMN c TO d` in every dialect, and `RENAME c TO d` outside
   *   MySQL, where `RENAME <name>` renames the table.
   * - MySQL's `CHANGE [COLUMN] c d ...` when `d` is another name.
   */
  private takenColumnAt(at: number): string | null | undefined {
    switch (this.word(at)) {
      case "DROP":
        return this.droppedColumnAt(at + 1);
      case "RENAME":
        return this.renamedColumnAt(at + 1);
      case "CHANGE":
        return this.reader.isMysql ? this.changedColumnAt(at + 1) : undefined;
      default:
        return undefined;
    }
  }

  private droppedColumnAt(at: number): string | null | undefined {
    if (NOT_COLUMN_DROPS.has(this.word(at) ?? "")) return undefined;
    const k = this.skipIfExists(this.word(at) === "COLUMN" ? at + 1 : at);
    return this.nameAt(k) ?? null;
  }

  private renamedColumnAt(at: number): string | null | undefined {
    // MariaDB's `RENAME COLUMN [IF EXISTS] a TO b`.
    if (this.word(at) === "COLUMN") {
      return this.nameAt(this.skipIfExists(at + 1)) ?? null;
    }
    if (this.reader.isMysql) return undefined;
    const next = this.word(at);
    if (next === "TO" || next === "CONSTRAINT") return undefined;
    const column = this.nameAt(at);
    return column !== undefined && this.word(at + 1) === "TO"
      ? column
      : undefined;
  }

  private changedColumnAt(at: number): string | null | undefined {
    const k = this.skipIfExists(this.word(at) === "COLUMN" ? at + 1 : at);
    const from = this.nameAt(k);
    const to = this.nameAt(k + 1);
    if (from === undefined || to === undefined) return null;
    return from === to ? undefined : from;
  }

  /** PostgreSQL's `SET SCHEMA`, which only a table move spells that way. */
  private isSetSchemaAt(at: number): boolean {
    return (
      this.reader.isPostgres &&
      this.word(at) === "SET" &&
      this.word(at + 1) === "SCHEMA"
    );
  }

  /**
   * Where an ALTER TABLE's table name starts, or undefined when the ALTER
   * alters something other than a table. A `*` after the name is stepped
   * past by the clause reader (`pastDescendants`).
   */
  private alteredTableAt(at: number): number | undefined {
    const k = this.skipMysqlAlterModifiers(at + 1);
    if (this.word(k) !== "TABLE") return undefined;
    const nameAt = this.skipIfExists(k + 1);
    return this.word(nameAt) === "ONLY" ? nameAt + 1 : nameAt;
  }

  /** Past MySQL's `ALTER ONLINE TABLE` / `ALTER IGNORE TABLE` modifiers. */
  private skipMysqlAlterModifiers(at: number): number {
    if (!this.reader.isMysql) return at;
    let k = at;
    while (this.word(k) === "ONLINE" || this.word(k) === "IGNORE") k += 1;
    return k;
  }

  /**
   * Where the new name of a table rename starting at `at` is, or undefined
   * when no table rename starts there. `RENAME TO <new>` renames the table
   * in every dialect; the MySQL-only forms are read separately.
   */
  private tableRenameTargetAt(at: number): number | undefined {
    if (this.word(at) !== "RENAME") return undefined;
    const next = this.word(at + 1);
    if (next === "TO") return at + 2;
    return this.reader.isMysql ? mysqlRenameTargetAt(at, next) : undefined;
  }

  /**
   * Records one table rename inside an ALTER TABLE, from `table` to the name
   * at `newNameAt`, and returns the table as it is then named. The renamed
   * table stays where it was, so its new name is local only when both are.
   */
  private recordTableRename(
    table: TableRef | undefined,
    newNameAt: number
  ): TableRef {
    const renamed = this.qualifiedName(newNameAt);
    if (table === undefined || renamed === undefined) {
      this.refuse("a table rename whose names cannot be read");
    }
    const to = { name: renamed.name, local: table.local && renamed.local };
    this.reader.rename(table, to);
    return to;
  }

  /** MySQL's `RENAME TABLE a TO b [, c TO d]`, from the first name. */
  private readRenameTable(at: number): number {
    let k = at;
    for (;;) {
      const from = this.qualifiedName(k);
      const to =
        from && this.word(from.next) === "TO"
          ? this.qualifiedName(from.next + 1)
          : undefined;
      if (!from || !to)
        this.refuse("a RENAME TABLE whose names cannot be read");
      this.reader.rename(from, to);
      k = to.next;
      if (this.punct(k) !== ",") return k;
      k += 1;
    }
  }
}

/**
 * The tables a list of statements would drop, lower-cased, read as the given
 * dialect reads them.
 *
 * Only DROP is extracted. A migration that creates or alters a table it does
 * not own is a different question with a different answer — it may be adding
 * an index a plugin asked for — and conflating the two here would refuse work
 * that is legitimate. Renames are followed only so that a drop of a renamed
 * table is attributed to the table it was: a dropped name a rename produced
 * is returned together with the name the table had before.
 *
 * Throws `UnparsableDropTarget` for any statement it cannot read.
 */
export function tablesDroppedBy(
  statements: readonly string[],
  dialect: SupportedDialect,
  liveColumns?: LiveColumns
): string[] {
  // No live tables are read here, so no creation is credited: a table the
  // list creates and drops is returned as a drop like any other.
  return readStatements(statements, dialect, liveColumns, undefined).dropped;
}

/**
 * The tables one statement drops, by the unqualified names it writes them
 * with, lower-cased — a rebuild's `__new_` copy under its own name, as
 * `tableNamedByCreate` gives it, not the table it stands in for. Empty for a
 * statement that drops none or cannot be read, and for a name written
 * qualified: a caller asking whether a table is gone by some point then
 * hears that it is not. A rename is not a drop: the table, and what was
 * written into it, lives on under its new name.
 */
export function tablesDroppedIn(
  statement: string,
  dialect: SupportedDialect
): string[] {
  const tokens = soleStatementTokens(statement, dialect);
  if (tokens === undefined) return [];
  const cursor = new TokenCursor(tokens);
  if (!cursor.word("DROP")) return [];
  cursor.word("TEMPORARY");
  if (!cursor.word("TABLE")) return [];
  cursor.ifExists();
  return cursor.bareNameList() ?? [];
}

/**
 * The local names a list creates a table under, lower-cased — by a CREATE
 * TABLE, or by renaming a table it created — the names whose existence
 * `readLiveTables` reads. Empty for a list that cannot be read, which the
 * drop guard refuses whole.
 */
export function tablesCreatedBy(
  statements: readonly string[],
  dialect: SupportedDialect
): string[] {
  return [...(readAsIfNoTableExisted(statements, dialect)?.creating ?? [])];
}

/**
 * What a statement may begin with for `tablesLeftInPlace` to follow it: the
 * statements a generated DOWN is made of. Schema statements on indexes, types
 * and sequences change no table's existence; the table statements are the
 * ones `TableFates` follows. Data statements are listed apart
 * (`DATA_STATEMENTS`).
 */
const MODELED_STATEMENTS: readonly (readonly string[])[] = [
  ["DROP", "TABLE"],
  ["DROP", "TABLES"],
  ["DROP", "INDEX"],
  ["DROP", "TYPE"],
  ["DROP", "SEQUENCE"],
  ["ALTER", "TABLE"],
  ["ALTER", "INDEX"],
  ["ALTER", "SEQUENCE"],
  ["CREATE", "TABLE"],
  ["CREATE", "INDEX"],
  ["CREATE", "UNIQUE", "INDEX"],
  ["CREATE", "TYPE"],
  ["CREATE", "SEQUENCE"],
  ["RENAME", "TABLE"],
  ["PRAGMA", "FOREIGN_KEYS"],
  ["PRAGMA", "FOREIGN_KEY_CHECK"],
];

/**
 * Data statements, which `tablesLeftInPlace` follows only where they cannot
 * change a table: on MySQL and SQLite, whose triggers and stored functions
 * cannot run DDL, and where a SQLite rebuild copies its rows with an INSERT.
 * On PostgreSQL a trigger on the target, or a function the statement calls,
 * can run any DDL — rename the plugin's table away, say, so a later drop of
 * the name reaches nothing — and the text shows none of it, so there a data
 * statement is unmodeled.
 */
const DATA_STATEMENTS: readonly (readonly string[])[] = [
  ["INSERT"],
  ["UPDATE"],
  ["DELETE"],
];

/**
 * Whether `tablesLeftInPlace` can follow a statement: a single statement that
 * begins as one of `MODELED_STATEMENTS` — or, outside PostgreSQL, of
 * `DATA_STATEMENTS` — and names no table through a qualifier. Anything else is unmodeled, and refused: a savepoint and its
 * rollback, a procedural block whose branches may not run, a view or virtual
 * table taking a dropped table's name, a temporary table shadowing one, and
 * a qualified name such as SQLite's `temp.t`, which can reach another table
 * than the one its last part names.
 */
function modelsStatement(
  statement: string,
  dialect: SupportedDialect
): boolean {
  const tokens = soleStatementTokens(statement, dialect);
  if (tokens === undefined) return false;
  const words = tokens.map(token =>
    token.kind === "word" ? token.upper : undefined
  );
  const modeled =
    dialect === "postgresql"
      ? MODELED_STATEMENTS
      : [...MODELED_STATEMENTS, ...DATA_STATEMENTS];
  const begins = modeled.some(prefix =>
    prefix.every((word, at) => words[at] === word)
  );
  if (!begins) return false;
  return !tokens.some(
    (token, at) =>
      token.kind === "punct" &&
      token.char === "." &&
      isNameToken(tokens[at - 1]) &&
      isNameToken(tokens[at + 1])
  );
}

/**
 * A bare or quoted name: what can stand either side of a qualifier's dot. A
 * bare word starting with a digit is a number, whose decimal point is no
 * qualifier.
 */
function isNameToken(token: Token | undefined): boolean {
  if (token?.kind === "name") return true;
  return token?.kind === "word" && !/^\d/.test(token.text);
}

/** The holder of a name that a statement of the list created. */
const MADE_BY_LIST = Symbol("made by the list");

/**
 * The name a statement physically acts on. The reader names a rebuild's
 * `__new_` twin by the table it stands in for, so a rebuild cannot slip a
 * drop past the ownership checks; a twin dropped on its own drops only the
 * twin, though, and its fate is the twin's.
 */
function physicalName(table: TableRef): string {
  return "twin" in table && table.twin === true
    ? `${REBUILD_PREFIX}${table.name}`
    : table.name;
}

/**
 * Where each of a set of tables, standing before a list runs, is after each
 * statement: under which name, or dropped. Only local names are followed; a
 * qualified one may name another schema's table, so a drop of it drops
 * nothing followed here, and a rename of one moves nothing.
 */
class TableFates {
  /** Each name a statement has given a holder: a followed table, or one the list made. */
  private readonly holders = new Map<string, string | typeof MADE_BY_LIST>();
  /** Followed tables' own names that a statement has emptied. */
  private readonly vacated = new Set<string>();
  /** Followed tables the list dropped, under whatever name they then had. */
  private readonly dropped = new Set<string>();

  constructor(private readonly tables: ReadonlySet<string>) {}

  /** What stands under `name` now, if anything. */
  private holder(name: string): string | typeof MADE_BY_LIST | undefined {
    if (this.holders.has(name)) return this.holders.get(name);
    if (this.tables.has(name) && !this.vacated.has(name)) return name;
    return undefined;
  }

  private vacate(name: string): void {
    this.holders.delete(name);
    this.vacated.add(name);
  }

  /** A CREATE: a table stands under the name, unless one already did. */
  create(table: TableRef): void {
    const name = physicalName(table);
    if (!table.local || this.holder(name) !== undefined) return;
    this.holders.set(name, MADE_BY_LIST);
  }

  /** A CREATE that replaces whatever stood under the name. */
  replace(table: TableRef): void {
    this.drop(table);
    this.create(table);
  }

  drop(table: TableRef): void {
    if (!table.local) return;
    const name = physicalName(table);
    const holder = this.holder(name);
    if (holder === undefined) return;
    this.vacate(name);
    if (holder !== MADE_BY_LIST) this.dropped.add(holder);
  }

  /**
   * A rename. Whatever `from` held stands under `to` afterwards; a name not
   * followed here may still hold a table, so `to` is taken either way.
   */
  rename(from: TableRef, to: TableRef): void {
    const holder = from.local ? this.holder(physicalName(from)) : undefined;
    if (from.local) this.vacate(physicalName(from));
    if (to.local) this.holders.set(physicalName(to), holder ?? MADE_BY_LIST);
  }

  /** A table moved away from its name, to another schema: kept, elsewhere. */
  relocate(table: TableRef): void {
    if (table.local) this.vacate(physicalName(table));
  }

  /** Whether `table` was dropped, with nothing standing under its name after. */
  gone(table: string): boolean {
    return this.dropped.has(table) && this.holder(table) === undefined;
  }
}

/**
 * A `DropReader` that also follows `tables` through the list (`TableFates`).
 *
 * The reader's own records stay as they are: they answer what a list may
 * take from another owner, and read a drop by the name it is written
 * against. Each statement reaches the fates once, from the walk, however the
 * reader's methods call one another.
 */
class FollowingReader extends DropReader {
  readonly fates: TableFates;
  /** Whether a statement is one `modelsStatement` does not model. */
  holdsUnmodeledStatement = false;
  private depth = 0;

  constructor(dialect: SupportedDialect, tables: ReadonlySet<string>) {
    super(dialect, new Set());
    this.fates = new TableFates(tables);
  }

  /**
   * Also takes the name every CREATE TABLE names, which the walk does not
   * report for a rebuild's twin or under `IF NOT EXISTS`: either puts a table
   * under the name when none stands there.
   */
  override read(statement: string): void {
    super.read(statement);
    if (!modelsStatement(statement, this.dialect)) {
      this.holdsUnmodeledStatement = true;
    }
    const created = tableNamedByCreate(statement, this.dialect);
    if (created !== undefined)
      this.fates.create({ name: created, local: true });
  }

  /** Runs `follow` for a call from the walk, not for one the reader nests. */
  private step<T>(follow: () => void, read: () => T): T {
    if (this.depth === 0) follow();
    this.depth += 1;
    try {
      return read();
    } finally {
      this.depth -= 1;
    }
  }

  override create(table: TableRef): void {
    this.step(
      () => this.fates.create(table),
      () => super.create(table)
    );
  }

  override replace(table: TableRef): void {
    this.step(
      () => this.fates.replace(table),
      () => super.replace(table)
    );
  }

  override drop(table: TableRef): void {
    this.step(
      () => this.fates.drop(table),
      () => super.drop(table)
    );
  }

  override rename(from: TableRef, to: TableRef): void {
    this.step(
      () => this.fates.rename(from, to),
      () => super.rename(from, to)
    );
  }

  override relocate(table: TableRef): string {
    return this.step(
      () => this.fates.relocate(table),
      () => super.relocate(table)
    );
  }

  /**
   * PostgreSQL's `ALTER INDEX ... RENAME`, which renames a table too: the
   * table moves to a name not read here, keeping its rows.
   */
  override renameRelation(name: string): void {
    this.step(
      () => this.fates.relocate({ name, local: true }),
      () => super.renameRelation(name)
    );
  }
}

/**
 * Of `tables`, those a statement list leaves in place: run in order, it does
 * not drop the table under any name it is renamed to, or it leaves a table
 * standing under the name once it has finished. Lower-cased, as `tables`
 * holds them.
 *
 * Each table is followed through the list's renames: renamed away and kept,
 * it is left, however many drops of its old name follow; renamed away and
 * then dropped, it is gone. A rebuild is read as the drop and the rename back
 * it is, so it leaves the table in place.
 *
 * Every table counts as left when the list holds a statement this reading
 * does not model (`modelsStatement`), or one that may change which table an
 * unqualified name reaches: what it drops is then not known, and an uninstall
 * is refused rather than run on a guess. The reading models the statements a
 * plugin's generated DOWN is made of, and refuses the rest by kind rather
 * than by exception, so a form nobody listed is refused, not trusted. On
 * PostgreSQL that includes a data statement, which may run DDL through a
 * trigger or a function it calls; no generated PostgreSQL DOWN holds one.
 */
export function tablesLeftInPlace(
  statements: readonly string[],
  dialect: SupportedDialect,
  tables: readonly string[]
): string[] {
  const reader = new FollowingReader(dialect, new Set(tables));
  try {
    readWith(statements, reader, new Map());
  } catch (error) {
    if (error instanceof UnparsableDropTarget) return [...tables];
    throw error;
  }
  if (reader.resolutionMayChange || reader.holdsUnmodeledStatement) {
    return [...tables];
  }
  return tables.filter(table => !reader.fates.gone(table));
}

/**
 * A statement list read as if no table existed — so a creation's credit
 * carries through a rename to the name it is renamed to — or undefined when
 * the list cannot be read; the guard refuses such a list on its own.
 */
function readAsIfNoTableExisted(
  statements: readonly string[],
  dialect: SupportedDialect,
  vacatedBefore?: Iterable<string>
): DropReader | undefined {
  const reader = new DropReader(dialect, new Set(), vacatedBefore);
  try {
    readWith(statements, reader, new Map());
  } catch (error) {
    if (error instanceof UnparsableDropTarget) return undefined;
    throw error;
  }
  return reader;
}

/**
 * The table a `CREATE [TEMPORARY] TABLE [IF NOT EXISTS]` statement names, as
 * written and lower-cased — a rebuild's `__new_` copy under its own name, not
 * the table it stands in for — or undefined when the statement creates no
 * table or cannot be read. A qualified name gives its last part.
 */
export function tableNamedByCreate(
  statement: string,
  dialect: SupportedDialect
): string | undefined {
  const head = createTableHead(statement, dialect);
  return head && lastNamePart(head.tokens, head.nameAt);
}

/**
 * Whether a statement is a `CREATE TABLE` read as creating its table EMPTY:
 * a body of columns and constraints followed by table options alone, a copy
 * of another table's definition (`LIKE`), a partition or a typed table
 * (`PARTITION OF`, `OF`), or PostgreSQL's query closed by `WITH NO DATA`.
 *
 * False for anything else, a statement it cannot read included, so a create
 * that fills its table is never taken for one that does not: a table built
 * from a query copies the query's rows, which no schema snapshot shows, and
 * the spellings are many — `AS SELECT`, `AS TABLE`, `AS VALUES` and `AS
 * EXECUTE` on PostgreSQL, `SELECT`, `TABLE` or `VALUES` after MySQL's body or
 * a parenthesised query in its place. An `AS` or `SELECT` inside the body is
 * a column's own clause (`GENERATED ALWAYS AS`), not a query.
 */
export function createsEmptyTable(
  statement: string,
  dialect: SupportedDialect
): boolean {
  const head = createTableHead(statement, dialect);
  if (head === undefined) return false;
  const { tokens, word } = head;
  const last = tokens.length - 1;
  if (
    word(last - 2) === "WITH" &&
    word(last - 1) === "NO" &&
    word(last) === "DATA"
  ) {
    return true;
  }
  const at = nameEnd(tokens, head.nameAt) + 1;
  // A copy of another table's definition, a typed table or a partition.
  const first = word(at);
  if (first === "LIKE" || first === "OF") return true;
  if (first === "PARTITION" && word(at + 1) === "OF") return true;
  return (
    isPunct(tokens[at], "(") &&
    !opensQuery(tokens, at + 1, word) &&
    !queryAfterBody(tokens, at, word)
  );
}

/**
 * Whether a query follows the body opening at `open`: past the body, rows can
 * only come from one — a word that starts it, or a parenthesised one.
 */
function queryAfterBody(
  tokens: readonly Token[],
  open: number,
  word: (at: number) => string | undefined
): boolean {
  for (const k of topLevelAfter(tokens, open)) {
    if (isPunct(tokens[k], "(") && opensQuery(tokens, k + 1, word)) {
      return true;
    }
    if (ROW_SOURCES.has(word(k) ?? "")) return true;
  }
  return false;
}

/**
 * The positions of the tokens after the parenthesised group opening at
 * `open` that stand outside every parenthesis, an opening one included.
 */
function* topLevelAfter(
  tokens: readonly Token[],
  open: number
): Generator<number> {
  let depth = 0;
  for (let k = open; k < tokens.length; k += 1) {
    if (depth === 0 && k > open) yield k;
    if (isPunct(tokens[k], "(")) depth += 1;
    else if (isPunct(tokens[k], ")")) depth -= 1;
  }
}

/**
 * The words after a `CREATE TABLE`'s body that bring rows with them: the
 * query it is created from, however it is introduced.
 */
const ROW_SOURCES = new Set(["AS", "SELECT", "TABLE", "VALUES"]);

/**
 * Whether the tokens from `at` open a query, parenthesised or not. A
 * parenthesis opens one only if what it holds does: a parenthesised
 * expression, as an expression partition key is written, is no query.
 */
function opensQuery(
  tokens: readonly Token[],
  at: number,
  word: (at: number) => string | undefined
): boolean {
  if (isPunct(tokens[at], "(")) return opensQuery(tokens, at + 1, word);
  const first = word(at);
  return (
    first === "SELECT" ||
    first === "WITH" ||
    first === "VALUES" ||
    first === "TABLE"
  );
}

/** Whether a token is the punctuation `char`. */
function isPunct(token: Token | undefined, char: string): boolean {
  return token?.kind === "punct" && token.char === char;
}

/** Whether a token is the word `upper`, compared upper-cased. */
function isWord(token: Token | undefined, upper: string): boolean {
  return token?.kind === "word" && token.upper === upper;
}

/**
 * A `CREATE [TEMPORARY] TABLE [IF NOT EXISTS]` statement's tokens and where
 * its table's name starts, or undefined when the statement creates no table
 * or cannot be read.
 */
function createTableHead(
  statement: string,
  dialect: SupportedDialect
):
  | {
      tokens: Token[];
      word: (at: number) => string | undefined;
      nameAt: number;
    }
  | undefined {
  const read = soleStatementWords(statement, dialect);
  if (read === undefined || read.word(0) !== "CREATE") return undefined;
  const { word } = read;
  let k = 1;
  while (CREATE_TABLE_MODIFIERS.has(word(k) ?? "")) k += 1;
  if (word(k) !== "TABLE") return undefined;
  k += 1;
  if (word(k) === "IF" && word(k + 1) === "NOT" && word(k + 2) === "EXISTS") {
    k += 3;
  }
  return { ...read, nameAt: k };
}

/**
 * One statement's tokens and an upper-cased reading of the word at each, or
 * undefined when it holds more than one statement or cannot be read.
 */
function soleStatementWords(
  statement: string,
  dialect: SupportedDialect
): { tokens: Token[]; word: (at: number) => string | undefined } | undefined {
  const tokens = soleStatementTokens(statement, dialect);
  if (tokens === undefined) return undefined;
  return {
    tokens,
    word: at => {
      const token = tokens[at];
      return token?.kind === "word" ? token.upper : undefined;
    },
  };
}

/** The last part of a possibly qualified name starting at `at`, lower-cased. */
function lastNamePart(
  tokens: readonly Token[],
  at: number
): string | undefined {
  return writtenName(tokens[nameEnd(tokens, at)])?.toLowerCase();
}

/** Where a possibly qualified name starting at `at` ends: its last part. */
function nameEnd(tokens: readonly Token[], at: number): number {
  let k = at;
  while (isPunct(tokens[k + 1], ".")) k += 2;
  return k;
}

/**
 * The table an `INSERT` or `REPLACE` statement writes into, lower-cased, or
 * undefined when the statement is not one, writes through no `INTO`, or
 * cannot be read. SQLite's `INSERT OR <conflict> INTO` and MySQL's `INSERT
 * IGNORE INTO` are read too; a qualified name gives its last part.
 */
export function tableInsertedInto(
  statement: string,
  dialect: SupportedDialect
): string | undefined {
  const read = soleStatementWords(statement, dialect);
  if (read === undefined) return undefined;
  const { tokens, word } = read;
  if (word(0) !== "INSERT" && word(0) !== "REPLACE") return undefined;
  let k = 1;
  if (word(k) === "OR") k += 2;
  if (word(k) === "IGNORE") k += 1;
  if (word(k) !== "INTO") return undefined;
  return lastNamePart(tokens, k + 1);
}

/**
 * One reading of a statement list: the tables it drops and the tables it
 * renames or moves away, from the same walk, so the two can never be read
 * under different rules.
 */
function readStatements(
  statements: readonly string[],
  dialect: SupportedDialect,
  liveColumns: LiveColumns | undefined,
  liveTables: LiveTables | undefined,
  liveElements?: LiveElements
): Reading {
  // A block keeps its table only where the table's live indexes and
  // constraints were read too: what the block leaves out of them is judged
  // (`elementsLeftOut`), and without them it is read as the drop it then is.
  const kept = keptTables(
    followColumns(statements, dialect, liveColumns).blocks.filter(
      block => liveElements?.has(block.table) ?? false
    )
  );
  const vacated = liveTables?.vacated ?? [];
  const reading = readWith(
    statements,
    new DropReader(dialect, liveTables, vacated),
    kept
  );
  // A list that may change which table an unqualified name reaches is read
  // again trusting neither what it creates nor its rebuild blocks: after
  // `SET search_path = scratch`, an unqualified CREATE, a rebuild's twin and
  // its rename back all land in `scratch`, while a DROP of a name `scratch`
  // lacks still reaches the table it always did. The whole list loses the
  // credit, not just what follows the change, because a creation before it
  // is dropped by a name that afterwards may reach another table.
  return reading.resolutionMayChange
    ? readWith(
        statements,
        new DropReader(dialect, undefined, vacated),
        new Map()
      )
    : reading;
}

/** What `assertNoForeignDrops` judges of one reading of a statement list. */
type Reading = Pick<
  DropReader,
  | "dropped"
  | "renamed"
  | "columns"
  | "alteredColumns"
  | "elements"
  | "alteredElements"
  | "unmodelled"
  | "unreadOnElements"
  | "addedColumns"
  | "addedElements"
  | "alterTargets"
  | "qualifiedTargets"
  | "resolutionMayChange"
  | "rebuilt"
  | "relationRenames"
  | "changed"
  | "reaching"
  | "lookupsAfterVacating"
  | "typesCascaded"
>;

/**
 * Reads every statement of a list with `reader`, a rebuild block that keeps
 * its table (`kept`) read as the columns it drops.
 */
function readWith(
  statements: readonly string[],
  reader: DropReader,
  kept: ReadonlyMap<number, KeptTable>
): DropReader {
  statements.forEach((statement, index) => {
    const block = kept.get(index);
    if (block === undefined) {
      reader.read(statement);
      return;
    }
    // A rebuild's DROP and rename keep the table; what it does take are the
    // live columns its twin leaves out, judged as the column drops they are,
    // and the indexes and constraints it does not put back
    // (`elementsLeftOut`).
    if (block.dropAt !== index) return;
    for (const column of block.droppedColumns) {
      reader.takeColumn({ name: block.table, local: true }, column);
    }
    reader.keepTable(block.table, block.recreated);
  });
  return reader;
}

/**
 * The rebuild blocks that keep their table, by the index of each of their
 * DROP and rename statements.
 */
function keptTables(
  blocks: readonly KeptTable[]
): ReadonlyMap<number, KeptTable> {
  return new Map(
    blocks.flatMap(block => [
      [block.dropAt, block],
      [block.dropAt + 1, block],
    ])
  );
}

/**
 * A statement's tokens, or undefined when it holds more than one statement
 * or cannot be read — neither can be part of a rebuild block.
 */
function soleStatementTokens(
  statement: string,
  dialect: SupportedDialect
): Token[] | undefined {
  let tokens: Token[];
  try {
    tokens = new Lexer(dialect, statement).tokens(statement);
  } catch (error) {
    if (error instanceof UnparsableDropTarget) return undefined;
    throw error;
  }
  while (tokens.at(-1)?.kind === "end") tokens.pop();
  return tokens.some(token => token.kind === "end") ? undefined : tokens;
}

/** Reads one statement's tokens in order, consuming what matches. */
class TokenCursor {
  private at = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  /** Consumes the next token when it is `word`. */
  word(word: string): boolean {
    const token = this.tokens[this.at];
    if (token?.kind !== "word" || token.upper !== word) return false;
    this.at += 1;
    return true;
  }

  /** Consumes the next token when it is the punctuation `char`. */
  punct(char: string): boolean {
    const token = this.tokens[this.at];
    if (token?.kind !== "punct" || token.char !== char) return false;
    this.at += 1;
    return true;
  }

  /** Consumes `IF EXISTS` / `IF NOT EXISTS` when present. */
  ifExists(): void {
    const start = this.at;
    if (!this.word("IF")) return;
    this.word("NOT");
    if (!this.word("EXISTS")) this.at = start;
  }

  /**
   * Consumes one unqualified name, lower-cased. Undefined for a qualified one:
   * which table `scratch.t` reaches is not what `t` reaches, so a rebuild
   * block spelled with one is not recognised, and a statement naming one
   * stops the tables' columns being followed.
   */
  name(): string | undefined {
    const name = this.part();
    return name === undefined || this.punct(".") ? undefined : name;
  }

  /** Consumes `( a, b, ... )`: the names, or undefined when it is not one. */
  nameList(): string[] | undefined {
    if (!this.punct("(")) return undefined;
    const names: string[] = [];
    do {
      const name = this.name();
      if (name === undefined) return undefined;
      names.push(name);
    } while (this.punct(","));
    return this.punct(")") ? names : undefined;
  }

  /** Consumes `a, b, ...` with no parentheses. */
  bareNameList(): string[] | undefined {
    const names: string[] = [];
    do {
      const name = this.name();
      if (name === undefined) return undefined;
      names.push(name);
    } while (this.punct(","));
    return names;
  }

  /**
   * Consumes a parenthesised CREATE TABLE body: the names of its columns,
   * skipping table constraints, or undefined when it is not one.
   */
  columnDefinitions(): string[] | undefined {
    if (!this.punct("(")) return undefined;
    const columns: string[] = [];
    for (;;) {
      if (!this.peekWord(TABLE_CONSTRAINT_WORDS)) {
        const column = this.part();
        if (column === undefined) return undefined;
        columns.push(column);
      }
      const ending = this.itemEnd();
      if (ending !== ",") return ending === ")" ? columns : undefined;
    }
  }

  /**
   * Consumes the rest of one item of a parenthesised list, and the comma or
   * closing parenthesis outside any nested parentheses that ends it: which
   * of the two, or undefined when the tokens run out first.
   */
  private itemEnd(): "," | ")" | undefined {
    let depth = 0;
    for (;;) {
      const token = this.tokens[this.at];
      if (token === undefined) return undefined;
      this.at += 1;
      if (token.kind !== "punct") continue;
      const ending = depth === 0 ? itemEnding(token.char) : undefined;
      if (ending !== undefined) return ending;
      depth += NESTING.get(token.char) ?? 0;
    }
  }

  get done(): boolean {
    return this.at === this.tokens.length;
  }

  /** Whether the next token is one of `words`, without consuming it. */
  peekWord(words: ReadonlySet<string>): boolean {
    const token = this.tokens[this.at];
    return token?.kind === "word" && words.has(token.upper);
  }

  /** Whether a comma outside parentheses follows: a second clause. */
  hasTopLevelComma(): boolean {
    let depth = 0;
    for (let k = this.at; k < this.tokens.length; k += 1) {
      const token = this.tokens[k];
      if (token.kind !== "punct") continue;
      if (token.char === "(") depth += 1;
      else if (token.char === ")") depth -= 1;
      else if (token.char === "," && depth === 0) return true;
    }
    return false;
  }

  private part(): string | undefined {
    const name = writtenName(this.tokens[this.at]);
    if (name === undefined) return undefined;
    this.at += 1;
    return name.toLowerCase();
  }
}

/** The punctuation that ends an item of a parenthesised list, if `char` is. */
function itemEnding(char: string): "," | ")" | undefined {
  return char === "," || char === ")" ? char : undefined;
}

/** How a parenthesis changes the nesting depth of a list item. */
const NESTING: ReadonlyMap<string, number> = new Map([
  ["(", 1],
  [")", -1],
]);

/** Words that open a table constraint rather than a column definition. */
const TABLE_CONSTRAINT_WORDS = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "FOREIGN",
  "UNIQUE",
  "CHECK",
]);

/** A rebuild's twin name for `table`. */
const REBUILD_PREFIX = "__new_";

/**
 * The indexes of the statements, within a statement list, that belong to a
 * COMPLETE table rebuild — the `DROP TABLE t` and the rename of the twin
 * back to `t` — and so do not take `t` from its owner.
 *
 * SQLite changes a table's constraints by rebuilding it, as four adjacent
 * statements, each a statement of its own:
 *
 *     CREATE TABLE __new_t (c1 ..., c2 ..., <constraints>)
 *     INSERT INTO __new_t (c1, c2) SELECT c1, c2 FROM t
 *     DROP TABLE t
 *     ALTER TABLE __new_t RENAME TO t
 *
 * The copy has to fill every column the twin declares from the same-named
 * column of `t`, with nothing after the FROM — no filter, no join — so the
 * rows `t` held are the rows it holds afterwards, under its own name. A DROP
 * or a rename outside such a block, a block out of order, a copy that
 * filters or reorders, or a twin renamed to another name is not one, and is
 * read as the drop or rename it is. So is the block on any dialect but
 * SQLite, the only one the pipeline writes it for (`rebuildBlockAt`).
 *
 * The text alone cannot say whether the twin keeps every column `t` has, so
 * the block counts only against `t`'s LIVE columns: every one of them has to
 * be declared by the twin, and so copied. A twin missing one drops that
 * column, so its block is not named here; the drop guard reads such a block
 * as the column drops it is (`keptBy`). A table whose live columns were not
 * read leaves the block read as the drop of `t` it then is.
 */
export function rebuildBlockStatements(
  statements: readonly string[],
  dialect: SupportedDialect,
  liveColumns: LiveColumns | undefined
): ReadonlySet<number> {
  return new Set(
    followColumns(statements, dialect, liveColumns)
      .blocks.filter(block => block.droppedColumns.length === 0)
      .flatMap(block => [block.dropAt, block.dropAt + 1])
  );
}

/**
 * The columns each table in `liveColumns` has once `statements` have run —
 * for judging the next unit of a run against the state this one leaves.
 */
export function columnsAfter(
  statements: readonly string[],
  dialect: SupportedDialect,
  liveColumns: LiveColumns
): LiveColumns {
  return followColumns(statements, dialect, liveColumns).after;
}

/**
 * Walks a statement list with the tables' columns in hand: a rebuild block is
 * judged against the columns its table has at that point (`keptBy`), and
 * single-clause `ALTER TABLE ... ADD|DROP|RENAME COLUMN` statements before it
 * move those columns as the database would.
 *
 * A statement on a tracked table that is not one of those — a multi-clause
 * ALTER, an ADD or DROP of something other than a column, any other ALTER,
 * or a DROP or CREATE of the table outside a block — stops the table being
 * tracked: its columns are then unknown, and a later rebuild of it counts as
 * a drop, as one whose columns were never read does. A statement list entry
 * holding more than one statement, or one that cannot be read, stops every
 * table being tracked.
 */
function followColumns(
  statements: readonly string[],
  dialect: SupportedDialect,
  liveColumns: LiveColumns | undefined
): { blocks: KeptTable[]; after: LiveColumns } {
  const columns = new Map(
    [...(liveColumns ?? [])].map(([table, set]) => [table, new Set(set)])
  );
  const blocks: KeptTable[] = [];
  for (let i = 0; i < statements.length; i += 1) {
    const block = rebuildBlockAt(statements, i, dialect);
    if (block) {
      const kept = keptBy(
        { ...block, recreated: recreatedBy(block, statements, i + 4, dialect) },
        columns.get(block.table),
        i + 2
      );
      if (kept) blocks.push(kept);
      if (columns.has(block.table)) {
        columns.set(block.table, new Set(block.columns));
      }
      i += 3;
      continue;
    }
    const tokens = soleStatementTokens(statements[i], dialect);
    if (tokens) followColumnChange(tokens, columns);
    else columns.clear();
  }
  return { blocks, after: columns };
}

/**
 * A complete rebuild block that keeps its table: the index of its DROP (the
 * rename back follows it), the table, and the live columns the twin leaves
 * out — which the block drops, as a column drop on any dialect does.
 */
interface KeptTable {
  dropAt: number;
  table: string;
  droppedColumns: string[];
  recreated: Recreated;
}

/**
 * A table's indexes, foreign keys and checks — those it has in the
 * database, or those a rebuild block puts back on it — by the element row
 * kind each is recorded under, lower-cased.
 */
export interface TableElements {
  index: ReadonlySet<string>;
  fk: ReadonlySet<string>;
  check: ReadonlySet<string>;
}

/**
 * What a rebuild block puts back on its table: the indexes, foreign keys and
 * checks (`recreatedBy`), and the shape its twin declares (`twinShape`).
 */
interface Recreated extends TableElements {
  shape: TableShape;
}

/** A table a complete rebuild block keeps, and what the block puts back. */
interface RebuiltTable {
  table: string;
  recreated: Recreated;
}

/**
 * A column as a rebuild must keep it: its declared type, whether it is
 * declared NOT NULL, and its default, the type and default as `fingerprint`
 * spells them.
 */
interface ColumnShape {
  type: string | undefined;
  notNull: boolean;
  default: string | undefined;
}

/**
 * What a SQLite rebuild can take from a table while keeping its rows, its
 * columns and its named elements: the primary key, the unique constraints,
 * and each column's declared type, NOT NULL and default. Column names
 * lower-cased; the key's columns sorted, and each unique constraint's columns
 * sorted and joined by commas.
 */
export interface TableShape {
  columns: ReadonlyMap<string, ColumnShape>;
  primaryKey: readonly string[];
  unique: ReadonlySet<string>;
}

/** A live table's shape, and how many triggers are on it. */
export interface LiveTableShape extends TableShape {
  triggers: number;
}

/**
 * Whether a complete rebuild block keeps its table, judged against the
 * columns the table has where the block starts.
 *
 * The copy fills every column the twin declares from the same-named column of
 * the table, so when each of them is a live column the rows survive under the
 * table's own name: the block keeps the table and drops the live columns the
 * twin leaves out. That is how SQLite removes a column it cannot drop in
 * place, such as one a check constraint names. A twin declaring a column the
 * table does not have, or a table whose live columns were not read, leaves
 * nothing to compare the copy against, and the block is the drop of the table
 * it then is.
 */
function keptBy(
  block: {
    table: string;
    columns: readonly string[];
    recreated: Recreated;
  },
  live: ReadonlySet<string> | undefined,
  dropAt: number
): KeptTable | undefined {
  if (live === undefined || live.size === 0) return undefined;
  if (!block.columns.every(column => live.has(column))) return undefined;
  const declared = new Set(block.columns);
  return {
    dropAt,
    table: block.table,
    droppedColumns: [...live].filter(column => !declared.has(column)),
    recreated: block.recreated,
  };
}

/**
 * What a rebuild block puts back on its table: the foreign keys and checks
 * its twin declares under a name, and the indexes the `CREATE INDEX`
 * statements directly after the rename create on the table, as the pipeline
 * writes them (`sqliteTableRebuildStatements`). Dropping the old table took
 * every index and constraint it had, so anything else is gone afterwards.
 *
 * Only a name counts, matched against the element rows' names. An unnamed
 * constraint and an inline `UNIQUE`, which SQLite backs with an index it
 * names itself, put back no element any row records; an index created
 * anywhere later in the list is not counted, so a block that relies on one
 * is judged as taking it.
 */
function recreatedBy(
  block: {
    table: string;
    constraints: ReadonlyMap<string, "fk" | "check">;
    shape: TableShape;
  },
  statements: readonly string[],
  from: number,
  dialect: SupportedDialect
): Recreated {
  const index = new Set<string>();
  for (let k = from; k < statements.length; k += 1) {
    const tokens = soleStatementTokens(statements[k], dialect);
    const created = tokens && indexCreatedOn(tokens);
    if (created === undefined || created.table !== block.table) break;
    index.add(created.index);
  }
  const named = (kind: "fk" | "check") =>
    new Set(
      [...block.constraints]
        .filter(([, constraint]) => constraint === kind)
        .map(([name]) => name)
    );
  return {
    index,
    fk: named("fk"),
    check: named("check"),
    shape: block.shape,
  };
}

/**
 * The index and table of `CREATE [UNIQUE] INDEX [IF NOT EXISTS] i ON t (`,
 * both unqualified, or undefined when the statement is not one. `IF NOT
 * EXISTS` still creates the index after a rebuild: index names are unique
 * in the schema, and the drop took the one of that name with its table.
 */
function indexCreatedOn(
  tokens: readonly Token[]
): { index: string; table: string } | undefined {
  const creating = new TokenCursor(tokens);
  if (!creating.word("CREATE")) return undefined;
  creating.word("UNIQUE");
  if (!creating.word("INDEX")) return undefined;
  creating.ifExists();
  const index = creating.name();
  if (index === undefined || !creating.word("ON")) return undefined;
  const table = creating.name();
  if (table === undefined || !creating.punct("(")) return undefined;
  return { index, table };
}

/** Words after ADD or DROP that name something other than a column. */
const NON_COLUMN_ELEMENTS = new Set([
  "CONSTRAINT",
  "INDEX",
  "KEY",
  "FOREIGN",
  "PRIMARY",
  "UNIQUE",
  "CHECK",
  "DEFAULT",
  "NOT",
  "FULLTEXT",
  "SPATIAL",
  "PARTITION",
]);

/**
 * Applies one statement's effect on the tracked tables' columns: a
 * single-clause `ALTER TABLE t ADD [COLUMN] c`, `DROP [COLUMN] c` or
 * `RENAME [COLUMN] a TO b` moves them; anything else that touches a tracked
 * table stops it being tracked.
 */
function followColumnChange(
  tokens: readonly Token[],
  columns: Map<string, Set<string>>
): void {
  const cursor = new TokenCursor(tokens);
  if (cursor.word("DROP") || cursor.word("CREATE")) {
    forgetTable(cursor, columns);
    return;
  }
  if (!cursor.word("ALTER") || !cursor.word("TABLE")) return;
  followAlterTable(cursor, columns);
}

/**
 * A tracked table dropped or created outside a rebuild block, from past the
 * DROP or CREATE: whatever it holds afterwards is not what was read, so it
 * stops being tracked.
 */
function forgetTable(
  cursor: TokenCursor,
  columns: Map<string, Set<string>>
): void {
  // MariaDB's `CREATE OR REPLACE TABLE` replaces the table as a DROP and a
  // CREATE of it would.
  if (cursor.word("OR")) cursor.word("REPLACE");
  cursor.word("TEMPORARY");
  if (!cursor.word("TABLE")) return;
  cursor.ifExists();
  const table = cursor.name();
  if (table === undefined) columns.clear();
  else columns.delete(table);
}

/**
 * An `ALTER TABLE` of a tracked table, from past `ALTER TABLE`: its one
 * column clause moves the table's columns, and anything else stops the
 * table being tracked.
 */
function followAlterTable(
  cursor: TokenCursor,
  columns: Map<string, Set<string>>
): void {
  cursor.ifExists();
  cursor.word("ONLY");
  const table = cursor.name();
  if (table === undefined) {
    columns.clear();
    return;
  }
  // PostgreSQL's `*` after the name alters the table itself as well.
  cursor.punct("*");
  const set = columns.get(table);
  if (set !== undefined && !applyColumnClause(cursor, set)) {
    columns.delete(table);
  }
}

/**
 * Applies the one clause after `ALTER TABLE t` to `set`, returning whether it
 * was a column change this understands — false for anything else, including
 * a second clause.
 */
function applyColumnClause(cursor: TokenCursor, set: Set<string>): boolean {
  const adding = cursor.word("ADD");
  if (adding || cursor.word("DROP")) return applyAddOrDrop(cursor, set, adding);
  if (cursor.word("RENAME")) return applyColumnRename(cursor, set);
  return false;
}

/**
 * `ADD [COLUMN] [IF [NOT] EXISTS] c` or `DROP [COLUMN] [IF EXISTS] c`, from
 * past the ADD or DROP, as the only clause of its statement.
 */
function applyAddOrDrop(
  cursor: TokenCursor,
  set: Set<string>,
  adding: boolean
): boolean {
  if (cursor.peekWord(NON_COLUMN_ELEMENTS)) return false;
  cursor.word("COLUMN");
  cursor.ifExists();
  const column = cursor.name();
  if (column === undefined || cursor.hasTopLevelComma()) return false;
  if (adding) set.add(column);
  else set.delete(column);
  return true;
}

/** Words after RENAME that rename the table rather than a column. */
const TABLE_RENAME_WORDS = new Set(["TO", "AS"]);

/**
 * `RENAME [COLUMN] a TO b`, from past the RENAME, as the whole rest of the
 * statement, of a column the table has.
 */
function applyColumnRename(cursor: TokenCursor, set: Set<string>): boolean {
  if (cursor.peekWord(TABLE_RENAME_WORDS)) return false;
  cursor.word("COLUMN");
  const from = cursor.name();
  if (from === undefined || !cursor.word("TO")) return false;
  const to = cursor.name();
  if (to === undefined || !cursor.done || !set.delete(from)) return false;
  set.add(to);
  return true;
}

/**
 * The tables the statement list rebuilds in blocks of that shape — the
 * tables whose live columns `rebuildBlockStatements` needs.
 */
export function rebuiltTables(
  statements: readonly string[],
  dialect: SupportedDialect
): string[] {
  const tables = new Set<string>();
  for (let i = 0; i + 3 < statements.length; i += 1) {
    const block = rebuildBlockAt(statements, i, dialect);
    if (block) tables.add(block.table);
  }
  return [...tables];
}

/**
 * The indexes of the statements, within a statement list, that copy a table's
 * rows into its rebuild twin in a block of that shape: rows that were the
 * table's before the block and are its again after it.
 */
export function rebuildCopyStatements(
  statements: readonly string[],
  dialect: SupportedDialect
): ReadonlySet<number> {
  const copies = new Set<number>();
  for (let i = 0; i + 3 < statements.length; i += 1) {
    if (rebuildBlockAt(statements, i, dialect)) copies.add(i + 1);
  }
  return copies;
}

/** A table's live columns, lower-cased, by lower-cased table name. */
export type LiveColumns = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * The live columns of every table the statement lists rebuild, read from the
 * database the statements are about to run on — what `assertNoForeignDrops`
 * and `rebuildBlockStatements` compare a rebuild's twin against.
 */
export function readLiveColumns(
  db: unknown,
  dialect: SupportedDialect,
  statementLists: ReadonlyArray<readonly string[]>
): Promise<LiveColumns> {
  return liveColumnsOf(
    db,
    dialect,
    statementLists.flatMap(list => rebuiltTables(list, dialect))
  );
}

/**
 * Each table's live indexes, foreign keys and checks, and its shape
 * (`LiveTableShape`), by lower-cased name. Without a shape, a rebuild of the
 * table that does not hold it is refused (`shapeKept`).
 */
export type LiveElements = ReadonlyMap<
  string,
  TableElements & { shape?: LiveTableShape }
>;

/**
 * The live indexes, foreign keys and checks of every table the statement
 * lists rebuild, read from the database they are about to run on — what
 * `assertNoForeignDrops` judges a rebuild that keeps its table against: the
 * block drops the old table with all of them, and puts back only its own.
 * Read through the introspection the schema diff uses, so on SQLite an
 * index SQLite made for an inline `UNIQUE` and a check declared without a
 * name are not among them, and a foreign key declared without a name is
 * named by the rule the diff names it by.
 */
export async function readLiveElements(
  db: unknown,
  dialect: SupportedDialect,
  statementLists: ReadonlyArray<readonly string[]>
): Promise<LiveElements> {
  const tables = [
    ...new Set(statementLists.flatMap(list => rebuiltTables(list, dialect))),
  ];
  if (tables.length === 0) return new Map();
  const { introspectLiveSnapshot, introspectSqliteRebuildLosses } =
    await import("../pipeline/diff/introspect-live");
  const snapshot = await introspectLiveSnapshot(db, dialect, tables);
  const losses = await introspectSqliteRebuildLosses(db, tables);
  const names = (elements: ReadonlyArray<{ name: string }> | undefined) =>
    new Set((elements ?? []).map(element => element.name.toLowerCase()));
  return new Map(
    snapshot.tables.map(table => {
      const name = table.name.toLowerCase();
      return [
        name,
        {
          index: names(table.indexes),
          fk: names(table.foreignKeys),
          check: names(table.checks),
          shape: liveShape(table, losses.get(name)),
        },
      ];
    })
  );
}

/**
 * A live table's shape, from its introspected columns and what the snapshot
 * leaves out (`introspectSqliteRebuildLosses`); undefined when that was not
 * read, so a rebuild of the table is judged as losing it.
 */
function liveShape(
  table: TableSpec,
  losses: { unique: string[][]; triggers: number } | undefined
): LiveTableShape | undefined {
  if (losses === undefined) return undefined;
  return {
    columns: new Map(
      table.columns.map(column => [
        column.name.toLowerCase(),
        {
          type: fingerprintOf(column.type),
          notNull: !column.nullable,
          default:
            column.default === undefined
              ? undefined
              : fingerprintOf(column.default),
        },
      ])
    ),
    primaryKey: table.columns
      .filter(column => column.primaryKey === true)
      .map(column => column.name.toLowerCase())
      .sort(),
    unique: new Set(losses.unique.map(columnSetKey)),
    triggers: losses.triggers,
  };
}

/**
 * The tables standing before a statement list runs, as the guard reads them
 * (`readLiveTables`): which of the names the list creates or renames through
 * `ALTER INDEX` are tables already, and on PostgreSQL, `descendants`.
 */
export type LiveTables = ReadonlySet<string> & {
  /**
   * Each table a statement of the list acts on that has descendants, by
   * lower-cased name: every table inheriting from it and every partition of
   * it, at any depth, lower-cased. Absent where it was not read.
   */
  readonly descendants?: ReadonlyMap<string, readonly string[]>;
  /**
   * Relation names an earlier statement list of the same run dropped,
   * renamed or moved away and did not fill again (`liveTablesAfter`). The
   * live lookups were made before that list ran, so a later list looking one
   * of these up is refused, as a later statement of the same list is.
   */
  readonly vacated?: ReadonlySet<string>;
};

/**
 * The live tables as a later statement list finds them once `statements`
 * have run: the tables they create added, and the descendants kept and
 * carried through the tables they rename, so a later list naming a table by
 * its new name is judged against the descendants it had. A list creating or
 * renaming tables cannot shrink the inheritance tree; a list that cannot be
 * read adds nothing, and the guard refuses it on its own.
 */
export function liveTablesAfter(
  tables: LiveTables,
  statements: readonly string[],
  dialect: SupportedDialect
): LiveTables {
  const reading = readAsIfNoTableExisted(statements, dialect, tables.vacated);
  const descendants = new Map(tables.descendants ?? []);
  for (const [current, original] of reading?.renames ?? []) {
    const below = descendants.get(original);
    if (below !== undefined) descendants.set(current, below);
  }
  return Object.assign(new Set([...tables, ...(reading?.creating ?? [])]), {
    descendants,
    // A list that cannot be read keeps what was vacated before it; the guard
    // refuses it on its own.
    vacated: reading?.stillVacated ?? tables.vacated,
  });
}

/**
 * Which of the tables the statement lists create, and of the names
 * PostgreSQL's `ALTER INDEX ... RENAME` renames in them, exist already as
 * tables, read from the database the statements are about to run on — the
 * tables `assertNoForeignDrops` credits no creation of, and the names it
 * judges such a rename of as a table's (`liveTables`). Read through the
 * introspection `readLiveColumns` uses, so on PostgreSQL a table counts when
 * an unqualified name reaches it, wherever the search path finds it.
 *
 * On PostgreSQL it also reads the descendants of every table a statement
 * acts on in a way that reaches them (`DropReader.reaching`), from the
 * catalog's inheritance records (`introspectDescendants`): the statements
 * name none of them.
 */
export async function readLiveTables(
  db: unknown,
  dialect: SupportedDialect,
  statementLists: ReadonlyArray<readonly string[]>
): Promise<LiveTables> {
  const readings = statementLists.map(list =>
    readAsIfNoTableExisted(list, dialect)
  );
  const live = await liveColumnsOf(
    db,
    dialect,
    readings.flatMap(reading => [
      ...(reading?.creating ?? []),
      ...(reading?.relationRenames ?? []),
    ])
  );
  // The tables a statement reaches the descendants of, and those a list
  // renames, whose descendants a later list reaches under the new name
  // (`liveTablesAfter`).
  const reached = [
    ...new Set(
      readings.flatMap(reading => [
        ...(reading?.reaching.map(r => r.table) ?? []),
        ...(reading?.renamed ?? []),
      ])
    ),
  ];
  const descendants =
    dialect === "postgresql" && reached.length > 0
      ? await (
          await import("../pipeline/diff/introspect-live")
        ).introspectDescendants(db, reached)
      : new Map<string, string[]>();
  return Object.assign(new Set(live.keys()), { descendants });
}

/**
 * The indexes a statement list takes away without naming their table, by
 * lower-cased name — PostgreSQL's and SQLite's `DROP INDEX`, PostgreSQL's
 * `ALTER INDEX ... RENAME` — read as the guard reads them. A list the guard
 * cannot read names none here; the guard refuses it on its own.
 */
export function indexesNamedWithoutTable(
  statements: readonly string[],
  dialect: SupportedDialect
): string[] {
  const read = readAsIfNoTableExisted(statements, dialect);
  return [
    ...[...(read?.elements ?? []), ...(read?.alteredElements ?? [])]
      .filter(element => element.table === undefined)
      .map(element => element.name),
    ...(read?.alterTargets ?? []),
  ];
}

/**
 * The table each index the statement lists name without one is on, read from
 * the database they are about to run on: what `assertNoForeignDrops` judges
 * such a drop by (`liveIndexTables`). Keys and values lower-cased; an index
 * the database does not have is absent.
 */
export async function readLiveIndexTables(
  db: unknown,
  dialect: SupportedDialect,
  statementLists: ReadonlyArray<readonly string[]>
): Promise<ReadonlyMap<string, string>> {
  const names = [
    ...new Set(
      statementLists.flatMap(list => indexesNamedWithoutTable(list, dialect))
    ),
  ];
  if (names.length === 0) return new Map();
  const { introspectIndexTables } = await import(
    "../pipeline/diff/introspect-live"
  );
  return introspectIndexTables(db, dialect, names);
}

/** The live columns of `tables`, lower-cased; a missing table is absent. */
async function liveColumnsOf(
  db: unknown,
  dialect: SupportedDialect,
  tables: readonly string[]
): Promise<LiveColumns> {
  const unique = [...new Set(tables)];
  if (unique.length === 0) return new Map();
  const { queryLiveColumnTypes } = await import(
    "../pipeline/live-column-types"
  );
  const live = await queryLiveColumnTypes(db, dialect, unique);
  return new Map(
    [...live].map(([table, columns]) => [
      table.toLowerCase(),
      new Set([...columns.keys()].map(column => column.toLowerCase())),
    ])
  );
}

/**
 * The table a block of rebuild shape starting at `i` rebuilds, and the
 * columns its twin declares, if one starts there.
 */
function rebuildBlockAt(
  statements: readonly string[],
  i: number,
  dialect: SupportedDialect
):
  | {
      table: string;
      columns: string[];
      constraints: ReadonlyMap<string, "fk" | "check">;
      shape: TableShape;
    }
  | undefined {
  // Only SQLite's. It is the one dialect that changes a constraint by
  // rebuilding, and the only one the pipeline writes the block for. On
  // PostgreSQL and MySQL dropping the table also takes what no twin can
  // declare — its triggers, grants, policies, comments and owned sequences
  // — so there the block is read as the drop it is.
  if (dialect !== "sqlite") return undefined;
  const [create, copy, drop, rename] = statements
    .slice(i, i + 4)
    .map(statement => soleStatementTokens(statement, dialect));
  if (!create || !copy || !drop || !rename) return undefined;
  const twin = twinRebuiltBy(create, copy, drop, rename);
  if (twin === undefined) return undefined;
  return {
    table: twin.table,
    columns: twin.columns,
    constraints: namedConstraints(create),
    shape: twinShape(create),
  };
}

/**
 * The twin a block's four statements rebuild through, if they have rebuild
 * shape: the twin's creation, the copy into it, the drop of the table and
 * the rename back.
 */
function twinRebuiltBy(
  create: readonly Token[],
  copy: readonly Token[],
  drop: readonly Token[],
  rename: readonly Token[]
): RebuildTwin | undefined {
  const twin = createdTwin(create);
  if (twin === undefined) return undefined;
  return copiesIntoTwin(copy, twin) &&
    dropsTable(drop, twin.table) &&
    renamesTwinBack(rename, twin)
    ? twin
    : undefined;
}

/**
 * The foreign keys and checks a `CREATE TABLE` body declares under a name,
 * lower-cased: each `CONSTRAINT <name>` directly inside the body, a table
 * constraint or one on a column, followed by `CHECK`, `FOREIGN KEY` or
 * `REFERENCES`. A named `UNIQUE` or `PRIMARY KEY` is neither.
 */
function namedConstraints(
  tokens: readonly Token[]
): ReadonlyMap<string, "fk" | "check"> {
  const named = new Map<string, "fk" | "check">();
  const open = tokens.findIndex(token => isPunct(token, "("));
  if (open === -1) return named;
  let depth = 0;
  for (let k = open; k < tokens.length; k += 1) {
    depth = depthAfter(tokens[k], depth);
    if (depth !== 1 || !isWord(tokens[k], "CONSTRAINT")) continue;
    const name = writtenName(tokens[k + 1])?.toLowerCase();
    const kind = constraintKind(tokens[k + 2]);
    if (name !== undefined && kind !== undefined) named.set(name, kind);
  }
  return named;
}

/**
 * The shape a rebuild's `CREATE TABLE __new_t (...)` declares
 * (`TableShape`): each column's type, NOT NULL and default, the primary key
 * declared on a column or as a table constraint, and the unique constraints
 * declared either way.
 */
function twinShape(tokens: readonly Token[]): TableShape {
  const shape = {
    columns: new Map<string, ColumnShape>(),
    primaryKey: [] as string[],
    unique: new Set<string>(),
  };
  for (const item of bodyItems(tokens)) {
    if (item[0]?.kind === "word" && TABLE_CONSTRAINT_WORDS.has(item[0].upper)) {
      readTableConstraintShape(item, shape);
    } else {
      readColumnShape(item, shape);
    }
  }
  shape.primaryKey.sort();
  return shape;
}

/**
 * The items of a `CREATE TABLE` body — each column definition or table
 * constraint — split at the commas directly inside it.
 */
function bodyItems(tokens: readonly Token[]): Token[][] {
  const open = tokens.findIndex(token => isPunct(token, "("));
  const items: Token[][] = [[]];
  let depth = 1;
  for (const token of tokens.slice(open + 1)) {
    depth = depthAfter(token, depth);
    if (depth === 0) break;
    if (depth === 1 && isPunct(token, ",")) items.push([]);
    else items[items.length - 1].push(token);
  }
  return items;
}

/** A table constraint's `PRIMARY KEY (...)` or `UNIQUE (...)`, if it is one. */
function readTableConstraintShape(
  item: readonly Token[],
  shape: { primaryKey: string[]; unique: Set<string> }
): void {
  const at = isWord(item[0], "CONSTRAINT") ? 2 : 0;
  if (isWord(item[at], "PRIMARY") && isWord(item[at + 1], "KEY")) {
    shape.primaryKey.push(...listedColumns(item, at + 2));
  } else if (isWord(item[at], "UNIQUE")) {
    shape.unique.add(columnSetKey(listedColumns(item, at + 1)));
  }
}

/**
 * The columns a parenthesised list starting at `at` names: the first name of
 * each of its entries, lower-cased, past any `COLLATE` or ordering after it.
 */
function listedColumns(item: readonly Token[], at: number): string[] {
  const columns: string[] = [];
  let depth = 0;
  let entryStart = true;
  for (const token of item.slice(at)) {
    depth = depthAfter(token, depth);
    if (depth === 0) break;
    if (depth === 1 && isPunct(token, ",")) entryStart = true;
    else if (entryStart && depth === 1 && !isPunct(token, "(")) {
      columns.push(writtenName(token)?.toLowerCase() ?? "");
      entryStart = false;
    }
  }
  return columns;
}

/**
 * Words that end a column's declared type: the first of its constraints.
 */
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

/**
 * One column definition's shape: the type is every token before its first
 * constraint, and its constraints are read where they stand directly in the
 * definition, not inside a CHECK's or a default's parentheses.
 */
function readColumnShape(
  item: readonly Token[],
  shape: {
    columns: Map<string, ColumnShape>;
    primaryKey: string[];
    unique: Set<string>;
  }
): void {
  const name = writtenName(item[0])?.toLowerCase();
  if (name === undefined) return;
  let typeEnd = 1;
  while (typeEnd < item.length && !isColumnConstraintWord(item[typeEnd])) {
    typeEnd += 1;
  }
  const column: ColumnShape = {
    type: fingerprint(item.slice(1, typeEnd)),
    notNull: false,
    default: undefined,
  };
  let depth = 0;
  for (let k = typeEnd; k < item.length; k += 1) {
    if (depth === 0) readColumnConstraint(item, k, name, column, shape);
    depth = depthAfter(item[k], depth);
  }
  shape.columns.set(name, column);
}

/** Whether `token` opens a column constraint (`COLUMN_CONSTRAINT_WORDS`). */
function isColumnConstraintWord(token: Token): boolean {
  return token.kind === "word" && COLUMN_CONSTRAINT_WORDS.has(token.upper);
}

/** The column constraint at `k`, if one starts there, recorded on `column`. */
function readColumnConstraint(
  item: readonly Token[],
  k: number,
  name: string,
  column: ColumnShape,
  shape: { primaryKey: string[]; unique: Set<string> }
): void {
  const token = item[k];
  if (token.kind !== "word") return;
  if (token.upper === "NOT" && isWord(item[k + 1], "NULL")) {
    column.notNull = true;
  } else if (token.upper === "PRIMARY" && isWord(item[k + 1], "KEY")) {
    shape.primaryKey.push(name);
  } else if (token.upper === "UNIQUE") {
    shape.unique.add(name);
  } else if (token.upper === "DEFAULT") {
    column.default = fingerprint(item.slice(k + 1, defaultEnd(item, k + 1)));
  }
}

/**
 * Where a column default starting at `at` ends: past a parenthesised
 * expression, a signed literal, or the one token it otherwise is.
 */
function defaultEnd(item: readonly Token[], at: number): number {
  if (isPunct(item[at], "(")) {
    let depth = 0;
    for (let k = at; k < item.length; k += 1) {
      depth = depthAfter(item[k], depth);
      if (depth === 0) return k + 1;
    }
    return item.length;
  }
  return isPunct(item[at], "-") || isPunct(item[at], "+") ? at + 2 : at + 1;
}

/** The key a unique constraint's columns are compared under. */
function columnSetKey(columns: readonly string[]): string {
  return [...columns].sort().join(",");
}

/**
 * Tokens spelled for comparison: keywords upper-cased, names lower-cased and
 * quoted, strings as their text in single quotes, one space between tokens,
 * and parentheses around the whole stripped — so the same type or default
 * written with other spacing, case or bracketing compares equal. Undefined
 * for no tokens.
 */
function fingerprint(tokens: readonly Token[]): string | undefined {
  let inner = tokens;
  while (
    inner.length >= 2 &&
    isPunct(inner[0], "(") &&
    matchingParen(inner) === inner.length - 1
  ) {
    inner = inner.slice(1, -1);
  }
  return inner.length === 0 ? undefined : inner.map(tokenText).join(" ");
}

/** Where the parenthesis opening `tokens` closes. */
function matchingParen(tokens: readonly Token[]): number {
  let depth = 0;
  for (let k = 0; k < tokens.length; k += 1) {
    depth = depthAfter(tokens[k], depth);
    if (depth === 0) return k;
  }
  return -1;
}

/** One token as `fingerprint` spells it. */
function tokenText(token: Token): string {
  switch (token.kind) {
    case "word":
      return token.upper;
    case "name":
      return `"${token.name.toLowerCase()}"`;
    case "string":
      return `'${token.asName ?? ""}'`;
    case "punct":
      return token.char;
    default:
      return token.kind;
  }
}

/**
 * A live type's or default's text, read by the lexer the twin is read by and
 * spelled by `fingerprint`, so the two compare as the same SQL; a text the
 * lexer cannot read gives a spelling no twin matches.
 */
function fingerprintOf(text: string): string | undefined {
  const tokens = soleStatementTokens(text, "sqlite");
  return tokens === undefined ? "\u0000unreadable" : fingerprint(tokens);
}

/**
 * Whether a rebuild's twin keeps what the live table has besides its rows,
 * columns and named elements (`TableShape`): the same primary key, each
 * unique constraint over columns it keeps, and for every column it declares
 * the live type, the live NOT NULL and the live default. A twin may add
 * constraints, never take them. A table with triggers is never kept, since no
 * twin can declare them; nor is one whose shape was not read.
 */
function shapeKept(
  live: LiveTableShape | undefined,
  twin: TableShape
): boolean {
  if (live === undefined || live.triggers > 0) return false;
  if (
    live.primaryKey.length > 0 &&
    live.primaryKey.join(",") !== twin.primaryKey.join(",")
  ) {
    return false;
  }
  const keptUnique = [...live.unique].every(
    set =>
      twin.unique.has(set) ||
      set.split(",").some(column => !twin.columns.has(column))
  );
  return (
    keptUnique &&
    [...twin.columns].every(([name, column]) =>
      columnKept(live.columns.get(name), column)
    )
  );
}

/** Whether a twin's column keeps the live column's type, NOT NULL and default. */
function columnKept(live: ColumnShape | undefined, twin: ColumnShape): boolean {
  if (live === undefined) return false;
  return (
    live.type === twin.type &&
    (!live.notNull || twin.notNull) &&
    (live.default === undefined || live.default === twin.default)
  );
}

/** The parenthesis depth after `token`, given the depth before it. */
function depthAfter(token: Token, depth: number): number {
  if (isPunct(token, "(")) return depth + 1;
  return isPunct(token, ")") ? depth - 1 : depth;
}

/** The element row kind a constraint clause opening with `token` makes. */
function constraintKind(token: Token | undefined): "fk" | "check" | undefined {
  if (token?.kind !== "word") return undefined;
  if (token.upper === "CHECK") return "check";
  return token.upper === "FOREIGN" || token.upper === "REFERENCES"
    ? "fk"
    : undefined;
}

/** A rebuild's twin: its name, the table it rebuilds, the columns it declares. */
interface RebuildTwin {
  twin: string;
  table: string;
  columns: string[];
}

/**
 * A block's first statement: `CREATE TABLE [IF NOT EXISTS] __new_t (...)`
 * declaring at least one column, and nothing after its body.
 */
function createdTwin(tokens: readonly Token[]): RebuildTwin | undefined {
  const creating = new TokenCursor(tokens);
  if (!creating.word("CREATE") || !creating.word("TABLE")) return undefined;
  creating.ifExists();
  const twin = creating.name();
  if (!twin?.startsWith(REBUILD_PREFIX)) return undefined;
  const columns = creating.columnDefinitions();
  if (!columns || columns.length === 0 || !creating.done) return undefined;
  return { twin, table: twin.slice(REBUILD_PREFIX.length), columns };
}

/**
 * A block's copy: `INSERT INTO __new_t (c1, c2) SELECT c1, c2 FROM t`, both
 * lists the twin's columns in its order, and nothing after the FROM.
 */
function copiesIntoTwin(
  tokens: readonly Token[],
  { twin, table, columns }: RebuildTwin
): boolean {
  const copying = new TokenCursor(tokens);
  if (!copying.word("INSERT") || !copying.word("INTO")) return false;
  if (copying.name() !== twin) return false;
  const into = copying.nameList();
  if (!copying.word("SELECT")) return false;
  const selected = copying.bareNameList();
  if (!copying.word("FROM") || copying.name() !== table || !copying.done) {
    return false;
  }
  return sameColumns(into, columns) && sameColumns(selected, columns);
}

/** Whether `list` names exactly `columns`, in the same order. */
function sameColumns(
  list: readonly string[] | undefined,
  columns: readonly string[]
): boolean {
  return (
    list !== undefined &&
    list.length === columns.length &&
    list.every((name, at) => name === columns[at])
  );
}

/** A block's drop: `DROP TABLE [IF EXISTS] t`, and nothing after it. */
function dropsTable(tokens: readonly Token[], table: string): boolean {
  const dropping = new TokenCursor(tokens);
  if (!dropping.word("DROP") || !dropping.word("TABLE")) return false;
  dropping.ifExists();
  return dropping.name() === table && dropping.done;
}

/** A block's last statement: `ALTER TABLE __new_t RENAME TO t`, and no more. */
function renamesTwinBack(
  tokens: readonly Token[],
  { twin, table }: RebuildTwin
): boolean {
  const renaming = new TokenCursor(tokens);
  if (!renaming.word("ALTER") || !renaming.word("TABLE")) return false;
  if (renaming.name() !== twin) return false;
  if (!renaming.word("RENAME") || !renaming.word("TO")) return false;
  return renaming.name() === table && renaming.done;
}

/** Which migration stream is running: `core`, `app`, or `plugin:<name>`. */
export type MigrationStream = string;

/** The stream the application's own migration files run in. */
const APP_STREAM = "app";

/**
 * The tables the core stream carries, which no owner row records: core
 * reconciles them itself. Judged as if a row named the core stream.
 */
const CORE_TABLES = new Set(CORE_TABLE_NAMES);

/** The owner a core table would have, had core recorded one. */
function coreOwner(tableName: string): OwnerRecord {
  return {
    tableName,
    ownerKind: "core",
    ownerId: "nextly",
    migratedBy: "core",
    ownerVersion: null,
    schemaVersion: null,
    state: "active",
  };
}

/**
 * Who holds a table or a column, from the stream's point of view: another
 * stream (`foreign`, with the record that says so), this stream (`own`), or
 * no record at all (`unclaimed`).
 */
type Claim =
  | { kind: "foreign"; owner: OwnerRecord }
  | { kind: "own" }
  | { kind: "unclaimed" };

/** The claim a set of records makes, any foreign one deciding it. */
function claimOf(
  records: readonly OwnerRecord[] | undefined,
  stream: MigrationStream
): Claim | undefined {
  if (records === undefined || records.length === 0) return undefined;
  const foreign = records.find(record => record.migratedBy !== stream);
  return foreign ? { kind: "foreign", owner: foreign } : { kind: "own" };
}

/** Records grouped by a key, folded by `fold`. */
function groupFolded(
  records: Iterable<readonly [string, OwnerRecord]>,
  fold: (key: string) => string
): Map<string, OwnerRecord[]> {
  const grouped = new Map<string, OwnerRecord[]>();
  for (const [key, record] of records) {
    const folded = fold(key);
    grouped.set(folded, [...(grouped.get(folded) ?? []), record]);
  }
  return grouped;
}

/** The key a column's element row is grouped under. */
function columnKey(table: string, column: string): string {
  return `${table}\u0000${column}`;
}

/**
 * Refuse a migration that drops or renames a table or a column it does not
 * hold.
 *
 * Judged before execution and for the file as a WHOLE. An app migration
 * dropping `auth__identities` is refused; plugin-auth's own down migration
 * dropping it is allowed; a plugin dropping another plugin's table is refused.
 *
 * **Tables.** A table is held by the stream its owner row names; a core table,
 * which core reconciles without a row, by the core stream. A table with no
 * record is the APP's to drop: every table the app stream carries —
 * collections, Singles, components, tables its own files made — has none, so
 * refusing them would refuse every migration that removes a collection. A
 * PLUGIN holds only what its rows record, and a table no record claims is
 * refused to it: it may be the app's data from before the registry existed,
 * and a plugin's own tables always have rows by the time a module drops them.
 * A table the same statement list created is held by it whatever the records
 * say — but only a table no live table of that name existed for before the
 * list ran (`liveTables`): a CREATE naming an existing table cannot have made
 * it, so a later statement naming that table reaches the one that was there.
 * The creation must also be written under an unqualified, lower-case name,
 * the drop must name it the same way, and nothing in the list may change
 * which table an unqualified name reaches (`TableRef`, `readStatements`).
 *
 * **Columns.** A column an owner row records as an element is held by that
 * row's stream, and one the stream's own migrations contributed
 * (`ownedElements`) by this stream. Any other column belongs to its table,
 * judged as above — except that a core table's columns are the app's to drop
 * as well, because what is contributed to a core table rides the app's
 * migrations. A complete SQLite rebuild whose twin leaves out live columns
 * keeps the table and drops those columns, and is judged as those column
 * drops: it is how SQLite removes a column a check constraint names. The
 * indexes, foreign keys and checks on the table, live or recorded, that such
 * a block does not put back are judged as drops of them (`elementsLeftOut`).
 *
 * Renaming or moving a table or column is refused the same way as dropping
 * it. After the rename no owner row names it, so a later drop of the new
 * name — in another module, or an uninstall's DOWN — would be judged by a
 * name nobody claims.
 */
export function assertNoForeignDrops(args: {
  statements: readonly string[];
  stream: MigrationStream;
  /** Table-level owner rows, by table name (`tableOwnersByName`). */
  owners: ReadonlyMap<string, OwnerRecord>;
  /** Every owner row, element rows included; only column rows are read. */
  elementOwners: readonly OwnerRecord[];
  /**
   * The elements this stream's own migrations contributed to other owners'
   * tables, as its earlier migrations in this run record them, by table —
   * held by this stream before any element row has been written for them.
   */
  ownedElements?: Readonly<Record<string, ContributedElements>>;
  /** The dialect the statements will run on, which decides how they read. */
  dialect: SupportedDialect;
  /** For the error message. */
  source: string;
  /**
   * The live columns of the tables the statements rebuild
   * (`readLiveColumns`). A rebuild of a table missing here is read as the
   * drop it would otherwise be.
   */
  liveColumns?: LiveColumns;
  /**
   * The live indexes, foreign keys and checks of the tables the statements
   * rebuild (`readLiveElements`). A rebuild of a table missing here is read
   * as the drop it would otherwise be.
   */
  liveElements?: LiveElements;
  /**
   * The tables that exist before the statements run, among those they create
   * and the names PostgreSQL's `ALTER INDEX ... RENAME` renames in them
   * (`readLiveTables`). Absent, no creation is credited: every drop is judged
   * by who holds the table, and every such rename that no live index explains
   * as a rename of a table. On PostgreSQL it also carries the descendants of
   * each table a statement acts on (`LiveTables.descendants`); without them,
   * what a statement does to a table's descendants is not judged.
   */
  liveTables?: LiveTables;
  /**
   * The table each index the statements name without one is on, lower-cased
   * (`readLiveIndexTables`): PostgreSQL's and SQLite's `DROP INDEX` names
   * only the index. An index the map lacks is not in the database, so the
   * drop takes nothing. Absent, such an index is judged as one on a table no
   * record claims.
   */
  liveIndexTables?: ReadonlyMap<string, string>;
  /**
   * Columns whose storage the app overrides (R-20): the app may change these
   * in place. Only the app's stream is let through, and only for an in-place
   * change, never a drop or a rename. The caller decides the value family the
   * change must stay within; this guard does not read the column types.
   */
  columnOverrides?: ReadonlyArray<{ table: string; column: string }>;
}): void {
  const read = readOrRefuse(args);
  const holders = new OwnershipView(args);
  for (const { table, act } of tablesTaken(read, holders, args)) {
    refuseUnlessHeld(holders.table(table), { ...args, table, act });
  }
  for (const { table, parent, act } of descendantsReached(
    read,
    args.liveTables
  )) {
    refuseUnlessHeld(holders.table(table), { ...args, table, parent, act });
  }
  refuseDescendantElements(read, holders, args);
  refuseLookupsAfterVacating(read, args);
  for (const { table, column } of read.columns) {
    refuseUnlessHeld(holders.column(table, column), {
      ...args,
      table,
      column,
      act: "drop or rename",
    });
  }
  refuseInPlaceChanges(read, holders, args);
  refuseQualifiedTargets(read, args);
  refuseTablesNamingIndexes(read, args);
  for (const table of read.unmodelled) {
    refuseUnlessHeld(holders.table(table), {
      ...args,
      table,
      act: UNMODELLED_ACT,
    });
  }
  refuseUnreadOnElements(read, holders, args);
  for (const element of [
    ...read.elements,
    ...elementsLeftOut(read.rebuilt, args.liveElements, args.elementOwners),
  ]) {
    const table = element.table ?? args.liveIndexTables?.get(element.name);
    refuseUnlessHeld(holders.element(element, table, args.liveIndexTables), {
      ...args,
      table,
      element: element.name,
      act: "drop or rename",
    });
  }
  for (const { table, recreated } of read.rebuilt) {
    const claim = holders.table(table);
    if (shapeKept(args.liveElements?.get(table)?.shape, recreated.shape)) {
      continue;
    }
    refuseUnlessHeld(claim, {
      ...args,
      table,
      act: "strip the keys, column definitions or triggers of",
    });
  }
  refuseTypesCascaded(read, args);
}

/**
 * The statement list's reading, or the refusal of a list that cannot be
 * read, re-raised with the file it came from, which the reader never sees
 * and the operator needs to find the statement.
 */
function readOrRefuse(args: {
  statements: readonly string[];
  dialect: SupportedDialect;
  source: string;
  liveColumns?: LiveColumns;
  liveElements?: LiveElements;
  liveTables?: ReadonlySet<string>;
}): Reading {
  try {
    return readStatements(
      args.statements,
      args.dialect,
      args.liveColumns,
      args.liveTables,
      args.liveElements
    );
  } catch (error) {
    if (error instanceof UnparsableDropTarget) {
      throw new UnparsableDropTarget(
        error.statement,
        error.reason,
        args.source
      );
    }
    throw error;
  }
}

/**
 * Refuses a clause the reader cannot read on a table another owner has a
 * column, index, foreign key or check on (`DropReader.unreadOnElements`),
 * whoever holds the table: the clause may change those elements, and which
 * it changes cannot be read.
 */
function refuseUnreadOnElements(
  read: Reading,
  holders: OwnershipView,
  args: ElementJudging
): void {
  refuseElementsOn(new Set(read.unreadOnElements), holders, args);
}

/**
 * Refuses an ALTER without `ONLY` that reaches a descendant another owner
 * has a column, index, foreign key or check on, whoever holds the
 * descendant: a column a child shares with its parent is merged with the
 * parent's, so a change to the parent's (a rename, a type) changes the
 * child's too, and which of the child's elements a clause reaches is not
 * read. A TRUNCATE or DROP reaching it is judged by the table alone, as one
 * naming it is.
 */
function refuseDescendantElements(
  read: Reading,
  holders: OwnershipView,
  args: ElementJudging & { liveTables?: LiveTables }
): void {
  const altered = descendantsReached(read, args.liveTables)
    .filter(({ act }) => act === DESCENDANT_ACTS.alter)
    .map(({ table }) => table);
  refuseElementsOn(new Set(altered), holders, args);
}

/** What judging the element rows on a table needs. */
interface ElementJudging {
  stream: MigrationStream;
  source: string;
  elementOwners: readonly OwnerRecord[];
  liveIndexTables?: ReadonlyMap<string, string>;
  dialect: SupportedDialect;
}

/**
 * Refuses a change to each of `tables` when another owner has a column,
 * index, foreign key or check recorded on it that the change may reach.
 */
function refuseElementsOn(
  tables: ReadonlySet<string>,
  holders: OwnershipView,
  args: ElementJudging
): void {
  // The rows' names are compared as the reader's are, cut to what the
  // dialect stores (`storedNameKey`): the reading and `OwnershipView` both
  // key every name that way, so a long name compared lower-cased alone
  // would match no row and the element would go unjudged.
  const fold = (name: string) => storedNameKey(name, args.dialect);
  for (const table of tables) {
    for (const row of args.elementOwners) {
      if (fold(row.tableName) !== table) continue;
      if (row.elementName == null) continue;
      const name = fold(row.elementName);
      if (row.elementKind === "column") {
        refuseUnreadOn(holders.column(table, name), {
          ...args,
          table,
          column: name,
        });
      } else if (ELEMENT_ROW_KINDS.has(row.elementKind ?? "")) {
        const kind = row.elementKind as TakenElementKind;
        refuseUnreadOn(
          holders.element({ table, name, kind }, table, args.liveIndexTables),
          { ...args, table, element: name }
        );
      }
    }
  }
}

/**
 * Throws the refusal of a change the guard cannot follow to each element it
 * reaches, on a table holding a column or element the stream does not hold
 * (`refuseElementsOn`).
 */
function refuseUnreadOn(
  claim: Claim,
  args: {
    stream: MigrationStream;
    source: string;
    table: string;
    column?: string;
    element?: string;
  }
): void {
  if (claim.kind === "own") return;
  throw new NextlyError({
    code: "DROP_OF_FOREIGN_TABLE",
    publicMessage: `A migration alters ${args.table} in a way the schema guard cannot follow to each column, index and constraint it changes, and ${takenThing(args)} on that table belongs to a different owner. It has been refused, and nothing was applied. Rewrite it as plain ALTER TABLE clauses on the table it names, with ONLY where other tables inherit from it.`,
    logContext: {
      ...knownNames({
        table: args.table,
        column: args.column,
        element: args.element,
      }),
      changedBy: args.stream,
      belongsTo: claim.kind === "foreign" ? claim.owner.migratedBy : null,
      source: args.source,
    },
  });
}

/** What a refusal says a statement does to a descendant, by its act. */
const DESCENDANT_ACTS: Record<DescendantAct, string> = {
  alter: "alter, through a table it inherits from,",
  truncate: "empty, through a table it inherits from,",
  drop: "drop, through a table it inherits from,",
};

/**
 * Every descendant of a table a PostgreSQL statement acts on without `ONLY`
 * (`DropReader.reaching`): the tables inheriting from it and its partitions,
 * at any depth, as the live catalog has them before the list runs
 * (`LiveTables.descendants`). The text names none of them, and each may be
 * another owner's, so each is judged as the table the statement acts on.
 */
function descendantsReached(
  read: Reading,
  liveTables: LiveTables | undefined
): Array<{ table: string; parent: string; act: string }> {
  const descendants = liveTables?.descendants;
  if (descendants === undefined) return [];
  return read.reaching.flatMap(({ table: parent, act }) =>
    (descendants.get(parent) ?? []).map(table => ({
      table,
      parent,
      act: DESCENDANT_ACTS[act],
    }))
  );
}

/**
 * Refuses a statement that looks a name up after an earlier statement of
 * the list vacated it (`DropReader.lookupsAfterVacating`). The live lookup
 * of an index named alone, or of an ALTER TABLE target that may be an index,
 * is made once before the list runs, so it shows what the name reached then:
 * once a table or index of that name is dropped, renamed or moved, the name
 * may reach another relation it shadowed on the search path, which the
 * lookup never saw.
 */
function refuseLookupsAfterVacating(
  read: Reading,
  args: { stream: MigrationStream; source: string }
): void {
  for (const name of read.lookupsAfterVacating) {
    throw new NextlyError({
      code: "DROP_OF_FOREIGN_TABLE",
      publicMessage: `A migration names ${name} after an earlier statement in it dropped, renamed or moved a table or index of that name, so which one the name then reaches cannot be checked. It has been refused, and nothing was applied. Run the later statement in a migration of its own.`,
      logContext: {
        name,
        changedBy: args.stream,
        source: args.source,
      },
    });
  }
}

/**
 * Refuses PostgreSQL's `ALTER TYPE ... CASCADE` (`DropReader.typesCascaded`):
 * it changes every table typed by the type, which may be another owner's and
 * which the text does not name. Judged last, so a statement whose other
 * reading is refused for something it names is refused for that.
 */
function refuseTypesCascaded(
  read: Reading,
  args: { stream: MigrationStream; source: string }
): void {
  for (const type of read.typesCascaded) {
    throw new NextlyError({
      code: "DROP_OF_FOREIGN_TABLE",
      publicMessage: `A migration changes the type ${type} with CASCADE, which also changes every table typed by it, and those may belong to a different owner. It has been refused, and nothing was applied. Change those tables explicitly, then the type without CASCADE.`,
      logContext: { type, changedBy: args.stream, source: args.source },
    });
  }
}

/**
 * Every table the list takes or changes, with what it does to it: the
 * tables it drops, renames or moves, empties or changes the partitions of,
 * and the names PostgreSQL's `ALTER INDEX ... RENAME` may rename a table by
 * (`relationRenamesOfTables`).
 */
function tablesTaken(
  read: Reading,
  holders: OwnershipView,
  args: {
    liveIndexTables?: ReadonlyMap<string, string>;
    liveTables?: ReadonlySet<string>;
  }
): Array<{ table: string; act: string }> {
  return [
    ...read.dropped.map(table => ({ table, act: "drop" })),
    ...read.renamed.map(table => ({ table, act: "rename" })),
    ...relationRenamesOfTables(read.relationRenames, holders, args).map(
      table => ({ table, act: "rename" })
    ),
    ...read.changed,
  ];
}

/**
 * The names an `ALTER INDEX ... RENAME` renames that may be a table's,
 * judged as a table rename. A name the live database has an index under is
 * that index, judged as one. Otherwise the name is a table's — an owner row
 * or a core table claims it, or the live database has a table of that name
 * — or names nothing that existed before the list ran, and so nothing to
 * take. Where the live tables were not read, every such name is judged.
 */
function relationRenamesOfTables(
  names: readonly string[],
  holders: OwnershipView,
  args: {
    liveIndexTables?: ReadonlyMap<string, string>;
    liveTables?: ReadonlySet<string>;
  }
): string[] {
  return names.filter(
    name =>
      args.liveIndexTables?.has(name) !== true &&
      (holders.table(name).kind !== "unclaimed" ||
        args.liveTables === undefined ||
        args.liveTables.has(name))
  );
}

/**
 * The indexes, foreign keys and checks on each table a rebuild keeps that
 * the block does not put back: the table's live ones, and those an element
 * row records on it. Dropping the old table took them all, so each is judged
 * as a drop of it by name would be — SQLite has no other way to remove a
 * check or a foreign key, and a twin that leaves out another owner's is that
 * owner's element gone. A table's live elements are read for every block
 * that keeps it (`readStatements`); the rows count as well, so an element
 * the reading missed is still judged when a row names it.
 */
function elementsLeftOut(
  rebuilt: readonly RebuiltTable[],
  liveElements: LiveElements | undefined,
  elementOwners: readonly OwnerRecord[]
): TakenElement[] {
  return rebuilt.flatMap(({ table, recreated }) => {
    const live = liveElements?.get(table);
    const had = ELEMENT_ROW_KIND_LIST.flatMap(kind => [
      ...[...(live?.[kind] ?? [])].map(name => ({ name, kind })),
      ...elementOwners
        .filter(
          record =>
            record.elementKind === kind &&
            record.tableName.toLowerCase() === table
        )
        .map(record => ({
          name: (record.elementName ?? "").toLowerCase(),
          kind,
        })),
    ]);
    const leftOut = new Map(
      had
        .filter(({ name, kind }) => !recreated[kind].has(name))
        .map(({ name, kind }) => [`${kind}\u0000${name}`, { name, kind }])
    );
    return [...leftOut.values()].map(({ name, kind }) => ({
      table,
      name,
      kind,
    }));
  });
}

/** Who holds each table and column, for one stream. */
class OwnershipView {
  private readonly tables: Map<string, OwnerRecord[]>;
  private readonly columns: Map<string, OwnerRecord[]>;
  /** Index, foreign-key and check rows, by lower-cased element name. */
  private readonly elements: Map<string, OwnerRecord[]>;
  private readonly contributed: Set<string>;
  /**
   * The indexes, foreign keys and checks this stream's own migrations
   * contributed, as `columnKey(table, name)`, lower-cased.
   */
  private readonly contributedElements: Set<string>;
  private readonly stream: MigrationStream;
  /** The key a recorded name is compared under (`storedNameKey`). */
  private readonly fold: (name: string) => string;

  constructor(args: {
    stream: MigrationStream;
    owners: ReadonlyMap<string, OwnerRecord>;
    elementOwners: readonly OwnerRecord[];
    ownedElements?: Readonly<Record<string, ContributedElements>>;
    dialect: SupportedDialect;
  }) {
    this.stream = args.stream;
    // Looked up case-insensitively. PostgreSQL folds an unquoted
    // `DROP TABLE APP_NOTES` to `app_notes`, and an exact lookup of the name
    // as written found no owner and approved it. Folding every name can only
    // match MORE owner rows than the database's own rules would. On
    // PostgreSQL a recorded name is also cut to the length the database
    // stores, as the names a statement writes are (`nameAt`).
    const fold = (name: string) => storedNameKey(name, args.dialect);
    this.fold = fold;
    const partKey = (table: string, name: string) =>
      columnKey(fold(table), fold(name));
    this.tables = groupFolded(args.owners, fold);
    this.columns = groupFolded(
      args.elementOwners
        .filter(record => record.elementKind === "column")
        .map(record => [
          partKey(record.tableName, record.elementName ?? ""),
          record,
        ]),
      key => key
    );
    this.contributed = new Set(
      Object.entries(args.ownedElements ?? {}).flatMap(([table, elements]) =>
        elements.columns.map(column => partKey(table, column))
      )
    );
    this.elements = groupFolded(
      args.elementOwners
        .filter(record => ELEMENT_ROW_KINDS.has(record.elementKind ?? "table"))
        .map(record => [record.elementName ?? "", record]),
      fold
    );
    this.contributedElements = new Set(
      Object.entries(args.ownedElements ?? {}).flatMap(([table, elements]) =>
        [...elements.indexes, ...elements.foreignKeys, ...elements.checks].map(
          name => partKey(table, name)
        )
      )
    );
  }

  /** Who holds a table. */
  table(name: string): Claim {
    const recorded = claimOf(this.tables.get(name), this.stream);
    if (recorded) return recorded;
    if (CORE_TABLES.has(name)) {
      return this.stream === "core"
        ? { kind: "own" }
        : { kind: "foreign", owner: coreOwner(name) };
    }
    return this.stream === APP_STREAM ? { kind: "own" } : { kind: "unclaimed" };
  }

  /** Who holds a column. */
  column(table: string, column: string): Claim {
    const key = columnKey(table, column);
    const recorded = claimOf(this.columns.get(key), this.stream);
    if (recorded) return recorded;
    if (this.contributed.has(key)) return { kind: "own" };
    return this.partOf(table);
  }

  /**
   * Who holds a part of `table` — a column, index or constraint — that no row
   * records and this stream did not contribute: whoever holds the table, save
   * that what is contributed to a core table rides the app's migrations, so
   * the app may drop such a part; nothing tells it apart from core's own.
   */
  private partOf(table: string): Claim {
    const held = this.table(table);
    if (held.kind === "foreign" && CORE_TABLES.has(table)) {
      return this.stream === APP_STREAM ? { kind: "own" } : held;
    }
    return held;
  }

  /**
   * Who holds an index or constraint on `table` — the table the statement
   * names, or the one the live database has the index on; undefined when
   * neither says.
   *
   * Judged as a column is: an owner row naming the element decides, then
   * what this stream's own migrations contributed, then the table's holder,
   * whose own indexes and constraints carry no element row. A row is matched
   * by name and by every kind the statement's word can mean — `DROP
   * CONSTRAINT` names a foreign key, a check or a unique index alike — so
   * folding can only match MORE rows than the database's own rules would.
   */
  element(
    taken: TakenElement,
    table: string | undefined,
    liveIndexTables: ReadonlyMap<string, string> | undefined
  ): Claim {
    const recorded = this.recordedElement(taken, table);
    if (recorded) return recorded;
    if (table === undefined) return this.unlocated(liveIndexTables);
    if (this.contributedElements.has(columnKey(table, taken.name))) {
      return { kind: "own" };
    }
    return this.partOf(table);
  }

  /** The claim the element rows naming `taken` make, if any do. */
  private recordedElement(
    taken: TakenElement,
    table: string | undefined
  ): Claim | undefined {
    const kinds = ELEMENT_KINDS_BY_WORD[taken.kind];
    const rows = (this.elements.get(taken.name) ?? []).filter(
      record =>
        kinds.has(record.elementKind ?? "table") &&
        (table === undefined || this.fold(record.tableName) === table)
    );
    return claimOf(rows, this.stream);
  }

  /**
   * Who holds an index no row records, named without its table and not
   * found on any: when the database was read, it does not have the index,
   * and the drop takes nothing; when it was not, the index may be on any
   * table, judged as one on a table no record claims.
   */
  private unlocated(
    liveIndexTables: ReadonlyMap<string, string> | undefined
  ): Claim {
    if (liveIndexTables !== undefined) return { kind: "own" };
    return this.stream === APP_STREAM ? { kind: "own" } : { kind: "unclaimed" };
  }
}

/** The element row kinds an index or constraint is recorded under. */
const ELEMENT_ROW_KIND_LIST = ["index", "fk", "check"] as const;
const ELEMENT_ROW_KINDS: ReadonlySet<string> = new Set(ELEMENT_ROW_KIND_LIST);

/** The element row kinds each word that takes an element can mean. */
const ELEMENT_KINDS_BY_WORD: Record<TakenElementKind, ReadonlySet<string>> = {
  index: new Set(["index"]),
  fk: new Set(["fk"]),
  check: new Set(["check"]),
  constraint: ELEMENT_ROW_KINDS,
};

/** What a refusal says was taken: an element, a column or a table. */
function takenThing(args: { column?: string; element?: string }): string {
  if (args.element !== undefined) return "an index or constraint";
  return args.column === undefined ? "a table" : "a column";
}

/**
 * The names a refusal is about, each only when it is known: an index named
 * without its table and found on none has no table to log.
 */
function knownNames(
  names: Record<string, string | undefined>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(names).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
}

/** Refuses each in-place change to a column or element the stream does not hold. */
function refuseInPlaceChanges(
  read: Reading,
  holders: OwnershipView,
  args: {
    stream: MigrationStream;
    source: string;
    liveIndexTables?: ReadonlyMap<string, string>;
    columnOverrides?: ReadonlyArray<{ table: string; column: string }>;
  }
): void {
  for (const change of read.alteredColumns) {
    const { table, column } = change;
    if (overridden(args, table, column)) continue;
    if (creditedColumn(read, change)) continue;
    refuseUnlessHeld(holders.column(table, column), {
      ...args,
      table,
      column,
      act: "change in place",
    });
  }
  for (const element of read.alteredElements) {
    if (creditedElement(read, element)) continue;
    const table = element.table ?? args.liveIndexTables?.get(element.name);
    refuseUnlessHeld(holders.element(element, table, args.liveIndexTables), {
      ...args,
      table,
      element: element.name,
      act: "change in place",
    });
  }
}

/**
 * Whether a column change is credited to an addition the same list made
 * earlier. Credit is withheld when the list may change which table a name
 * reaches, and for a change whose name is not spelled as stored.
 */
function creditedColumn(read: Reading, change: TakenColumn): boolean {
  if (read.resolutionMayChange || change.exact !== true) return false;
  return read.addedColumns.some(
    added =>
      added.table === change.table &&
      added.column === change.column &&
      added.exact === true &&
      (added.seq ?? 0) < (change.seq ?? 0)
  );
}

/** Whether an element change is credited to an earlier addition, as above. */
function creditedElement(read: Reading, change: TakenElement): boolean {
  if (read.resolutionMayChange || change.exact !== true) return false;
  if (change.table === undefined) return false;
  const table = change.table;
  return read.addedElements.some(
    added =>
      added.table === table &&
      added.name === change.name &&
      added.exact === true &&
      kindsCompatible(change.kind, added.kind) &&
      (added.seq ?? 0) < (change.seq ?? 0)
  );
}

/**
 * Whether a change of one element kind may be credited to an addition of
 * another. `ALTER CONSTRAINT` and `VALIDATE CONSTRAINT` reach a check, a
 * foreign key or a constraint, never an index.
 */
function kindsCompatible(
  change: TakenElementKind,
  added: TakenElementKind
): boolean {
  if (change === "constraint") return added !== "index";
  return change === added;
}

/** Refuses a storage or unmodelled change through a schema-qualified name. */
function refuseQualifiedTargets(
  read: Reading,
  args: { stream: MigrationStream; source: string }
): void {
  for (const table of read.qualifiedTargets) {
    throw new NextlyError({
      code: "DROP_OF_FOREIGN_TABLE",
      publicMessage: `A migration alters ${table} through a schema-qualified name in a form the schema guard cannot read, so it has been refused, and nothing was applied. Rewrite the statement with the table's unqualified name, or use the app's override.`,
      logContext: { table, changedBy: args.stream, source: args.source },
    });
  }
}

/** Refuses an ALTER TABLE, of storage or unmodelled, that names an index. */
function refuseTablesNamingIndexes(
  read: Reading,
  args: {
    stream: MigrationStream;
    source: string;
    liveIndexTables?: ReadonlyMap<string, string>;
  }
): void {
  for (const table of read.alterTargets) refuseIndexNamed(table, args);
  for (const table of read.unmodelled) refuseIndexNamed(table, args);
}

/**
 * Refuses an ALTER TABLE that names an index: PostgreSQL accepts index
 * changes through ALTER TABLE, and this guard does not route them to the
 * index's owner, so they are refused by design.
 */
function refuseIndexNamed(
  table: string,
  args: {
    stream: MigrationStream;
    source: string;
    liveIndexTables?: ReadonlyMap<string, string>;
  }
): void {
  if (args.liveIndexTables?.has(table.toLowerCase()) !== true) return;
  throw new NextlyError({
    code: "DROP_OF_FOREIGN_TABLE",
    publicMessage: `A migration runs ALTER TABLE on ${table}, which is an index. The schema guard does not accept this form, so the migration has been refused and nothing was applied. Rewrite the statement as ALTER INDEX.`,
    logContext: {
      table,
      changedBy: args.stream,
      belongsTo: null,
      source: args.source,
    },
  });
}

/** Whether the app has recorded its override of this column's storage. */
function overridden(
  args: {
    stream: MigrationStream;
    columnOverrides?: ReadonlyArray<{ table: string; column: string }>;
  },
  table: string,
  column: string
): boolean {
  if (args.stream !== APP_STREAM || args.columnOverrides === undefined) {
    return false;
  }
  const key = columnKey(table, column);
  return args.columnOverrides.some(
    override => columnKey(override.table, override.column) === key
  );
}

/** The log field that names who acted: a rename, a change or a drop. */
function logKey(act: string): string {
  if (act === "rename") return "renamedBy";
  if (
    act === "change in place" ||
    act === "change the storage of" ||
    act === DESCENDANT_ACTS.alter
  ) {
    return "changedBy";
  }
  return "droppedBy";
}

/** Throw the refusal for a table, column or element the stream does not hold. */
function refuseUnlessHeld(
  claim: Claim,
  args: {
    stream: MigrationStream;
    source: string;
    /** Undefined for an index named without its table and found on none. */
    table: string | undefined;
    column?: string;
    element?: string;
    /** The table a statement acts on, when `table` is reached through it. */
    parent?: string;
    act: string;
  }
): void {
  if (claim.kind === "own") return;
  if (args.act === UNMODELLED_ACT) {
    throw new NextlyError({
      code: "DROP_OF_FOREIGN_TABLE",
      publicMessage: `A migration alters ${args.table ?? "a table"} in a form the schema guard cannot read, and that table belongs to a different owner. It has been refused, and nothing was applied. Rewrite the statement as plain ALTER TABLE clauses, or use the app's override.`,
      logContext: {
        ...knownNames({ table: args.table }),
        changedBy: args.stream,
        belongsTo: claim.kind === "foreign" ? claim.owner.migratedBy : null,
        source: args.source,
      },
    });
  }
  const what = takenThing(args);
  // One code for every case: each takes something from whoever holds it, and
  // the operator's remedy is the same.
  throw new NextlyError({
    code: "DROP_OF_FOREIGN_TABLE",
    publicMessage:
      claim.kind === "foreign"
        ? `A migration would ${args.act} ${what} that belongs to a different owner. It has been refused, and nothing was applied.`
        : `A plugin migration would ${args.act} ${what} that no owner record says is the plugin's. It has been refused, and nothing was applied.`,
    logContext: {
      ...knownNames({
        table: args.table,
        column: args.column,
        element: args.element,
        parent: args.parent,
      }),
      [logKey(args.act)]: args.stream,
      ...(claim.kind === "foreign"
        ? { belongsTo: claim.owner.migratedBy, ownerId: claim.owner.ownerId }
        : { belongsTo: null }),
      source: args.source,
    },
  });
}

/**
 * Whether dev push may drop this table.
 *
 * A plugin-migrated table is never dropped by dev push, whatever the desired
 * set says. Dev push reconciles what the CONFIG describes, and a plugin table
 * removed from config is exactly the moment its data is most at risk — removing
 * it is a decision for a migration rather than a side effect of a reload.
 */
export function pushMayDropTable(
  table: string,
  owners: ReadonlyMap<string, OwnerRecord>
): boolean {
  const owner = owners.get(canonicalTableName(table));
  if (!owner) return true;
  return !owner.migratedBy.startsWith("plugin:");
}

/**
 * Whether one statement is a DROP of a plugin-migrated table.
 *
 * Read with the same reader as the migration guard, and the one answer to
 * this question for both dev-push routes. Matching the raw capture compared
 * `"auth__identities"` — quotes included, which is how the PostgreSQL and
 * SQLite templates render every name — against a set of bare names, so no
 * quoted drop ever matched. A statement the reader cannot read counts as
 * one: dev push withholds it rather than risk a plugin's table.
 */
export function dropsPluginMigratedTable(
  statement: string,
  pluginMigratedTables: ReadonlySet<string>,
  dialect: SupportedDialect
): boolean {
  try {
    return tablesDroppedBy([statement], dialect).some(table =>
      pluginMigratedTables.has(table)
    );
  } catch (error) {
    if (error instanceof UnparsableDropTarget) return true;
    throw error;
  }
}

/**
 * The plugin-migrated table set dev push refuses to drop, from the owner
 * registry. Undefined when the registry cannot be read (a database that
 * predates it, or a fresh install before core reconcile), which callers read
 * as "nothing is claimed" — the pre-registry behaviour exactly.
 */
export async function pluginMigratedTableSet(
  db: unknown,
  dialect: SupportedDialect
): Promise<ReadonlySet<string> | undefined> {
  try {
    const rows = await new SchemaOwnersRepository(db, dialect).read();
    return new Set(
      rows
        .filter(row => row.migratedBy.startsWith("plugin:"))
        .map(row => row.tableName.toLowerCase())
    );
  } catch {
    return undefined;
  }
}
