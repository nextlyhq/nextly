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
 * **Known limit.** Only text is read. A function body written as an ordinary
 * single-quoted string (`AS 'DROP TABLE x'`), or SQL passed as a string to a
 * function that runs it, is data to this reader, not code. `EXECUTE` and
 * `PREPARE`, the statements that run SQL assembled at run time, are refused.
 *
 * @module domains/schema/ownership/drop-guard
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";

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
 * A PostgreSQL dollar-quote delimiter: `$$` or `$tag$`. A `$` followed by a
 * digit is a positional parameter (`$1`), not a delimiter, which the tag's
 * first character rules out.
 */
const DOLLAR_DELIMITER =
  /\$(?:(?:[A-Za-z_]|[^\p{ASCII}])(?:\w|[^\p{ASCII}])*)?\$/uy;

/**
 * How a quoted token treats a backslash.
 *
 * - `literal`: an ordinary character (SQLite strings, every quoted name).
 * - `escape`: escapes the next character (PostgreSQL's `E'...'`).
 * - `ambiguous`: its meaning depends on a server setting — MySQL's
 *   NO_BACKSLASH_ESCAPES, PostgreSQL's standard_conforming_strings — so
 *   where it sits immediately before the closing quote character, where the
 *   two readings end the string in different places, the statement is
 *   refused. Anywhere else both readings end the string at the same quote.
 */
type BackslashRule = "literal" | "escape" | "ambiguous";

/**
 * One lexing rule: whether it applies at a position, and how to read what
 * starts there. `read` pushes whatever tokens the text produces and returns
 * where the next token starts.
 */
interface LexRule {
  applies(text: string, at: number): boolean;
  read(text: string, at: number, out: Token[]): number;
}

/** One step through a quoted token: the text it adds and where it resumes. */
interface QuotedStep {
  add: string;
  next: number;
  /** Set on the closing quote, where the token ends. */
  closed?: boolean;
}

/** Lexes one statement's text. Every refusal names the whole statement. */
class Lexer {
  /**
   * The rules tried at each position, in order; the first that applies
   * reads the text there, and a position no rule claims is a word or a
   * punctuation character. The order matters: a MySQL `--` that is not a
   * comment falls through every later rule to punctuation, and a `$` that
   * does not start a dollar-quoted body falls through to a word.
   */
  private readonly rules: readonly LexRule[] = [
    { applies: (text, at) => /\s/.test(text[at]), read: (_, at) => at + 1 },
    {
      applies: (text, at) =>
        text.startsWith("--", at) && this.dashCommentAt(text, at),
      read: lineEnd,
    },
    {
      applies: (text, at) => text[at] === "#" && this.dialect === "mysql",
      read: lineEnd,
    },
    {
      applies: (text, at) => text.startsWith("/*", at),
      read: (text, at) => this.blockCommentEnd(text, at),
    },
    {
      applies: (text, at) => text[at] === "'",
      read: (text, at, out) => this.singleQuoted(text, at, out),
    },
    {
      applies: (text, at) => text[at] === '"',
      read: (text, at, out) => this.doubleQuoted(text, at, out),
    },
    {
      applies: (text, at) => text[at] === "`" && this.dialect !== "postgresql",
      read: (text, at, out) => this.backtickName(text, at, out),
    },
    {
      applies: (text, at) => text[at] === "[" && this.dialect === "sqlite",
      read: (text, at, out) => this.bracketedName(text, at, out),
    },
    {
      applies: (text, at) =>
        text[at] === "$" &&
        this.dialect === "postgresql" &&
        this.dollarAt(text, at) !== undefined,
      read: (text, at, out) => this.dollarBody(text, at, out),
    },
    {
      applies: (text, at) => text[at] === ";",
      read: (_, at, out) => {
        out.push({ kind: "end" });
        return at + 1;
      },
    },
  ];

  constructor(
    private readonly dialect: SupportedDialect,
    private readonly statement: string
  ) {}

  private refuse(reason: string): never {
    throw new UnparsableDropTarget(this.statement, reason);
  }

  tokens(text: string, out: Token[] = []): Token[] {
    let i = 0;
    while (i < text.length) i = this.readAt(text, i, out);
    return out;
  }

  /** Reads the token (or skips the whitespace or comment) starting at `at`. */
  private readAt(text: string, at: number, out: Token[]): number {
    const rule = this.rules.find(candidate => candidate.applies(text, at));
    return rule ? rule.read(text, at, out) : this.wordOrPunct(text, at, out);
  }

  /** A `'...'` string; SQLite also takes it as a name where one is expected. */
  private singleQuoted(text: string, at: number, out: Token[]): number {
    const quoted = this.quoted(text, at, "'", this.plainStringRule());
    out.push({
      kind: "string",
      asName: this.dialect === "sqlite" ? quoted.content : undefined,
    });
    return quoted.end;
  }

  /**
   * A `"..."` token. MySQL reads it as a string by default and as a name
   * under ANSI_QUOTES, so it carries both readings; elsewhere it is a name.
   */
  private doubleQuoted(text: string, at: number, out: Token[]): number {
    if (this.dialect === "mysql") {
      const quoted = this.quoted(text, at, '"', "ambiguous");
      out.push({ kind: "string", asName: quoted.content });
      return quoted.end;
    }
    const quoted = this.quoted(text, at, '"', "literal");
    out.push({ kind: "name", name: quoted.content });
    return quoted.end;
  }

  /** A MySQL or SQLite backtick-quoted name. */
  private backtickName(text: string, at: number, out: Token[]): number {
    const quoted = this.quoted(text, at, "`", "literal");
    out.push({ kind: "name", name: quoted.content });
    return quoted.end;
  }

  /** SQLite's bracketed name has no escape: it ends at the first `]`. */
  private bracketedName(text: string, at: number, out: Token[]): number {
    const end = text.indexOf("]", at + 1);
    if (end === -1) this.refuse("unterminated bracketed name");
    out.push({ kind: "name", name: text.slice(at + 1, end) });
    return end + 1;
  }

  /**
   * Whether `--` at `at` starts a comment. Always in PostgreSQL and SQLite;
   * in MySQL only when followed by whitespace, a control character or the
   * end of the text — otherwise `1--1` is arithmetic.
   */
  private dashCommentAt(text: string, at: number): boolean {
    if (this.dialect !== "mysql") return true;
    const next = text.charCodeAt(at + 2);
    return Number.isNaN(next) || next <= 0x20;
  }

  /**
   * Where the block comment starting at `at` ends.
   *
   * PostgreSQL nests block comments, so `/* /* *\/ x *\/` is one comment;
   * MySQL and SQLite end every block comment at the first `*\/`. MySQL and
   * MariaDB EXECUTE the body of `/*! ... *\/` and `/*M! ... *\/`, which to
   * every other reader is a comment, so on MySQL a statement carrying one is
   * refused rather than decide which server version would run it. An
   * unterminated comment is refused too, although SQLite would accept one.
   */
  private blockCommentEnd(text: string, at: number): number {
    if (this.dialect === "mysql" && /^\/\*M?!/i.test(text.slice(at, at + 4))) {
      this.refuse(
        "a MySQL executable comment (/*! ... */) runs text this guard reads as a comment"
      );
    }
    if (this.dialect !== "postgresql") {
      const end = text.indexOf("*/", at + 2);
      if (end === -1) this.refuse("unterminated block comment");
      return end + 2;
    }
    let depth = 1;
    let i = at + 2;
    while (i < text.length) {
      if (text.startsWith("/*", i)) {
        depth += 1;
        i += 2;
      } else if (text.startsWith("*/", i)) {
        depth -= 1;
        i += 2;
        if (depth === 0) return i;
      } else {
        i += 1;
      }
    }
    return this.refuse("unterminated block comment");
  }

  /** How a single-quoted string treats a backslash, per dialect. */
  private plainStringRule(): BackslashRule {
    return this.dialect === "sqlite" ? "literal" : "ambiguous";
  }

  /**
   * A quoted token starting at `at`: its content, with the doubled-quote
   * escape undone, and where it ends.
   */
  private quoted(
    text: string,
    at: number,
    close: string,
    backslash: BackslashRule
  ): { content: string; end: number } {
    let content = "";
    let i = at + 1;
    for (;;) {
      if (i >= text.length) this.refuse(unterminatedReason(close));
      const step = this.quotedStep(text, i, close, backslash);
      if (step.closed) return { content, end: step.next };
      content += step.add;
      i = step.next;
    }
  }

  /**
   * One character (or escape pair) inside a quoted token. A doubled closing
   * quote is one literal quote; a single one ends the token.
   */
  private quotedStep(
    text: string,
    at: number,
    close: string,
    backslash: BackslashRule
  ): QuotedStep {
    const c = text[at];
    if (c === "\\") return this.backslashStep(text, at, close, backslash);
    if (c !== close) return { add: c, next: at + 1 };
    if (text[at + 1] === close) return { add: close, next: at + 2 };
    return { add: "", next: at + 1, closed: true };
  }

  /** A backslash inside a quoted token, read by the token's rule. */
  private backslashStep(
    text: string,
    at: number,
    close: string,
    backslash: BackslashRule
  ): QuotedStep {
    if (backslash === "escape") {
      return { add: text.slice(at, at + 2), next: at + 2 };
    }
    if (backslash === "ambiguous" && text[at + 1] === close) {
      this.refuse(
        "a backslash before a quote ends the string in a place that depends on server settings"
      );
    }
    return { add: "\\", next: at + 1 };
  }

  private dollarAt(text: string, at: number): string | undefined {
    DOLLAR_DELIMITER.lastIndex = at;
    return DOLLAR_DELIMITER.exec(text)?.[0];
  }

  /**
   * A PostgreSQL dollar-quoted body, read as code.
   *
   * The body ends at the first repeat of its own delimiter, whatever lies
   * between. Its contents are lexed as a statement list of their own and
   * bracketed by `end` tokens, so a drop inside a `DO` block or a function
   * body is read like any other, and a drop's target list cannot run past
   * the body's edge.
   */
  private dollarBody(text: string, at: number, out: Token[]): number {
    const delimiter = this.dollarAt(text, at) as string;
    const bodyStart = at + delimiter.length;
    const bodyEnd = text.indexOf(delimiter, bodyStart);
    if (bodyEnd === -1) this.refuse("unterminated dollar-quoted body");
    out.push({ kind: "end" });
    this.tokens(text.slice(bodyStart, bodyEnd), out);
    out.push({ kind: "end" });
    return bodyEnd + delimiter.length;
  }

  private wordOrPunct(text: string, at: number, out: Token[]): number {
    WORD.lastIndex = at;
    const match = WORD.exec(text);
    if (!match) {
      out.push({ kind: "punct", char: text[at] });
      return at + 1;
    }
    const word = match[0];
    const end = at + word.length;
    const upper = word.toUpperCase();
    if (this.dialect === "postgresql") {
      // `E'...'` honours backslash escapes; the prefix has to be the whole
      // word, since `nameE'x'` is a name followed by a string.
      if (upper === "E" && text[end] === "'") {
        const quoted = this.quoted(text, end, "'", "escape");
        out.push({ kind: "string" });
        return quoted.end;
      }
      if (upper === "U" && text[end] === "&" && text[end + 1] === '"') {
        const quoted = this.quoted(text, end + 1, '"', "literal");
        out.push({ kind: "escaped-name" });
        return quoted.end;
      }
    }
    out.push({ kind: "word", upper, text: word });
    return end;
  }
}

/**
 * Where a line comment starting at `at` ends. PostgreSQL ends one at a
 * carriage return as well as a newline; ending there in every dialect reads
 * more text as code, never less.
 */
function lineEnd(text: string, at: number): number {
  for (let i = at; i < text.length; i += 1) {
    if (text[i] === "\n" || text[i] === "\r") return i;
  }
  return text.length;
}

/** Why a quoted token that never closes is refused, by its quote. */
function unterminatedReason(close: string): string {
  return close === "'" ? "unterminated string" : "unterminated quoted name";
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
    const original = this.renamedFrom.get(from) ?? from;
    this.renamedFrom.delete(from);
    if (to === original) this.renamedFrom.delete(to);
    else this.renamedFrom.set(to, original);
  }

  get isMysql(): boolean {
    return this.dialect === "mysql";
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
    }
    return at + 1;
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
      const newNameAt = this.tableRenameTargetAt(k);
      if (newNameAt === undefined) continue;
      table ??= this.qualifiedName(tableAt)?.name;
      table = this.recordTableRename(table, newNameAt);
    }
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
  dialect: SupportedDialect
): string[] {
  const reader = new DropReader(dialect);
  for (const statement of statements) reader.read(statement);
  return reader.dropped;
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
 */
export function assertNoForeignDrops(args: {
  statements: readonly string[];
  stream: MigrationStream;
  owners: ReadonlyMap<string, OwnerRecord>;
  /** The dialect the statements will run on, which decides how they read. */
  dialect: SupportedDialect;
  /** For the error message. */
  source: string;
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
  let dropped: string[];
  try {
    dropped = tablesDroppedBy(args.statements, args.dialect);
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
  for (const table of dropped) {
    const owner = ownersByName
      .get(table)
      ?.find(record => record.migratedBy !== args.stream);
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
