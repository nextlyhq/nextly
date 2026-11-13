/**
 * Whether a statement of a change may be sent again by a later try, once a try has ended waiting
 * for a busy table, or must stop the run with no retry.
 *
 * A try that ends leaves each statement it ran as the database keeps it. A schema statement or a
 * plain row change is undone by the rollback, or never ran where it was the one waiting, so the
 * next try may send it again. Some statements leave something a rollback does not take back: a
 * sequence moved by `setval`, an index built without blocking writes and left invalid, a write
 * that leaves the database, or code the system does not know (a function of the site's own, a
 * trigger the row change fires, an anonymous block). Sending those again could repeat what was
 * kept, so the run stops instead. A statement of a kind this reading does not recognise counts as
 * the last kind: no retry, the cautious answer, since a false "no retry" only stops a run early
 * with a clear report while a false retry could run site code twice.
 *
 * Statements are read through the shared statement cursor's tokens (`statementTokens`), the one
 * reading of a statement's words.
 *
 * @module domains/schema/busy-table/judge
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { statementTokens } from "../migrate/split-sql";
import type { StatementToken } from "../migrate/statement-cursor";

/** Why a statement stops the run with no retry. */
export type NoRetryReason =
  /** `setval`: the position it sets survives a rollback. */
  | "setval"
  /** An index built or dropped without blocking writes: an ended try can leave it invalid. */
  | "concurrent-index"
  /** A call of code the system does not know: a function or procedure of the site's own. */
  | "unknown-code"
  /** A row change on a table with a trigger, which runs code the system does not know. */
  | "trigger"
  /** A write that leaves the database's own transaction: another session, another database. */
  | "outside-write"
  /**
   * A row change on MySQL where the account cannot see every trigger: MySQL lists a table's
   * triggers only to an account holding `TRIGGER` on it, while a row change still fires them.
   */
  | "hidden-trigger"
  /**
   * A statement an earlier try kept that made state of its session alone (a temporary table, a
   * prepared statement, a cursor): the next try runs on a new session, which does not have it.
   */
  | "session-state"
  /**
   * A schema statement on PostgreSQL where the database has a DDL event trigger: it runs code the
   * system does not know on every CREATE, ALTER or DROP, and what that code did outside the
   * transaction stays when the try is rolled back.
   */
  | "event-trigger"
  /** A statement of a kind no row of the table names. */
  | "unread";

export type StatementJudgement =
  | { readonly kind: "may-run-again" }
  | { readonly kind: "no-retry"; readonly reason: NoRetryReason };

const MAY_RUN_AGAIN: StatementJudgement = { kind: "may-run-again" };

function noRetry(reason: NoRetryReason): StatementJudgement {
  return { kind: "no-retry", reason };
}

/**
 * The tables of the database with a trigger a row change would fire, lower-cased; or `"unseen"`
 * where the account cannot see every trigger, so any table may have one.
 */
export type TriggerTables = ReadonlySet<string> | "unseen";

/** A bare word: what the tokenizer gives an unquoted keyword or name, upper-cased. */
const WORD = /^[A-Z_][A-Z0-9_$]*$/;

/** Words followed by a parenthesis that are keywords, never calls. */
const PAREN_KEYWORDS = new Set([
  "KEY",
  "INDEX",
  "UNIQUE",
  "PRIMARY",
  "CHECK",
  "VALUES",
  "IN",
  "EXISTS",
  "AS",
  "USING",
  "INCLUDE",
  "AND",
  "OR",
  "NOT",
  "ON",
  "DEFAULT",
  "WHERE",
  "ALL",
  "ANY",
  "SOME",
  "OVER",
  "FILTER",
  "TABLE",
  "INTO",
  "REFERENCES",
  "FOREIGN",
  // A subquery: `SELECT (SELECT …)`.
  "SELECT",
  "WITH",
  "IDENTITY",
  // PostgreSQL's index methods, as drizzle-kit writes them: `USING btree (`.
  "BTREE",
  "HASH",
  "GIN",
  "GIST",
  "BRIN",
  "SPGIST",
]);

/** Type names written with a size or a list in parentheses. */
const PAREN_TYPES = new Set([
  "VARCHAR",
  "CHAR",
  "CHARACTER",
  "VARYING",
  "NUMERIC",
  "DECIMAL",
  "DEC",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "TIME",
  "TIMETZ",
  "BIT",
  "VARBIT",
  "FLOAT",
  "DOUBLE",
  "REAL",
  "INT",
  "INTEGER",
  "TINYINT",
  "SMALLINT",
  "MEDIUMINT",
  "BIGINT",
  "ENUM",
  "BINARY",
  "VARBINARY",
  "DATETIME",
  "INTERVAL",
  "TEXT",
  "BLOB",
  "NVARCHAR",
  "NCHAR",
  "YEAR",
]);

/**
 * Functions every supported database provides and none of them lets a site redefine as a call
 * that writes: the built-in allow-list. A call of any other function is code the system does not
 * know.
 */
const BUILT_IN_FUNCTIONS = new Set([
  "NOW",
  "CURRENT_TIMESTAMP",
  "CURRENT_DATE",
  "CURRENT_TIME",
  "LOCALTIMESTAMP",
  "COALESCE",
  "NULLIF",
  "LOWER",
  "UPPER",
  "LENGTH",
  "CHAR_LENGTH",
  "TRIM",
  "LTRIM",
  "RTRIM",
  "SUBSTRING",
  "SUBSTR",
  "REPLACE",
  "CONCAT",
  "CONCAT_WS",
  "CAST",
  "CONVERT",
  "ABS",
  "ROUND",
  "FLOOR",
  "CEIL",
  "CEILING",
  "GREATEST",
  "LEAST",
  "MAX",
  "MIN",
  "COUNT",
  "SUM",
  "AVG",
  "GEN_RANDOM_UUID",
  "UUID",
  "DATE",
  "STRFTIME",
  "UNIXEPOCH",
  "RANDOMBLOB",
  "HEX",
  "IFNULL",
  "JSON_OBJECT",
  "JSON_ARRAY",
  "JSON_EXTRACT",
  "JSON_BUILD_OBJECT",
  "JSONB_BUILD_OBJECT",
  "TO_JSON",
  "TO_JSONB",
  "JSONB_SET",
  "ARRAY_AGG",
  "STRING_AGG",
  "GROUP_CONCAT",
  "EXTRACT",
  "SHA2",
  "MD5",
  "WEIGHT_STRING",
  "UNIX_TIMESTAMP",
  "ROW_NUMBER",
  // What Nextly's own migration generator writes: the SQLite rebuild guard's `instr` and its
  // foreign-key read, and PostgreSQL's `timezone('utc', now())` default.
  "INSTR",
  "PRAGMA_FOREIGN_KEY_LIST",
  "PRAGMA_TABLE_INFO",
  "PRAGMA_INDEX_LIST",
  "TIMEZONE",
]);

/** Taking a value from a sequence: a rollback leaves a gap, never a repeat. */
const SEQUENCE_FUNCTIONS = new Set(["NEXTVAL", "CURRVAL"]);

/** Calls that act outside the database's own transaction. */
const OUTSIDE_WRITES =
  /^(PG_TERMINATE_BACKEND|PG_CANCEL_BACKEND|DBLINK.*|LO_EXPORT|LO_IMPORT|PG_NOTIFY)$/;

/** Words after which the next word is a name, even when a parenthesis follows it. */
const NAME_FOLLOWS = new Set([
  "TABLE",
  "INTO",
  "REFERENCES",
  "INDEX",
  "KEY",
  "ON",
  "EXISTS",
  "CONSTRAINT",
]);

/** A word, schema-qualified or not: `MAKE_SLUG`, `PUBLIC.MAKE_SLUG`. */
const QUALIFIED_WORD = /^[A-Z_][A-Z0-9_$]*(?:\.[A-Z_][A-Z0-9_$]*)*$/;

/** The schema that holds the built-in functions on PostgreSQL. */
const BUILT_IN_SCHEMA = "PG_CATALOG";

/**
 * The called function at `at`, upper-cased, or undefined where nothing is called there: a word or
 * a quoted name followed by a parenthesis, not a name followed by its column list
 * (`TABLE posts (`, `REFERENCES users (`). A quoted name is never a built-in, so it is returned as
 * the empty string, which no list holds.
 */
function calledAt(
  tokens: readonly StatementToken[],
  at: number,
  dialect: SupportedDialect
): string | undefined {
  if (tokens[at + 1] !== "(" || namesNotCalls(tokens, at, dialect)) {
    return undefined;
  }
  const word = tokens[at];
  if (typeof word !== "string") return word?.kind === "name" ? "" : undefined;
  return QUALIFIED_WORD.test(word) ? word : undefined;
}

/**
 * Whether the word at `at`, followed by a parenthesis, is no call: a name followed by its column
 * list (`TABLE posts (`, schema-qualified `"public"."users"(` read back past its qualifier), or a
 * MySQL index's prefix length (`KEY k (title(191))`). A type's size needs no exception here: the
 * type names are known (`PAREN_TYPES`). Any other word with numbers in its parentheses stays a
 * call, a default's `site_fn(1)` included.
 */
function namesNotCalls(
  tokens: readonly StatementToken[],
  at: number,
  dialect: SupportedDialect
): boolean {
  let beforeAt = at - 1;
  while (tokens[beforeAt] === ".") beforeAt -= 2;
  const before = tokens[beforeAt];
  if (typeof before === "string" && NAME_FOLLOWS.has(before)) return true;
  if (!onlyDigitsWithin(tokens, at + 1)) return false;
  if (inTypePosition(tokens, at)) return true;
  return dialect === "mysql" && inIndexColumnList(tokens, at);
}

/** Words after which a column's name, then its type, follow (`ADD COLUMN c type`). */
const COLUMN_DEFINERS = new Set(["(", ",", "COLUMN", "ADD", "MODIFY"]);

/**
 * Whether the word at `at` is a column's type, sized in a schema statement: it follows the
 * column's name, which follows `(`, `,`, `COLUMN`, `ADD` or `MODIFY` (`ADD COLUMN embedding
 * vector(1536)`), or it follows `TYPE` (`ALTER COLUMN c TYPE vector(1536)`). A type the
 * `PAREN_TYPES` list does not know, such as an extension's, is then still a type and no call. A
 * default's or a check's `site_fn(1)` follows no column name, and stays a call.
 */
function inTypePosition(
  tokens: readonly StatementToken[],
  at: number
): boolean {
  if (tokens[0] !== "CREATE" && tokens[0] !== "ALTER") return false;
  const before = tokens[at - 1];
  if (before === "TYPE") return true;
  const named =
    (typeof before === "string" && WORD.test(before)) ||
    (typeof before === "object" && before?.kind === "name");
  const definer = tokens[at - 2];
  return named && typeof definer === "string" && COLUMN_DEFINERS.has(definer);
}

/** Words that open an index's column list, directly (`PRIMARY KEY (`) or before its name. */
const INDEX_LIST_OPENERS = new Set(["KEY", "INDEX", "UNIQUE"]);

/**
 * Whether the word at `at` is an element of an index's column list: the parenthesis around it
 * follows `KEY`, `INDEX` or `UNIQUE`, or a name that follows one of them or `ON`
 * (`KEY k (`, `CREATE INDEX i ON posts (`). A default's or a check's parenthesis is no such list.
 */
function inIndexColumnList(
  tokens: readonly StatementToken[],
  at: number
): boolean {
  let depth = 0;
  for (let open = at - 1; open >= 0; open--) {
    const token = tokens[open];
    if (token === ")") depth++;
    if (token !== "(") continue;
    if (depth > 0) {
      depth--;
      continue;
    }
    const before = tokens[open - 1];
    if (typeof before === "string" && INDEX_LIST_OPENERS.has(before)) {
      return true;
    }
    // Back past the name and its schema qualifier (`ON shop.posts (`).
    let keywordAt = open - 2;
    while (tokens[keywordAt] === ".") keywordAt -= 2;
    const keyword = tokens[keywordAt];
    return (
      keyword === "ON" ||
      (typeof keyword === "string" && INDEX_LIST_OPENERS.has(keyword))
    );
  }
  return false;
}

/** Whether the parentheses opening at `open` hold nothing but digits. */
function onlyDigitsWithin(
  tokens: readonly StatementToken[],
  open: number
): boolean {
  let at = open + 1;
  if (tokens[at] === ")") return false;
  while (typeof tokens[at] === "string" && /^[0-9]$/.test(tokens[at] as string))
    at++;
  return tokens[at] === ")";
}

/**
 * What a call of `called` makes of a statement; undefined for a keyword, a type or a built-in. A
 * schema-qualified call is a built-in only where the schema is PostgreSQL's own catalog.
 */
function callVerdict(called: string): StatementJudgement | undefined {
  const parts = called.split(".");
  const word = parts[parts.length - 1];
  if (word === "SETVAL") return noRetry("setval");
  // A call qualified by any schema but the built-in catalog is the site's own code.
  const qualifier = parts.slice(0, -1).join(".");
  if (qualifier !== "" && qualifier !== BUILT_IN_SCHEMA) {
    return noRetry("unknown-code");
  }
  return wordVerdict(word);
}

/** Whether `word` is called harmlessly: a keyword's list, a type's size, a built-in function. */
function knownHarmless(word: string): boolean {
  return [
    PAREN_KEYWORDS,
    PAREN_TYPES,
    BUILT_IN_FUNCTIONS,
    SEQUENCE_FUNCTIONS,
  ].some(set => set.has(word));
}

/** What a call of the unqualified `word` makes of a statement; undefined where harmless. */
function wordVerdict(word: string): StatementJudgement | undefined {
  if (knownHarmless(word)) return undefined;
  return OUTSIDE_WRITES.test(word)
    ? noRetry("outside-write")
    : noRetry("unknown-code");
}

/**
 * What the calls in `tokens` make of the statement: no retry for `setval`, a write outside the
 * database or code the system does not know; undefined where every call is a built-in, a sequence
 * value, a type's size or a keyword's list.
 */
function callsVerdict(
  tokens: readonly StatementToken[],
  dialect: SupportedDialect
): StatementJudgement | undefined {
  for (let at = 0; at + 1 < tokens.length; at++) {
    const called = calledAt(tokens, at, dialect);
    if (called === undefined) continue;
    const verdict = callVerdict(called);
    if (verdict !== undefined) return verdict;
  }
  return undefined;
}

/** The table a token names, lower-cased; undefined for anything that is not a plain name. */
function tableName(
  tokens: readonly StatementToken[],
  at: number
): string | undefined {
  const token = tokens[at];
  // A schema-qualified name is read as no name: which schema it reaches is not decided here.
  if (tokens[at + 1] === ".") return undefined;
  if (typeof token === "string") {
    return WORD.test(token) ? token.toLowerCase() : undefined;
  }
  // A quoted name as it was written; one the tokenizer could not give back is read as no name.
  return token?.kind === "name" && token.written !== undefined
    ? token.written.toLowerCase()
    : undefined;
}

/** Words between a statement's keyword and the table it names, which name nothing. */
const TABLE_MODIFIERS = new Set(["IF", "NOT", "EXISTS", "ONLY"]);

/** The first position from `at` on that is not a modifier (`IF NOT EXISTS`, `ONLY`). */
function pastModifiers(tokens: readonly StatementToken[], at: number): number {
  let next = at;
  for (;;) {
    const token = tokens[next];
    if (typeof token !== "string" || !TABLE_MODIFIERS.has(token)) return next;
    next++;
  }
}

/** The position of the word after which each kind of statement names its table. */
function tableKeywordAt(tokens: readonly StatementToken[]): number | undefined {
  const first = tokens[0];
  const keyword =
    first === "UPDATE"
      ? "UPDATE"
      : first === "INSERT"
        ? "INTO"
        : first === "DELETE"
          ? "FROM"
          : startsWith(tokens, "CREATE", "INDEX") ||
              startsWith(tokens, "CREATE", "UNIQUE", "INDEX")
            ? "ON"
            : "TABLE";
  const at = tokens.indexOf(keyword);
  return at < 0 ? undefined : at;
}

/**
 * The table `statement` creates, changes, drops or writes, as one plain name, lower-cased; null
 * where it names none plainly. The table a busy-table report names as waited for.
 */
export function targetTable(
  statement: string,
  dialect: SupportedDialect
): string | null {
  const tokens = statementTokens(statement, dialect);
  const keyword = tableKeywordAt(tokens);
  if (keyword === undefined) return null;
  return tableName(tokens, pastModifiers(tokens, keyword + 1)) ?? null;
}

/** One table a statement renames: its name before and after, lower-cased. */
export interface TableRename {
  readonly from: string;
  readonly to: string;
}

/** The pairs of MySQL's `RENAME TABLE a TO b, c TO d`, or "unread" where a name is not plain. */
function renameTablePairs(
  tokens: readonly StatementToken[]
): TableRename[] | "unread" {
  const pairs: TableRename[] = [];
  let at = 2;
  for (;;) {
    const from = tableName(tokens, at);
    const to = tokens[at + 1] === "TO" ? tableName(tokens, at + 2) : undefined;
    if (from === undefined || to === undefined) return "unread";
    pairs.push({ from, to });
    if (tokens[at + 3] !== ",") return pairs;
    at += 4;
  }
}

/**
 * The tables `statement` renames, where it renames any: `ALTER TABLE a RENAME TO b` (or `AS`, on
 * MySQL), and MySQL's `RENAME TABLE a TO b`. "unread" where it renames a table whose names are not
 * plain, so a caller tracking what a name means can fail closed; an empty list for any other
 * statement, a column's or a constraint's rename included.
 */
export function renamedTables(
  statement: string,
  dialect: SupportedDialect
): readonly TableRename[] | "unread" {
  const tokens = statementTokens(statement, dialect);
  if (startsWith(tokens, "RENAME", "TABLE")) return renameTablePairs(tokens);
  if (!startsWith(tokens, "ALTER", "TABLE")) return [];
  const fromAt = pastModifiers(tokens, 2);
  const renameAt = fromAt + 1;
  if (tokens[renameAt] !== "RENAME") return [];
  const keyword = tokens[renameAt + 1];
  if (keyword !== "TO" && keyword !== "AS") return [];
  const from = tableName(tokens, fromAt);
  const to = tableName(tokens, renameAt + 2);
  return from === undefined || to === undefined ? "unread" : [{ from, to }];
}

/** Whether `tokens` start with `words`. */
function startsWith(
  tokens: readonly StatementToken[],
  ...words: string[]
): boolean {
  return words.every((word, i) => tokens[i] === word);
}

/** A row change: no retry where its table has a trigger, or its table cannot be named. */
function rowChange(
  tokens: readonly StatementToken[],
  tableAt: number,
  dialect: SupportedDialect,
  hasTrigger: (table: string) => boolean
): StatementJudgement {
  const calls = callsVerdict(tokens, dialect);
  if (calls !== undefined) return calls;
  const table = tableName(tokens, pastModifiers(tokens, tableAt));
  if (table === undefined) return noRetry("unread");
  return hasTrigger(table) ? noRetry("trigger") : MAY_RUN_AGAIN;
}

/** A statement that creates, changes or drops a table, column, index, key or check. */
function schemaStatement(
  tokens: readonly StatementToken[],
  dialect: SupportedDialect
): StatementJudgement {
  return callsVerdict(tokens, dialect) ?? MAY_RUN_AGAIN;
}

/** `CREATE …`: a table or an index, built without blocking writes or not; anything else unread. */
function createStatement(
  tokens: readonly StatementToken[],
  dialect: SupportedDialect
): StatementJudgement {
  const index = startsWith(tokens, "CREATE", "UNIQUE", "INDEX")
    ? 3
    : startsWith(tokens, "CREATE", "INDEX")
      ? 2
      : undefined;
  if (index !== undefined) {
    return dialect === "postgresql" && tokens[index] === "CONCURRENTLY"
      ? noRetry("concurrent-index")
      : schemaStatement(tokens, dialect);
  }
  return startsWith(tokens, "CREATE", "TABLE")
    ? schemaStatement(tokens, dialect)
    : noRetry("unread");
}

/** `DROP …`: a table or an index; anything else unread. */
function dropStatement(
  tokens: readonly StatementToken[],
  dialect: SupportedDialect
): StatementJudgement {
  if (startsWith(tokens, "DROP", "INDEX")) {
    return dialect === "postgresql" && tokens[2] === "CONCURRENTLY"
      ? noRetry("concurrent-index")
      : schemaStatement(tokens, dialect);
  }
  return startsWith(tokens, "DROP", "TABLE")
    ? schemaStatement(tokens, dialect)
    : noRetry("unread");
}

/** `SELECT …`: only taking a sequence's value runs again; `setval` and anything else do not. */
function selectStatement(
  tokens: readonly StatementToken[],
  dialect: SupportedDialect
): StatementJudgement {
  const calls = callsVerdict(tokens, dialect);
  if (calls !== undefined) return calls;
  const sequenceOnly =
    tokens.length >= 4 &&
    typeof tokens[1] === "string" &&
    SEQUENCE_FUNCTIONS.has(tokens[1]) &&
    tokens[2] === "(" &&
    tokens[tokens.length - 1] === ")";
  return sequenceOnly ? MAY_RUN_AGAIN : noRetry("unread");
}

/** How a statement is judged, by its first word; a first word not here is unread. */
type FirstWordJudge = (
  tokens: readonly StatementToken[],
  dialect: SupportedDialect,
  hasTrigger: (table: string) => boolean
) => StatementJudgement;

const BY_FIRST_WORD: Readonly<Record<string, FirstWordJudge>> = {
  CREATE: (tokens, dialect) => createStatement(tokens, dialect),
  DROP: (tokens, dialect) => dropStatement(tokens, dialect),
  ALTER: (tokens, dialect) =>
    startsWith(tokens, "ALTER", "TABLE") || startsWith(tokens, "ALTER", "INDEX")
      ? schemaStatement(tokens, dialect)
      : noRetry("unread"),
  RENAME: (tokens, dialect) =>
    dialect === "mysql" && startsWith(tokens, "RENAME", "TABLE")
      ? schemaStatement(tokens, dialect)
      : noRetry("unread"),
  INSERT: (tokens, dialect, hasTrigger) =>
    startsWith(tokens, "INSERT", "INTO")
      ? rowChange(tokens, 2, dialect, hasTrigger)
      : noRetry("unread"),
  UPDATE: (tokens, dialect, hasTrigger) =>
    rowChange(tokens, 1, dialect, hasTrigger),
  DELETE: (tokens, dialect, hasTrigger) =>
    startsWith(tokens, "DELETE", "FROM")
      ? rowChange(tokens, 2, dialect, hasTrigger)
      : noRetry("unread"),
  SELECT: (tokens, dialect) => selectStatement(tokens, dialect),
  // A setting of the connection: undone with a transaction, or still in force for the next try.
  SET: (tokens, dialect) =>
    dialect === "sqlite"
      ? noRetry("unread")
      : (callsVerdict(tokens, dialect) ?? MAY_RUN_AGAIN),
  // On SQLite only `foreign_keys` sets the connection alone; every other pragma is unread.
  PRAGMA: (tokens, dialect) =>
    dialect === "sqlite" && tokens[1] === "FOREIGN_KEYS"
      ? MAY_RUN_AGAIN
      : noRetry("unread"),
  DO: () => noRetry("unknown-code"),
  CALL: () => noRetry("unknown-code"),
};

/**
 * How a later try may treat `statement` on `dialect` once a try has ended waiting for a busy
 * table. `hasTrigger` answers, from the live catalog, whether a table has a trigger a row change
 * would fire.
 */
export function judgeStatement(
  statement: string,
  dialect: SupportedDialect,
  hasTrigger: (table: string) => boolean
): StatementJudgement {
  const tokens = statementTokens(statement, dialect);
  while (tokens.length > 0 && tokens[tokens.length - 1] === ";") tokens.pop();
  const first = tokens[0];
  const judge = typeof first === "string" ? BY_FIRST_WORD[first] : undefined;
  return judge === undefined
    ? noRetry("unread")
    : judge(tokens, dialect, hasTrigger);
}

/** What else of the database decides a judgement, beyond the statements and their tables. */
export interface JudgeContext {
  /**
   * Whether PostgreSQL has an enabled DDL event trigger that no installed extension owns
   * (`hasDdlEventTriggers`): every schema statement then runs code the system does not know.
   */
  readonly ddlEventTriggers?: boolean;
  /**
   * How many of the statements judged come before those a later try sends again: read only to
   * follow renames and settings, so an event trigger does not stop the run on them. 0 by default.
   */
  readonly ddlEventTriggersFrom?: number;
}

/** The first words of the statements a PostgreSQL DDL event trigger fires on. */
const DDL_FIRST_WORDS = new Set(["CREATE", "ALTER", "DROP"]);

/**
 * The first of `statements`, in order, that a later try may not send again: its position (1 for
 * the first, never its text, which can hold a literal value) and judgement; undefined where every
 * one may run again. `triggerTables` are the tables with a trigger before the first statement. A
 * table keeps its triggers through a rename, so a name an earlier statement gave such a table has
 * one too; a rename this reading cannot follow counts every table as having one, failing closed.
 * Where PostgreSQL has a DDL event trigger (`context`), every schema statement stops the run.
 */
export function firstNoRetry(
  statements: readonly string[],
  dialect: SupportedDialect,
  triggerTables: TriggerTables,
  context: JudgeContext = {}
):
  | {
      readonly statementNumber: number;
      readonly judgement: Extract<StatementJudgement, { kind: "no-retry" }>;
    }
  | undefined {
  // Where the triggers could not all be seen, every table may have one, so a row change counts as
  // one that fires a trigger: the cautious answer, failing closed.
  const unseen = triggerTables === "unseen";
  const triggered = new Set(unseen ? [] : triggerTables);
  let renameUnread = false;
  const hasTrigger = (table: string) =>
    unseen || renameUnread || triggered.has(table);
  const eventTriggers =
    dialect === "postgresql" && context.ddlEventTriggers === true;
  for (const [index, statement] of statements.entries()) {
    const judgement =
      eventTriggers && index >= (context.ddlEventTriggersFrom ?? 0)
        ? firesEventTrigger(statement, dialect, hasTrigger)
        : judgeStatement(statement, dialect, hasTrigger);
    if (judgement.kind === "no-retry") {
      // Named for what was not known, so the report does not claim the table has a trigger.
      const reason =
        judgement.reason === "trigger" && unseen
          ? "hidden-trigger"
          : judgement.reason;
      return {
        statementNumber: index + 1,
        judgement: { kind: "no-retry", reason },
      };
    }
    const renames = renamedTables(statement, dialect);
    if (renames === "unread") {
      renameUnread = true;
      continue;
    }
    for (const { from, to } of renames) {
      if (triggered.has(from)) triggered.add(to);
    }
  }
  return undefined;
}

/** `judgeStatement`, with a schema statement it would let run again stopped by an event trigger. */
function firesEventTrigger(
  statement: string,
  dialect: SupportedDialect,
  hasTrigger: (table: string) => boolean
): StatementJudgement {
  const judgement = judgeStatement(statement, dialect, hasTrigger);
  if (judgement.kind === "no-retry") return judgement;
  const [first] = statementTokens(statement, dialect);
  return typeof first === "string" && DDL_FIRST_WORDS.has(first)
    ? noRetry("event-trigger")
    : judgement;
}
