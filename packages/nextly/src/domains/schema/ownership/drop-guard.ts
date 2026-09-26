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
 * **Known limit.** Only text is read. A function body written as an ordinary
 * single-quoted string (`AS 'DROP TABLE x'`), or SQL passed as a string to a
 * function that runs it, is data to this reader, not code. The statements
 * that RUN such text are refused: `EXECUTE` and `PREPARE`, which run SQL
 * assembled at run time, and a PostgreSQL `DO` whose body is not
 * dollar-quoted, which runs a string this reader skips as a literal.
 *
 * @module domains/schema/ownership/drop-guard
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import { scanSql, type SqlSegment } from "../migrate/sql-scan";

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
 * dollar-quoted body, whose contents are a statement list of their own.
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
  | { kind: "end" };

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
        if (segment.executable) {
          this.refuse(
            "a MySQL executable comment (/*! ... */) runs text this guard reads as a comment"
          );
        }
        if (segment.unterminated) this.refuse("unterminated block comment");
        return;
      case "string":
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
        // SQLite takes a `'...'` string as a name wherever one is expected,
        // and MySQL's ANSI_QUOTES mode reads `"..."` as one.
        out.push({
          kind: "string",
          asName:
            (this.dialect === "sqlite" && segment.quote === "'") ||
            (this.dialect === "mysql" && segment.quote === '"')
              ? segment.content
              : undefined,
        });
        return;
      case "quoted-name":
        if (segment.unterminated) {
          this.refuse(
            segment.bracketed
              ? "unterminated bracketed name"
              : "unterminated quoted name"
          );
        }
        out.push(
          segment.unicodeEscaped
            ? { kind: "escaped-name" }
            : { kind: "name", name: segment.content }
        );
        return;
      case "dollar-body":
        // Read as code, bracketed by `end` tokens: its contents are a
        // statement list of their own, so a drop inside a `DO` block or a
        // function body is read like any other, and a drop's target list
        // cannot run past the body's edge.
        if (segment.unterminated) {
          this.refuse("unterminated dollar-quoted body");
        }
        out.push({ kind: "end" });
        this.tokens(text.slice(segment.bodyStart, segment.bodyEnd), out);
        out.push({ kind: "end" });
        return;
    }
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

/** Statement keywords that drop tables without naming them. */
const NAMELESS_DROPS = new Set(["SCHEMA", "DATABASE", "OWNED"]);

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

  constructor(private readonly dialect: SupportedDialect) {}

  read(statement: string): void {
    const tokens = new Lexer(this.dialect, statement).tokens(statement);
    new StatementWalk(this, tokens, statement).run();
  }

  /** Records a dropped name, and the original name if a rename made it. */
  drop(name: string): void {
    const original = this.renamedFrom.get(name);
    if (original !== undefined) this.dropped.push(original);
    this.dropped.push(name);
  }

  rename(from: string, to: string): void {
    const original = this.relocate(from);
    this.renamedFrom.delete(from);
    if (to === original) this.renamedFrom.delete(to);
    else this.renamedFrom.set(to, original);
  }

  /**
   * Records that the table currently called `name` leaves that name — a
   * rename, or a move to another schema — and returns the name it had before
   * this list.
   */
  relocate(name: string): string {
    const original = this.renamedFrom.get(name) ?? name;
    this.renamed.push(original);
    if (original !== name) this.renamed.push(name);
    return original;
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
   * first word, whether TRIGGER has appeared in it, and whether it is inside
   * a GRANT/REVOKE privilege list.
   */
  private firstWord: string | undefined;
  private sawTrigger = false;
  private inPrivileges = false;

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
      this.firstWord = undefined;
      this.sawTrigger = false;
      this.inPrivileges = false;
      return at + 1;
    }
    if (token.kind !== "word") return at + 1;
    const first = this.firstWord === undefined;
    if (first) this.firstWord = token.upper;
    this.trackStatementState(token.upper);
    return this.readKeyword(token.upper, at, first);
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
      case "ALTER":
        this.readAlterTableRenames(at);
        break;
      case "RENAME":
        return this.readRenameStatement(at, first);
      case "DO":
        if (first && this.reader.isPostgres) this.assertDollarQuotedDo(at);
        break;
    }
    return at + 1;
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
    if (token === undefined) return undefined;
    switch (token.kind) {
      case "word":
        return token.text.toLowerCase();
      case "name":
        return token.name.toLowerCase();
      case "string":
        return token.asName?.toLowerCase();
      case "escaped-name":
        return this.refuse(
          'a unicode-escaped name (U&"...") cannot be read without decoding it'
        );
      default:
        return undefined;
    }
  }

  /**
   * A possibly schema-qualified name starting at `at`; the last part is the
   * table. Undefined when no name starts there; a qualifier with nothing
   * after its dot is refused.
   */
  private qualifiedName(
    at: number
  ): { name: string; next: number } | undefined {
    let name = this.nameAt(at);
    if (name === undefined) return undefined;
    let k = at + 1;
    while (this.punct(k) === ".") {
      name = this.nameAt(k + 1);
      if (name === undefined) this.refuse("no name after a qualifier");
      k += 2;
    }
    return { name: canonicalTableName(name), next: k };
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
    const listAt = this.dropTableListAt(at);
    if (listAt === undefined) return at + 1;
    return this.dropTail(this.readDropTargets(listAt));
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
      this.reader.drop(target.name);
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
    let table: string | undefined;
    for (let k = tableAt + 1; !this.atStatementEnd(k); k += 1) {
      if (this.isSetSchemaAt(k)) {
        table ??= this.qualifiedName(tableAt)?.name;
        if (table === undefined) {
          this.refuse("a SET SCHEMA whose table name cannot be read");
        }
        this.reader.relocate(table);
        continue;
      }
      const newNameAt = this.tableRenameTargetAt(k);
      if (newNameAt === undefined) continue;
      table ??= this.qualifiedName(tableAt)?.name;
      table = this.recordTableRename(table, newNameAt);
    }
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
   * at `newNameAt`, and returns the new name.
   */
  private recordTableRename(
    table: string | undefined,
    newNameAt: number
  ): string {
    const renamed = this.qualifiedName(newNameAt);
    if (table === undefined || renamed === undefined) {
      this.refuse("a table rename whose names cannot be read");
    }
    this.reader.rename(table, renamed.name);
    return renamed.name;
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
      this.reader.rename(from.name, to.name);
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
  return readStatements(statements, dialect, liveColumns).dropped;
}

/**
 * One reading of a statement list: the tables it drops and the tables it
 * renames or moves away, from the same walk, so the two can never be read
 * under different rules.
 */
function readStatements(
  statements: readonly string[],
  dialect: SupportedDialect,
  liveColumns: LiveColumns | undefined
): Pick<DropReader, "dropped" | "renamed"> {
  const reader = new DropReader(dialect);
  const preserving = rebuildBlockStatements(statements, dialect, liveColumns);
  statements.forEach((statement, index) => {
    if (!preserving.has(index)) reader.read(statement);
  });
  return reader;
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

  /** Consumes one possibly qualified name; its last part, lower-cased. */
  name(): string | undefined {
    let name = this.part();
    if (name === undefined) return undefined;
    while (this.punct(".")) {
      name = this.part();
      if (name === undefined) return undefined;
    }
    return name;
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
      const first = this.tokens[this.at];
      const constraint =
        first?.kind === "word" && TABLE_CONSTRAINT_WORDS.has(first.upper);
      if (!constraint) {
        const column = this.part();
        if (column === undefined) return undefined;
        columns.push(column);
      }
      // The rest of the item, to the comma or parenthesis that ends it.
      let depth = 0;
      for (;;) {
        const token = this.tokens[this.at];
        if (token === undefined) return undefined;
        if (token.kind === "punct" && depth === 0) {
          if (token.char === ",") break;
          if (token.char === ")") {
            this.at += 1;
            return columns;
          }
        }
        if (token.kind === "punct" && token.char === "(") depth += 1;
        if (token.kind === "punct" && token.char === ")") depth -= 1;
        this.at += 1;
      }
      this.at += 1;
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
    const token = this.tokens[this.at];
    let name: string | undefined;
    if (token?.kind === "word") name = token.text;
    else if (token?.kind === "name") name = token.name;
    else if (token?.kind === "string") name = token.asName;
    if (name === undefined) return undefined;
    this.at += 1;
    return name.toLowerCase();
  }
}

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
 * be declared by the twin, and so copied. A twin missing one — or a table
 * whose live columns were not read — leaves the block read as the drop of
 * `t` it then is.
 */
export function rebuildBlockStatements(
  statements: readonly string[],
  dialect: SupportedDialect,
  liveColumns: LiveColumns | undefined
): ReadonlySet<number> {
  return followColumns(statements, dialect, liveColumns).preserving;
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
 * judged against the columns its table has at that point, and single-clause
 * `ALTER TABLE ... ADD|DROP|RENAME COLUMN` statements before it move those
 * columns as the database would.
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
): { preserving: ReadonlySet<number>; after: LiveColumns } {
  const columns = new Map(
    [...(liveColumns ?? [])].map(([table, set]) => [table, new Set(set)])
  );
  const preserving = new Set<number>();
  for (let i = 0; i < statements.length; i += 1) {
    const block = rebuildBlockAt(statements, i, dialect);
    if (block) {
      const live = columns.get(block.table);
      const declared = new Set(block.columns);
      if (
        live !== undefined &&
        live.size > 0 &&
        [...live].every(column => declared.has(column))
      ) {
        preserving.add(i + 2);
        preserving.add(i + 3);
      }
      if (live !== undefined) columns.set(block.table, declared);
      i += 3;
      continue;
    }
    const tokens = soleStatementTokens(statements[i], dialect);
    if (tokens) followColumnChange(tokens, columns);
    else columns.clear();
  }
  return { preserving, after: columns };
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
    // A tracked table dropped or created outside a rebuild block: whatever
    // it holds afterwards is not what was read.
    cursor.word("TEMPORARY");
    if (!cursor.word("TABLE")) return;
    cursor.ifExists();
    const table = cursor.name();
    if (table !== undefined) columns.delete(table);
    return;
  }
  if (!cursor.word("ALTER") || !cursor.word("TABLE")) return;
  cursor.ifExists();
  cursor.word("ONLY");
  const table = cursor.name();
  const set = table === undefined ? undefined : columns.get(table);
  if (table === undefined || set === undefined) return;
  if (!applyColumnClause(cursor, set)) columns.delete(table);
}

/**
 * Applies the one clause after `ALTER TABLE t` to `set`, returning whether it
 * was a column change this understands — false for anything else, including
 * a second clause.
 */
function applyColumnClause(cursor: TokenCursor, set: Set<string>): boolean {
  const adding = cursor.word("ADD");
  if (adding || cursor.word("DROP")) {
    if (cursor.peekWord(NON_COLUMN_ELEMENTS)) return false;
    cursor.word("COLUMN");
    cursor.ifExists();
    const column = cursor.name();
    if (column === undefined || cursor.hasTopLevelComma()) return false;
    if (adding) set.add(column);
    else set.delete(column);
    return true;
  }
  if (cursor.word("RENAME")) {
    if (cursor.peekWord(new Set(["TO", "AS"]))) return false;
    cursor.word("COLUMN");
    const from = cursor.name();
    if (from === undefined || !cursor.word("TO")) return false;
    const to = cursor.name();
    if (to === undefined || !cursor.done || !set.delete(from)) return false;
    set.add(to);
    return true;
  }
  return false;
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
export async function readLiveColumns(
  db: unknown,
  dialect: SupportedDialect,
  statementLists: ReadonlyArray<readonly string[]>
): Promise<LiveColumns> {
  const tables = [
    ...new Set(statementLists.flatMap(list => rebuiltTables(list, dialect))),
  ];
  if (tables.length === 0) return new Map();
  const { queryLiveColumnTypes } = await import(
    "../pipeline/live-column-types"
  );
  const live = await queryLiveColumnTypes(db, dialect, tables);
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

  const creating = new TokenCursor(create);
  if (!creating.word("CREATE") || !creating.word("TABLE")) return undefined;
  creating.ifExists();
  const twin = creating.name();
  if (!twin?.startsWith(REBUILD_PREFIX)) return undefined;
  const table = twin.slice(REBUILD_PREFIX.length);
  const columns = creating.columnDefinitions();
  if (!columns || columns.length === 0 || !creating.done) return undefined;

  const copying = new TokenCursor(copy);
  if (!copying.word("INSERT") || !copying.word("INTO")) return undefined;
  if (copying.name() !== twin) return undefined;
  const into = copying.nameList();
  if (!copying.word("SELECT")) return undefined;
  const selected = copying.bareNameList();
  if (!copying.word("FROM") || copying.name() !== table || !copying.done) {
    return undefined;
  }
  const same = (list: string[] | undefined) =>
    list !== undefined &&
    list.length === columns.length &&
    list.every((name, at) => name === columns[at]);
  if (!same(into) || !same(selected)) return undefined;

  const dropping = new TokenCursor(drop);
  if (!dropping.word("DROP") || !dropping.word("TABLE")) return undefined;
  dropping.ifExists();
  if (dropping.name() !== table || !dropping.done) return undefined;

  const renaming = new TokenCursor(rename);
  if (!renaming.word("ALTER") || !renaming.word("TABLE")) return undefined;
  if (renaming.name() !== twin) return undefined;
  if (!renaming.word("RENAME") || !renaming.word("TO")) return undefined;
  if (renaming.name() !== table || !renaming.done) return undefined;
  return { table, columns };
}

/** Which migration stream is running: `core`, `app`, or `plugin:<name>`. */
export type MigrationStream = string;

/**
 * Refuse a migration that drops a table belonging to another stream.
 *
 * Judged before execution and for the file as a WHOLE. An app migration
 * dropping `auth__identities` is refused; plugin-auth's own down migration
 * dropping it is allowed; a plugin dropping another plugin's table is refused.
 *
 * A table with NO owner row keeps today's behaviour exactly — it is not
 * refused. Absence means nobody has claimed it, and a migration that drops a
 * table nothing claims is the ordinary case for tables created before this
 * registry existed.
 *
 * Renaming or moving another stream's table is refused the same way. After
 * the rename no owner row names the table, so a later drop of the new name —
 * in another module, or an uninstall's DOWN — would be judged by a name
 * nobody claims and approved.
 */
export function assertNoForeignDrops(args: {
  statements: readonly string[];
  stream: MigrationStream;
  owners: ReadonlyMap<string, OwnerRecord>;
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
}): void {
  // Looked up case-insensitively. PostgreSQL folds an unquoted
  // `DROP TABLE APP_NOTES` to `app_notes`, and an exact lookup of the name as
  // written found no owner and approved it. Folding every name can only match
  // MORE owner rows than the database's own rules would, which refuses more,
  // never less.
  const ownersByName = new Map<string, OwnerRecord[]>();
  for (const [name, record] of args.owners) {
    const key = name.toLowerCase();
    ownersByName.set(key, [...(ownersByName.get(key) ?? []), record]);
  }
  let read: Pick<DropReader, "dropped" | "renamed">;
  try {
    read = readStatements(args.statements, args.dialect, args.liveColumns);
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
  const foreignOwner = (table: string): OwnerRecord | undefined =>
    ownersByName.get(table)?.find(record => record.migratedBy !== args.stream);
  for (const table of read.dropped) {
    const owner = foreignOwner(table);
    if (!owner) continue;

    throw new NextlyError({
      code: "DROP_OF_FOREIGN_TABLE",
      publicMessage:
        "A migration would drop a table that belongs to a different owner. It has been refused, and nothing was applied.",
      logContext: {
        table,
        droppedBy: args.stream,
        belongsTo: owner.migratedBy,
        ownerId: owner.ownerId,
        source: args.source,
      },
    });
  }
  for (const table of read.renamed) {
    const owner = foreignOwner(table);
    if (!owner) continue;

    // The foreign-drop code: a rename takes the table from its owner's name
    // just as a drop does, and the operator's remedy is the same.
    throw new NextlyError({
      code: "DROP_OF_FOREIGN_TABLE",
      publicMessage:
        "A migration would rename a table that belongs to a different owner. It has been refused, and nothing was applied.",
      logContext: {
        table,
        renamedBy: args.stream,
        belongsTo: owner.migratedBy,
        ownerId: owner.ownerId,
        source: args.source,
      },
    });
  }
}

/**
 * Whether dev push may drop this table.
 *
 * A plugin-migrated table is never dropped by dev push, whatever the desired
 * set says. Dev push reconciles what the CONFIG describes, and a plugin table
 * removed from config is exactly the moment its data is most at risk — the
 * plugin is being uninstalled, and that is a decision for `nextly plugins uninstall`
 * rather than a side effect of a reload.
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
