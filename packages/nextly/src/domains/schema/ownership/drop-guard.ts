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
 * by what it is called.
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
 * so it is refused. Without `CASCADE` PostgreSQL itself refuses the drop
 * while anything depends on the object.
 *
 * **Known limit.** Only text is read. SQL passed as a string to a function
 * that runs it is data to this reader, not code. And on PostgreSQL a
 * `DROP TABLE ... CASCADE`, which generated migrations write, also removes
 * the views and foreign keys that depend on the table, and the tables that
 * inherit from it (`INHERITS`), which only the database knows.
 *
 * @module domains/schema/ownership/drop-guard
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import { CORE_TABLE_NAMES } from "../../../schemas";
import { scanSql, type SqlSegment } from "../migrate/sql-scan";
import type { ContributedElements } from "../pipeline/diff/types";

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
   * Indexes and constraints this list drops or renames away, with the table
   * named by the name it had before the list renamed it.
   */
  readonly elements: TakenElement[] = [];
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

  constructor(
    readonly dialect: SupportedDialect,
    /**
     * The tables that exist before the list runs, among those it creates.
     * Undefined when that is not known, and then no creation is credited.
     */
    private readonly liveTables: ReadonlySet<string> | undefined
  ) {}

  read(statement: string): void {
    const tokens = new Lexer(this.dialect, statement).tokens(statement);
    new StatementWalk(this, tokens, statement).run();
  }

  /**
   * Records a table this list creates, credited to it only under a local name
   * no live table had before the list ran. A CREATE naming a table that
   * already exists cannot have made that table, so whatever it did make — in
   * another schema, under another case, on another search path — a later
   * statement naming the existing table reaches the existing table.
   */
  create(table: TableRef): void {
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
    if (this.takeCreated(table)) return;
    const original = this.renamedFrom.get(table.name);
    if (original !== undefined) this.dropped.push(original);
    this.dropped.push(table.name);
  }

  rename(from: TableRef, to: TableRef): void {
    if (this.takeCreated(from)) {
      this.create(to);
      return;
    }
    const original = this.relocate(from);
    this.renamedFrom.delete(from.name);
    if (to.name === original) this.renamedFrom.delete(to.name);
    else this.renamedFrom.set(to.name, original);
  }

  /**
   * Records that the table currently called `table` leaves that name — a
   * rename, or a move to another schema — and returns the name it had before
   * this list.
   */
  relocate(table: TableRef): string {
    const { name } = table;
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
   * Records an index or constraint dropped or renamed away. One on a table
   * this list created is its own, and is not recorded.
   */
  takeElement(
    table: TableRef | undefined,
    name: string,
    kind: TakenElementKind
  ): void {
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

  get isMysql(): boolean {
    return this.dialect === "mysql";
  }

  get isPostgres(): boolean {
    return this.dialect === "postgresql";
  }
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
      case "DO":
        if (first && this.reader.isPostgres) this.assertDollarQuotedDo(at);
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
    } else if (word === "CREATE") {
      this.readCreateTable(at);
      if (this.reader.isPostgres) this.assertDollarQuotedRoutine(at);
    }
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
   * One name as the dialect spells it, lower-cased. Undefined when the
   * token is not one.
   */
  private nameAt(at: number): string | undefined {
    const token = this.tokens[at];
    if (token?.kind === "escaped-name") {
      return this.refuse(
        'a unicode-escaped name (U&"...") cannot be read without decoding it'
      );
    }
    return writtenName(token)?.toLowerCase();
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
   * The DROP clauses of an ALTER TABLE are not drops of this kind: what they
   * drop is part of the table, judged as such (`readAlterTableColumns`).
   * CASCADE may end only the statement, so the word before its end is read.
   * MySQL accepts `CASCADE` and ignores it; SQLite has none.
   */
  private assertNoDependentsDropped(at: number): void {
    if (!this.reader.isPostgres || this.inAlterTable) return;
    let end = at + 1;
    while (!this.atStatementEnd(end)) end += 1;
    if (this.word(end - 1) !== "CASCADE") return;
    this.refuse(
      "CASCADE on a DROP of anything but a table also drops whatever depends on the object, which may be another owner's columns or tables; drop those dependents explicitly, then drop the object without CASCADE"
    );
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
    for (const clause of this.clauseStarts(table?.next ?? tableAt + 1)) {
      this.readColumnClause(table, clause);
      this.readElementClause(table, clause);
    }
  }

  /**
   * PostgreSQL's `ALTER INDEX [IF EXISTS] a RENAME TO b`, recorded as `a`
   * taken from its table: after the rename no record names it. The tokens
   * are not consumed.
   */
  private readAlterIndexRename(at: number): void {
    if (this.word(at + 1) !== "INDEX") return;
    const index = this.qualifiedName(this.skipIfExists(at + 2));
    if (index === undefined) return;
    if (
      this.word(index.next) !== "RENAME" ||
      this.word(index.next + 1) !== "TO"
    ) {
      return;
    }
    this.reader.takeElement(undefined, index.name, "index");
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
    if (what === "CONSTRAINT") return this.elementNamedAt(at + 1, "constraint");
    if (this.reader.isMysql && (what === "INDEX" || what === "KEY")) {
      return this.elementNamedAt(at + 1, "index");
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
    if (this.word(at) === "COLUMN") return this.nameAt(at + 1) ?? null;
    if (this.reader.isMysql) return undefined;
    const next = this.word(at);
    if (next === "TO" || next === "CONSTRAINT") return undefined;
    const column = this.nameAt(at);
    return column !== undefined && this.word(at + 1) === "TO"
      ? column
      : undefined;
  }

  private changedColumnAt(at: number): string | null | undefined {
    const k = this.word(at) === "COLUMN" ? at + 1 : at;
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
   * alters something other than a table.
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
 * The tables one statement drops or renames away, by the unqualified names it
 * writes them with, lower-cased — a rebuild's `__new_` copy under its own
 * name, as `tableNamedByCreate` gives it, not the table it stands in for.
 * Empty for a statement that is neither or cannot be read, and for a name
 * written qualified: a caller asking whether a table is gone by some point
 * then hears that it is not.
 */
export function tablesRemovedBy(
  statement: string,
  dialect: SupportedDialect
): string[] {
  const tokens = soleStatementTokens(statement, dialect);
  if (tokens === undefined) return [];
  const cursor = new TokenCursor(tokens);
  if (cursor.word("DROP")) return tablesDroppedAt(cursor);
  if (cursor.word("ALTER")) return tableRenamedByAlterAt(cursor);
  if (cursor.word("RENAME")) return tablesRenamedAt(cursor);
  return [];
}

/** `[TEMPORARY] TABLE [IF EXISTS] a, b`, from past the DROP. */
function tablesDroppedAt(cursor: TokenCursor): string[] {
  cursor.word("TEMPORARY");
  if (!cursor.word("TABLE")) return [];
  cursor.ifExists();
  return cursor.bareNameList() ?? [];
}

/** `TABLE [IF EXISTS] [ONLY] a RENAME TO|AS b`, from past the ALTER. */
function tableRenamedByAlterAt(cursor: TokenCursor): string[] {
  if (!cursor.word("TABLE")) return [];
  cursor.ifExists();
  cursor.word("ONLY");
  const table = cursor.name();
  if (table === undefined || !cursor.word("RENAME")) return [];
  return cursor.word("TO") || cursor.word("AS") ? [table] : [];
}

/** MySQL's `TABLE a TO b, c TO d`, from past the RENAME. */
function tablesRenamedAt(cursor: TokenCursor): string[] {
  if (!cursor.word("TABLE")) return [];
  const renamed: string[] = [];
  do {
    const from = cursor.name();
    if (from === undefined || !cursor.word("TO")) return [];
    if (cursor.name() === undefined) return [];
    renamed.push(from);
  } while (cursor.punct(","));
  return renamed;
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
 * A statement list read as if no table existed — so a creation's credit
 * carries through a rename to the name it is renamed to — or undefined when
 * the list cannot be read; the guard refuses such a list on its own.
 */
function readAsIfNoTableExisted(
  statements: readonly string[],
  dialect: SupportedDialect
): DropReader | undefined {
  const reader = new DropReader(dialect, new Set());
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
  const read = soleStatementWords(statement, dialect);
  if (read === undefined || read.word(0) !== "CREATE") return undefined;
  const { tokens, word } = read;
  let k = 1;
  while (CREATE_TABLE_MODIFIERS.has(word(k) ?? "")) k += 1;
  if (word(k) !== "TABLE") return undefined;
  k += 1;
  if (word(k) === "IF" && word(k + 1) === "NOT" && word(k + 2) === "EXISTS") {
    k += 3;
  }
  return lastNamePart(tokens, k);
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
  let k = at;
  for (;;) {
    const next = tokens[k + 1];
    if (next?.kind !== "punct" || next.char !== ".") break;
    k += 2;
  }
  return writtenName(tokens[k])?.toLowerCase();
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
  liveTables: ReadonlySet<string> | undefined
): Pick<DropReader, "dropped" | "renamed" | "columns" | "elements"> {
  const kept = keptTables(followColumns(statements, dialect, liveColumns));
  const reading = readWith(
    statements,
    new DropReader(dialect, liveTables),
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
    ? readWith(statements, new DropReader(dialect, undefined), new Map())
    : reading;
}

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
    // live columns its twin leaves out, judged as the column drops they are.
    if (block.dropAt !== index) return;
    for (const column of block.droppedColumns) {
      reader.takeColumn({ name: block.table, local: true }, column);
    }
  });
  return reader;
}

/**
 * The rebuild blocks that keep their table, by the index of each of their
 * DROP and rename statements.
 */
function keptTables(follow: {
  blocks: readonly KeptTable[];
}): ReadonlyMap<number, KeptTable> {
  return new Map(
    follow.blocks.flatMap(block => [
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
 * read as the drop or rename it is.
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
      const kept = keptBy(block, columns.get(block.table), i + 2);
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
  block: { table: string; columns: readonly string[] },
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
  };
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
 * Which of the tables the statement lists create exist already, read from the
 * database the statements are about to run on — the tables
 * `assertNoForeignDrops` credits no creation of (`liveTables`). Read through
 * the introspection `readLiveColumns` uses, so on PostgreSQL a table counts
 * when an unqualified name reaches it, wherever the search path finds it.
 */
export async function readLiveTables(
  db: unknown,
  dialect: SupportedDialect,
  statementLists: ReadonlyArray<readonly string[]>
): Promise<ReadonlySet<string>> {
  const live = await liveColumnsOf(
    db,
    dialect,
    statementLists.flatMap(list => tablesCreatedBy(list, dialect))
  );
  return new Set(live.keys());
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
  return (readAsIfNoTableExisted(statements, dialect)?.elements ?? [])
    .filter(element => element.table === undefined)
    .map(element => element.name);
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
): { table: string; columns: string[] } | undefined {
  const [create, copy, drop, rename] = statements
    .slice(i, i + 4)
    .map(statement => soleStatementTokens(statement, dialect));
  if (!create || !copy || !drop || !rename) return undefined;
  const twin = createdTwin(create);
  if (
    twin === undefined ||
    !copiesIntoTwin(copy, twin) ||
    !dropsTable(drop, twin.table) ||
    !renamesTwinBack(rename, twin)
  ) {
    return undefined;
  }
  return { table: twin.table, columns: twin.columns };
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

/** Records grouped by a lower-cased key. */
function groupLowerCased(
  records: Iterable<readonly [string, OwnerRecord]>
): Map<string, OwnerRecord[]> {
  const grouped = new Map<string, OwnerRecord[]>();
  for (const [key, record] of records) {
    const folded = key.toLowerCase();
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
 * drops: it is how SQLite removes a column a check constraint names.
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
   * The tables that exist before the statements run, among those they create
   * (`readLiveTables`). Absent, no creation is credited: every drop is judged
   * by who holds the table.
   */
  liveTables?: ReadonlySet<string>;
  /**
   * The table each index the statements name without one is on, lower-cased
   * (`readLiveIndexTables`): PostgreSQL's and SQLite's `DROP INDEX` names
   * only the index. An index the map lacks is not in the database, so the
   * drop takes nothing. Absent, such an index is judged as one on a table no
   * record claims.
   */
  liveIndexTables?: ReadonlyMap<string, string>;
}): void {
  let read: Pick<DropReader, "dropped" | "renamed" | "columns" | "elements">;
  try {
    read = readStatements(
      args.statements,
      args.dialect,
      args.liveColumns,
      args.liveTables
    );
  } catch (error) {
    // Re-raised with the file it came from, which the reader never sees and
    // the operator needs to find the statement.
    if (error instanceof UnparsableDropTarget) {
      throw new UnparsableDropTarget(
        error.statement,
        error.reason,
        args.source
      );
    }
    throw error;
  }
  const holders = new OwnershipView(args);
  for (const table of read.dropped) {
    refuseUnlessHeld(holders.table(table), { ...args, table, act: "drop" });
  }
  for (const table of read.renamed) {
    refuseUnlessHeld(holders.table(table), { ...args, table, act: "rename" });
  }
  for (const { table, column } of read.columns) {
    refuseUnlessHeld(holders.column(table, column), {
      ...args,
      table,
      column,
      act: "drop or rename",
    });
  }
  for (const element of read.elements) {
    const table = element.table ?? args.liveIndexTables?.get(element.name);
    refuseUnlessHeld(holders.element(element, table, args.liveIndexTables), {
      ...args,
      table,
      element: element.name,
      act: "drop or rename",
    });
  }
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

  constructor(args: {
    stream: MigrationStream;
    owners: ReadonlyMap<string, OwnerRecord>;
    elementOwners: readonly OwnerRecord[];
    ownedElements?: Readonly<Record<string, ContributedElements>>;
  }) {
    this.stream = args.stream;
    // Looked up case-insensitively. PostgreSQL folds an unquoted
    // `DROP TABLE APP_NOTES` to `app_notes`, and an exact lookup of the name
    // as written found no owner and approved it. Folding every name can only
    // match MORE owner rows than the database's own rules would.
    this.tables = groupLowerCased(args.owners);
    this.columns = groupLowerCased(
      args.elementOwners
        .filter(record => record.elementKind === "column")
        .map(record => [
          columnKey(record.tableName, record.elementName ?? ""),
          record,
        ])
    );
    this.contributed = new Set(
      Object.entries(args.ownedElements ?? {}).flatMap(([table, elements]) =>
        elements.columns.map(column => columnKey(table, column).toLowerCase())
      )
    );
    this.elements = groupLowerCased(
      args.elementOwners
        .filter(record => ELEMENT_ROW_KINDS.has(record.elementKind ?? "table"))
        .map(record => [record.elementName ?? "", record])
    );
    this.contributedElements = new Set(
      Object.entries(args.ownedElements ?? {}).flatMap(([table, elements]) =>
        [...elements.indexes, ...elements.foreignKeys, ...elements.checks].map(
          name => columnKey(table, name).toLowerCase()
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
        (table === undefined || record.tableName.toLowerCase() === table)
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
const ELEMENT_ROW_KINDS = new Set(["index", "fk", "check"]);

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
    act: string;
  }
): void {
  if (claim.kind === "own") return;
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
      }),
      [args.act === "rename" ? "renamedBy" : "droppedBy"]: args.stream,
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
