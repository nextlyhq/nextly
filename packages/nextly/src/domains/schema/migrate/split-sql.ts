/**
 * A migration's SQL text as the statements the runner executes, one per
 * driver call, and the check that decides whether they may run inside the
 * runner's transaction at all.
 *
 * Splitting is pure: it reads the text through the shared scanner
 * (`sql-scan.ts`) — the one the drop guard reads through — and never refuses.
 * What may not run is a separate question (`statementRefusals`), asked by
 * every path before it executes anything and by none that only previews.
 *
 * @module domains/schema/migrate/split-sql
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";

import { scanSql } from "./sql-scan";

/** The marker drizzle-kit writes between the statements of a generated file. */
const BREAKPOINT = "--> statement-breakpoint";

/**
 * The first line that marks a migration file to run outside a transaction,
 * statement by statement, so it can hold a statement a transaction refuses,
 * such as PostgreSQL's `CREATE INDEX CONCURRENTLY`.
 */
export const NO_TRANSACTION_MARKER = "-- nextly:no-transaction";

/**
 * Whether a migration file's text is marked to run outside a transaction:
 * its first line, past a byte-order mark and trailing whitespace, is
 * `NO_TRANSACTION_MARKER`. Only the first line counts, so the marker is a
 * decision about the whole file, made where a reader sees it first.
 */
export function marksNoTransaction(content: string): boolean {
  const firstLine = content.replace(/^\uFEFF/, "").split("\n", 1)[0] ?? "";
  return firstLine.trimEnd() === NO_TRANSACTION_MARKER;
}

/**
 * How a migration unit runs, as far as the refusals need to know: inside the
 * runner's transaction or outside one, and whether it is a migration file or
 * a plugin's module, which are marked to run outside one differently.
 */
export interface MigrationRunMode {
  transaction: boolean;
  unit: "file" | "module";
}

/** An unmarked migration file: the mode every unit has unless marked. */
const IN_TRANSACTION_FILE: MigrationRunMode = {
  transaction: true,
  unit: "file",
};

/** How the author marks a unit of this kind to run outside a transaction. */
function markAdvice(unit: MigrationRunMode["unit"]): string {
  return unit === "module"
    ? "set `transaction: false` on the module"
    : `make \`${NO_TRANSACTION_MARKER}\` the file's first line`;
}

/**
 * drizzle-kit's breakpoint markers and whole-line comments removed, leaving
 * every string, quoted name, block comment and dollar-quoted body as written.
 *
 * Two marker shapes: standalone on its own line, and inline after a `;`
 * (`CREATE INDEX ...;--> statement-breakpoint`). The marker is removed and
 * whatever follows it on the line is kept as SQL. A marker counts only where
 * the scanner reads code or the start of a line comment — MySQL does not read
 * `-->` as a comment, so it has to be found in code as well — and never
 * inside a quoted segment, where the text is data, a block comment, where a
 * line beginning `--` can hold the `*\/` that closes it, or the rest of an
 * earlier line comment.
 */
function withoutMarkers(sql: string, dialect?: SupportedDialect): string {
  const commentStarts = new Set<number>();
  // Characters no marker or comment line can start at.
  const opaque: boolean[] = new Array<boolean>(sql.length).fill(false);
  for (const segment of scanSql(sql, dialect)) {
    if (segment.kind === "code") continue;
    opaque.fill(true, segment.start, segment.end);
    if (segment.kind === "line-comment") {
      commentStarts.add(segment.start);
      opaque[segment.start] = false;
    }
  }
  const markerAt = (at: number) =>
    !opaque[at] && sql.startsWith(BREAKPOINT, at);

  let lineStart = 0;
  return sql
    .split("\n")
    .map(line => {
      const entry = { line, start: lineStart };
      lineStart += line.length + 1;
      return entry;
    })
    .filter(({ line, start }) => {
      const first = line.search(/\S/);
      if (first === -1) return true;
      const at = start + first;
      if (markerAt(at)) return false;
      // Only a line that begins a line comment is a comment line; one that
      // begins inside a quoted segment or a block comment continues it.
      if (!commentStarts.has(at)) return true;
      // Pure comment lines go, unless they mention DDL a reader may want kept.
      const trimmed = line.trim();
      return (
        trimmed.includes("CREATE") ||
        trimmed.includes("ALTER") ||
        trimmed.includes("DROP") ||
        trimmed.includes("INSERT")
      );
    })
    .map(({ line, start }) => {
      let out = "";
      for (let i = 0; i < line.length; i++) {
        if (markerAt(start + i)) {
          i += BREAKPOINT.length - 1;
          continue;
        }
        out += line[i];
      }
      return out;
    })
    .join("\n");
}

/**
 * Whether a split fragment holds anything to execute: text outside its
 * comments. Every such fragment is a statement, whatever its first keyword —
 * `CALL`, `SET`, `COMMENT ON`, `DO` — so a migration's statement is never
 * dropped for not being one the splitter recognises. A fragment of comments
 * alone, the tail after a file's last semicolon, is not. On MySQL an
 * executable comment (`/*! ... *\/`) is text MySQL runs, so it counts.
 */
export function hasExecutableText(
  statement: string,
  dialect: SupportedDialect | undefined
): boolean {
  return scanSql(statement, dialect).some(segment => {
    if (segment.kind === "line-comment") return false;
    if (segment.kind === "block-comment") return segment.executable;
    if (segment.kind !== "code") return true;
    return /\S/.test(statement.slice(segment.start, segment.end));
  });
}

/**
 * The statement's leading keywords, upper-cased, as the server reads them:
 * comments skipped, and on MySQL an executable comment's body read as the
 * code it is. Reading stops at the first quoted segment.
 */
function leadingWords(
  statement: string,
  dialect: SupportedDialect | undefined,
  count: number
): string[] {
  const words: string[] = [];
  for (const segment of scanSql(statement, dialect)) {
    if (segment.kind === "line-comment") continue;
    let code: string;
    if (segment.kind === "code") {
      code = statement.slice(segment.start, segment.end);
    } else if (segment.kind === "block-comment") {
      if (!segment.executable) continue;
      // `/*!40014 SET ... */`: the version number is not part of the code.
      code = statement
        .slice(segment.start, segment.end)
        .replace(/^\/\*M?!\d*/i, "")
        .replace(/\*\/$/, "");
    } else {
      break;
    }
    for (const token of code.match(/@{0,2}[A-Za-z_][\w$.]*|\S/g) ?? []) {
      words.push(token.toUpperCase());
      if (words.length === count) return words;
    }
  }
  return words;
}

/**
 * What a statement does to the runner's transaction.
 *
 * - `bracket`: it opens or closes one — `BEGIN` (with any modifiers:
 *   SQLite's `DEFERRED`/`IMMEDIATE`/`EXCLUSIVE`, PostgreSQL's isolation and
 *   access modes, `WORK`/`TRANSACTION`), `START TRANSACTION` (with any
 *   characteristics), `COMMIT`, `END`. A unit that runs inside the runner's
 *   own transaction has its brackets left out: a COMMIT would end the
 *   runner's transaction early, and a BEGIN inside it fails on SQLite.
 * - `refused`: it would undo or hand off the runner's transaction —
 *   `ROLLBACK`/`ABORT`, `COMMIT PREPARED`, `PREPARE TRANSACTION`, MySQL's
 *   `XA`. Leaving it out would change what the file does, and running it
 *   would roll back work the runner then records.
 * - `savepoint`: `SAVEPOINT`, `RELEASE [SAVEPOINT]` and
 *   `ROLLBACK [WORK | TRANSACTION] TO [SAVEPOINT]`. They work inside the
 *   runner's transaction and undo at most part of the unit, so there they
 *   run as written.
 *
 * Read from the statement's leading keywords only. A `BEGIN` or `END` inside
 * a PostgreSQL `DO` or function body is inside a dollar-quoted segment and
 * never leads a statement; PL/pgSQL's `END IF`/`END LOOP` live only there.
 */
export function transactionControlOf(
  statement: string,
  dialect?: SupportedDialect
): "bracket" | "refused" | "savepoint" | null {
  const [first, second, third] = leadingWords(statement, dialect, 3);
  switch (first) {
    case "BEGIN":
    case "END":
      return "bracket";
    case "START":
      return second === "TRANSACTION" ? "bracket" : null;
    case "COMMIT":
      return second === "PREPARED" ? "refused" : "bracket";
    case "ROLLBACK": {
      // `ROLLBACK [WORK | TRANSACTION] TO` returns to a savepoint the file
      // set, inside the runner's transaction; a bare ROLLBACK, with or
      // without the optional word, ends that transaction.
      const next =
        second === "WORK" || second === "TRANSACTION" ? third : second;
      return next === "TO" ? "savepoint" : "refused";
    }
    case "SAVEPOINT":
    case "RELEASE":
      return "savepoint";
    case "ABORT":
    case "XA":
      return "refused";
    case "PREPARE":
      return second === "TRANSACTION" ? "refused" : null;
    default:
      return null;
  }
}

/**
 * The session setting a statement changes that outlives the transaction,
 * or undefined when it changes none.
 *
 * The runner executes on a pooled connection that goes back to the pool —
 * at boot, the application's own pool — so a session setting a migration
 * makes stays on that connection for whatever it serves next:
 * `SET FOREIGN_KEY_CHECKS = 0` leaves foreign keys unchecked for unrelated
 * requests. Transaction-scoped forms are not session settings: PostgreSQL's
 * `SET LOCAL`, `SET CONSTRAINTS` and `SET TRANSACTION`, which a unit run
 * outside a transaction may not hold (`needsTransactionReason`), and MySQL
 * user variables (`SET @x = ...`), which only code that reads them sees. MySQL's
 * `SET TRANSACTION` configures the connection's NEXT transaction, so it is
 * refused with the rest.
 *
 * SQLite runs on the process's one connection, and its `PRAGMA`s are not
 * judged here. The one that matters, `foreign_keys`, cannot change inside a
 * transaction, so a unit that runs in one cannot change it; a unit that runs
 * outside one may not write it (`foreignKeyPragmaOf`), because the runner
 * switches enforcement off around that unit and restores it afterwards.
 */
function sessionSettingOf(
  statement: string,
  dialect: SupportedDialect | undefined
): string | undefined {
  const [first, second, third] = leadingWords(statement, dialect, 3);
  // The setting a SET names, past a SESSION/GLOBAL scope word and MySQL's
  // `@@session.` prefix: what the refusal tells the operator they changed.
  const setting = (
    second === "SESSION" || second === "GLOBAL" ? third : second
  )?.replace(/^@@(?:SESSION\.|GLOBAL\.)?/, "");
  if (dialect === "postgresql") {
    if (first === "RESET" || first === "DISCARD") return first;
    if (
      first !== "SET" ||
      second === "LOCAL" ||
      second === "CONSTRAINTS" ||
      second === "TRANSACTION"
    ) {
      return undefined;
    }
    return setting ?? first;
  }
  if (dialect === "mysql") {
    if (first !== "SET") return undefined;
    if (second?.startsWith("@") === true && !second.startsWith("@@")) {
      return undefined;
    }
    return setting ?? first;
  }
  return undefined;
}

/**
 * Why a statement needs the transaction that a unit run outside one does
 * not have, or undefined when it needs none.
 *
 * - The unit's own `BEGIN`, `START TRANSACTION`, `COMMIT` and `END`: in a
 *   unit run outside a transaction each statement commits as it runs, so a
 *   COMMIT has nothing to end, and a BEGIN would open a transaction that
 *   holds every later statement and that the runner never ends.
 * - Savepoints: PostgreSQL refuses one outside a transaction block, SQLite
 *   opens a transaction for one that the runner never ends, and MySQL, with
 *   each statement committed as it runs, keeps nothing to return to.
 * - PostgreSQL's `SET LOCAL`, `SET CONSTRAINTS` and `SET TRANSACTION`: each
 *   lasts until the transaction ends, and outside one PostgreSQL warns and
 *   ignores it, so the statements after it run without the setting the
 *   author wrote it for.
 */
function needsTransactionReason(
  statement: string,
  dialect: SupportedDialect | undefined
): string | undefined {
  const control = transactionControlOf(statement, dialect);
  if (control === "bracket") {
    return "opens or ends a transaction, and each statement of a unit run outside one commits as it runs.";
  }
  if (control === "savepoint") {
    return "marks or returns to a savepoint, which exists only inside a transaction.";
  }
  if (dialect !== "postgresql") return undefined;
  const [first, second] = leadingWords(statement, dialect, 2);
  return first === "SET" &&
    (second === "LOCAL" || second === "CONSTRAINTS" || second === "TRANSACTION")
    ? "lasts only until the transaction ends, and outside one PostgreSQL ignores it."
    : undefined;
}

/** How the author moves a statement into a unit that runs in a transaction. */
function inTransactionAdvice(unit: MigrationRunMode["unit"]): string {
  return unit === "module"
    ? "move it to a module without `transaction: false`, which runs in one"
    : `move it to a file without \`${NO_TRANSACTION_MARKER}\` as its first line, which runs in one`;
}

/**
 * The SQLite foreign-key pragma a statement writes, or undefined when it
 * writes none: `PRAGMA [schema.]foreign_keys = ...` or
 * `PRAGMA [schema.]defer_foreign_keys = ...`, either spelling of the
 * assignment. Reading one (`PRAGMA foreign_keys`) changes nothing.
 */
function foreignKeyPragmaOf(
  statement: string,
  dialect: SupportedDialect | undefined
): string | undefined {
  if (dialect !== "sqlite") return undefined;
  const [first, name, assignment] = leadingWords(statement, dialect, 3);
  if (first !== "PRAGMA" || (assignment !== "=" && assignment !== "(")) {
    return undefined;
  }
  const pragma = name?.slice(name.lastIndexOf(".") + 1);
  return pragma === "FOREIGN_KEYS" || pragma === "DEFER_FOREIGN_KEYS"
    ? pragma.toLowerCase()
    : undefined;
}

/** A statement as a refusal quotes it: its first line, bounded. */
function quoted(statement: string): string {
  const line = statement.split("\n")[0] ?? statement;
  return `"${line.length > 120 ? `${line.slice(0, 117)}...` : line}"`;
}

/**
 * Why a session-setting statement is refused, and what to write instead.
 * Foreign-key checks get their own advice: switching them off is the usual
 * reason to reach for the setting, and there is a way to do without it.
 */
function sessionSettingMessage(
  statement: string,
  setting: string,
  dialect: SupportedDialect | undefined,
  mode: MigrationRunMode
): string {
  const lingers = `${quoted(statement)} changes a session setting (${setting}) that would stay on the pooled connection after the migration, and apply to whatever that connection serves next.`;
  if (dialect === "mysql" && setting === "FOREIGN_KEY_CHECKS") {
    return `${lingers} Order the statements instead — create a table before the tables that reference it, and drop it after them — or drop the foreign key and add it back within the migration.`;
  }
  if (dialect === "postgresql") {
    return setting === "RESET" || setting === "DISCARD"
      ? `${quoted(statement)} resets session state on a pooled connection the application shares. Remove it.`
      : mode.transaction
        ? `${lingers} Use SET LOCAL ${setting.toLowerCase()} ..., which ends with the migration's transaction.`
        : // Outside a transaction SET LOCAL has nothing to end with, and
          // does nothing.
          `${lingers} A ${mode.unit} that runs outside a transaction has none for SET LOCAL to end with: move the statements that need the setting to one that runs in a transaction, and use SET LOCAL there.`;
  }
  return `${lingers} Remove it, or keep the value in a user variable (SET @name = ...), which only statements that read it see.`;
}

/** One statement a migration may not run, and why. */
export interface StatementRefusal {
  statement: string;
  code:
    | "TRANSACTION_CONTROL_IN_MIGRATION"
    | "NEEDS_TRANSACTION_IN_MIGRATION"
    | "SESSION_SETTING_IN_MIGRATION"
    | "NOT_TRANSACTIONAL_IN_MIGRATION";
  message: string;
}

/**
 * The statements in a split migration that the runner refuses to execute.
 * Pure, so a preview can report them; `assertRunnableStatements` is the
 * refusal every executing path makes before its first statement runs.
 */
export function statementRefusals(
  statements: readonly string[],
  dialect: SupportedDialect | undefined,
  mode: MigrationRunMode = IN_TRANSACTION_FILE
): StatementRefusal[] {
  return statements.flatMap(statement => {
    const refusal = refusalOf(statement, dialect, mode);
    return refusal === undefined ? [] : [refusal];
  });
}

/** Why the runner refuses one statement in a unit run as `mode` says. */
function refusalOf(
  statement: string,
  dialect: SupportedDialect | undefined,
  mode: MigrationRunMode
): StatementRefusal | undefined {
  if (transactionControlOf(statement, dialect) === "refused") {
    return {
      statement,
      code: "TRANSACTION_CONTROL_IN_MIGRATION",
      message: transactionControlMessage(statement, dialect, mode),
    };
  }
  if (!mode.transaction) {
    const needs = needsTransactionReason(statement, dialect);
    if (needs !== undefined) {
      return {
        statement,
        code: "NEEDS_TRANSACTION_IN_MIGRATION",
        message: `${quoted(statement)} ${needs} It needs a transaction, and this ${mode.unit} runs outside one: ${inTransactionAdvice(mode.unit)}.`,
      };
    }
    const pragma = foreignKeyPragmaOf(statement, dialect);
    if (pragma !== undefined) {
      return {
        statement,
        code: "SESSION_SETTING_IN_MIGRATION",
        message: `${quoted(statement)} changes ${pragma}, which the runner sets for a ${mode.unit} that runs outside a transaction: it switches foreign-key enforcement off before the first statement, checks every reference after the last, and restores the setting afterwards. Remove it.`,
      };
    }
  }
  const setting = sessionSettingOf(statement, dialect);
  if (setting !== undefined) {
    return {
      statement,
      code: "SESSION_SETTING_IN_MIGRATION",
      message: sessionSettingMessage(statement, setting, dialect, mode),
    };
  }
  const outside = outsideTransactionReason(statement, dialect, mode);
  // A statement the database runs only outside a transaction runs in a unit
  // marked to run outside one.
  if (outside === undefined || (outside.markable && !mode.transaction)) {
    return undefined;
  }
  return {
    statement,
    code: "NOT_TRANSACTIONAL_IN_MIGRATION",
    message: outside.markable
      ? `${quoted(statement)} ${outside.reason} To run it as a migration, ${markAdvice(mode.unit)}: the ${mode.unit} then runs outside a transaction, statement by statement, and a failure part-way leaves the statements before it applied.`
      : `${quoted(statement)} ${outside.reason} Remove it.`,
  };
}

/**
 * Why a statement that ends or hands off a transaction is refused: inside
 * the runner's transaction it would end that transaction, and outside one it
 * would act on a transaction the runner does not own.
 */
function transactionControlMessage(
  statement: string,
  dialect: SupportedDialect | undefined,
  mode: MigrationRunMode
): string {
  const keyword = leadingWords(statement, dialect, 1)[0] ?? "it";
  if (!mode.transaction) {
    return `${quoted(statement)}: a migration may not contain ${keyword}, which ends or hands off a transaction the runner does not own. Remove it.`;
  }
  const savepoint =
    keyword === "ROLLBACK"
      ? ", or undo part of it with SAVEPOINT name and ROLLBACK TO SAVEPOINT name"
      : "";
  return `${quoted(statement)}: a migration runs inside the runner's own transaction, so it may not contain ${keyword}. Remove it and let the ${mode.unit} run as one transaction${savepoint}.`;
}

/**
 * Why a statement cannot run inside the migration's transaction, and
 * whether marking the unit to run outside one lets it run — or undefined
 * when it runs inside one.
 *
 * Markable: the database refuses these inside a transaction, and runs them
 * outside one.
 *
 * - PostgreSQL: `VACUUM`, anything `CONCURRENTLY` (`CREATE`/`DROP INDEX`,
 *   `REINDEX`), `CREATE`/`DROP DATABASE`, `CREATE`/`DROP TABLESPACE`,
 *   `ALTER SYSTEM`.
 * - SQLite: `VACUUM`.
 *
 * Not markable: they leave state on the connection after the migration, so
 * running them outside a transaction would not help.
 *
 * - SQLite's `ATTACH` and `DETACH` change which databases the process's one
 *   connection sees.
 * - MySQL's `LOCK TABLES`/`UNLOCK TABLES` (and the INSTANCE forms) commit
 *   the transaction implicitly, and the locks stay with the pooled
 *   connection.
 *
 * PostgreSQL's `ALTER TYPE ... ADD VALUE` is not among them: from
 * PostgreSQL 12 it runs inside a transaction, though the value it adds
 * cannot be used before that transaction commits.
 */
function outsideTransactionReason(
  statement: string,
  dialect: SupportedDialect | undefined,
  mode: MigrationRunMode
): { reason: string; markable: boolean } | undefined {
  const words = leadingWords(statement, dialect, 6);
  const [first, second] = words;
  const inOne = `cannot run inside a transaction, and this ${mode.unit} runs in one.`;
  if (dialect === "postgresql") {
    if (first === "VACUUM") return { reason: inOne, markable: true };
    if (
      (first === "CREATE" || first === "DROP" || first === "REINDEX") &&
      words.includes("CONCURRENTLY")
    ) {
      return {
        reason: `builds or drops concurrently, which PostgreSQL cannot do inside a transaction, and this ${mode.unit} runs in one.`,
        markable: true,
      };
    }
    if (
      (first === "CREATE" || first === "DROP") &&
      (second === "DATABASE" || second === "TABLESPACE")
    ) {
      return { reason: inOne, markable: true };
    }
    if (first === "ALTER" && second === "SYSTEM") {
      return {
        reason: `changes the server's configuration, which cannot be done inside a transaction, and this ${mode.unit} runs in one.`,
        markable: true,
      };
    }
    return undefined;
  }
  if (dialect === "sqlite") {
    if (first === "VACUUM") return { reason: inOne, markable: true };
    return first === "ATTACH" || first === "DETACH"
      ? {
          reason:
            "changes which databases the process's one connection sees, and that outlives the migration.",
          markable: false,
        }
      : undefined;
  }
  if (dialect === "mysql") {
    const locking = first === "LOCK" || first === "UNLOCK";
    return locking &&
      (second === "TABLES" || second === "TABLE" || second === "INSTANCE")
      ? {
          reason: mode.transaction
            ? "commits the migration's transaction implicitly and holds its locks on the pooled connection after the migration."
            : "holds its locks on the pooled connection after the migration.",
          markable: false,
        }
      : undefined;
  }
  return undefined;
}

/**
 * Refuses a migration with any statement `statementRefusals` names, before
 * anything runs. `source` names the file or module for the operator.
 */
export function assertRunnableStatements(
  statements: readonly string[],
  dialect: SupportedDialect | undefined,
  source: string,
  mode: MigrationRunMode = IN_TRANSACTION_FILE
): void {
  const refusals = statementRefusals(statements, dialect, mode);
  if (refusals.length === 0) return;
  throw NextlyError.invalidInput({
    message: `${source} was refused, and nothing in it ran. ${refusals
      .map(refusal => refusal.message)
      .join(" ")}`,
    logContext: {
      source,
      refusals: refusals.map(refusal => refusal.code),
    },
  });
}

/** What a routine or trigger definition creates, as its CREATE names it. */
const ROUTINE_KINDS = new Set(["TRIGGER", "PROCEDURE", "FUNCTION", "EVENT"]);

/**
 * Words after END that close a construct no BEGIN or CASE opened: MySQL's
 * `END IF`, `END LOOP`, `END WHILE`, `END REPEAT`, PL/SQL-style `END FOR`.
 */
const NON_BLOCK_ENDS = new Set(["IF", "LOOP", "WHILE", "REPEAT", "FOR"]);

/**
 * The code tokens of a text: its words, upper-cased, and every other
 * non-space character on its own. Quoted segments and comments produce none.
 */
function codeTokens(
  text: string,
  dialect: SupportedDialect | undefined
): string[] {
  const tokens: string[] = [];
  for (const segment of scanSql(text, dialect)) {
    if (segment.kind !== "code") continue;
    const code = text.slice(segment.start, segment.end);
    for (const token of code.match(/[A-Za-z_][\w$]*|\S/g) ?? []) {
      tokens.push(token.toUpperCase());
    }
  }
  return tokens;
}

/** Tokens around a word that make it a name rather than a keyword. */
const NAME_BEFORE = new Set([".", ",", "(", "=", "SELECT", "SET"]);
const NAME_AFTER = new Set(["=", ",", ")", "."]);

/**
 * Whether the BEGIN, CASE or END at `i` is a keyword rather than a name.
 *
 * Any of them directly after a `.` is a qualified name — `NEW.end`,
 * `t.begin`. A BEGIN is also a name where only a name can stand: after a
 * comma, an opening parenthesis, `=`, SELECT or SET, or before `=`, a comma,
 * a closing parenthesis or a `.`. CASE and END are judged by the dot alone,
 * because a CASE expression stands exactly where a name can, and its END is
 * followed by whatever follows an expression.
 */
function isBlockKeyword(tokens: readonly string[], i: number): boolean {
  const before = tokens[i - 1];
  if (before === ".") return false;
  if (tokens[i] !== "BEGIN") return true;
  return !NAME_BEFORE.has(before ?? "") && !NAME_AFTER.has(tokens[i + 1] ?? "");
}

/**
 * Whether `text` — a statement read up to a `;` — is a routine or trigger
 * definition whose `BEGIN ... END` body is still open at that `;`.
 *
 * `CREATE [OR REPLACE] [DEFINER = ...] TRIGGER|PROCEDURE|FUNCTION|EVENT`, the
 * kind named before any parenthesis. Its body is a compound statement whose
 * inner `;`s separate the body's own statements: SQLite's and MySQL's
 * triggers, MySQL's procedures, functions and events, PostgreSQL's
 * `BEGIN ATOMIC` function bodies. Such a definition reaches the driver as ONE
 * statement, as a client with a `DELIMITER` would send it.
 *
 * Nesting counts `BEGIN` and `CASE` as openers and `END` as their closer —
 * `END CASE` included — while `END IF`, `END LOOP`, `END WHILE` and
 * `END REPEAT` close constructs that were never counted. Only a definition is
 * read this way; everywhere else a `;` ends the statement.
 */
function insideRoutineBody(
  text: string,
  dialect: SupportedDialect | undefined
): boolean {
  const words = codeTokens(text, dialect);
  if (words[0] !== "CREATE") return false;
  const kindAt = words.findIndex(w => ROUTINE_KINDS.has(w) || w === "(");
  if (kindAt === -1 || words[kindAt] === "(") return false;
  let depth = 0;
  for (let i = kindAt + 1; i < words.length; i++) {
    const word = words[i];
    if (!isBlockKeyword(words, i)) continue;
    if (word === "BEGIN" || word === "CASE") depth += 1;
    else if (word === "END" && !NON_BLOCK_ENDS.has(words[i + 1] ?? "")) {
      depth = Math.max(0, depth - 1);
      // `END CASE` is one closer; its CASE opens nothing.
      if (words[i + 1] === "CASE") i += 1;
    }
  }
  return depth > 0;
}

/**
 * The statements `sql` holds, one per driver call, in order.
 *
 * Split at every `;` in code, never inside a string, a quoted name, a
 * comment, a PostgreSQL dollar-quoted body or a routine's or trigger's
 * `BEGIN ... END` body (`insideRoutineBody`) — so a `DO $$ ... ; ... $$`
 * block, a function body or a `CREATE TRIGGER ... BEGIN ...; END` reaches
 * the driver whole, and its `END` is never read as a transaction bracket.
 * A fragment with nothing but comments is dropped, and so, in a unit that
 * runs in the runner's transaction, is the unit's own transaction bracket
 * (`transactionControlOf`). `mode` is how the unit runs: one that runs
 * outside a transaction keeps its brackets, so `statementRefusals` names
 * them rather than the split dropping them unseen. Everything else is kept
 * as written, including statements the runner will refuse: refusing is
 * `statementRefusals`' job.
 */
export function splitSqlStatements(
  sql: string,
  dialect?: SupportedDialect,
  mode: Pick<MigrationRunMode, "transaction"> = IN_TRANSACTION_FILE
): string[] {
  const cleaned = withoutMarkers(sql, dialect);
  const statements: string[] = [];
  const collect = (fragment: string): void => {
    const statement = fragment.trim();
    if (!hasExecutableText(statement, dialect)) return;
    if (
      mode.transaction &&
      transactionControlOf(statement, dialect) === "bracket"
    ) {
      return;
    }
    statements.push(statement);
  };

  let current = "";
  for (const segment of scanSql(cleaned, dialect)) {
    const text = cleaned.slice(segment.start, segment.end);
    if (segment.kind !== "code") {
      current += text;
      continue;
    }
    let from = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== ";") continue;
      const statement = current + text.slice(from, i);
      // A `;` inside a routine's or trigger's body separates the body's own
      // statements, not the file's.
      if (insideRoutineBody(statement, dialect)) continue;
      collect(statement);
      current = "";
      from = i + 1;
    }
    current += text.slice(from);
  }
  collect(current);
  return statements;
}
