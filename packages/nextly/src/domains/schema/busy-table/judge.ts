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
  /** A statement of a kind no row of the table names. */
  | "unread";

export type StatementJudgement =
  | { readonly kind: "may-run-again" }
  | { readonly kind: "no-retry"; readonly reason: NoRetryReason };

const MAY_RUN_AGAIN: StatementJudgement = { kind: "may-run-again" };

function noRetry(reason: NoRetryReason): StatementJudgement {
  return { kind: "no-retry", reason };
}

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

/** Whether the word at `at` is called: a bare word followed by a parenthesis, not a name. */
function isCall(tokens: readonly StatementToken[], at: number): boolean {
  const word = tokens[at];
  if (typeof word !== "string" || !WORD.test(word) || tokens[at + 1] !== "(") {
    return false;
  }
  const before = tokens[at - 1];
  // A name followed by its column list (`TABLE posts (`, `REFERENCES users (`) is no call.
  return !(typeof before === "string" && NAME_FOLLOWS.has(before));
}

/** What a call of `word` makes of a statement; undefined for a keyword, a type or a built-in. */
function callVerdict(word: string): StatementJudgement | undefined {
  if (PAREN_KEYWORDS.has(word) || PAREN_TYPES.has(word)) return undefined;
  if (BUILT_IN_FUNCTIONS.has(word) || SEQUENCE_FUNCTIONS.has(word)) {
    return undefined;
  }
  if (word === "SETVAL") return noRetry("setval");
  if (OUTSIDE_WRITES.test(word)) return noRetry("outside-write");
  return noRetry("unknown-code");
}

/**
 * What the calls in `tokens` make of the statement: no retry for `setval`, a write outside the
 * database or code the system does not know; undefined where every call is a built-in, a sequence
 * value, a type's size or a keyword's list.
 */
function callsVerdict(
  tokens: readonly StatementToken[]
): StatementJudgement | undefined {
  for (let at = 0; at + 1 < tokens.length; at++) {
    if (!isCall(tokens, at)) continue;
    const verdict = callVerdict(tokens[at] as string);
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
  hasTrigger: (table: string) => boolean
): StatementJudgement {
  const calls = callsVerdict(tokens);
  if (calls !== undefined) return calls;
  const table = tableName(tokens, tableAt);
  if (table === undefined) return noRetry("unread");
  return hasTrigger(table) ? noRetry("trigger") : MAY_RUN_AGAIN;
}

/** A statement that creates, changes or drops a table, column, index, key or check. */
function schemaStatement(
  tokens: readonly StatementToken[]
): StatementJudgement {
  return callsVerdict(tokens) ?? MAY_RUN_AGAIN;
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
      : schemaStatement(tokens);
  }
  return startsWith(tokens, "CREATE", "TABLE")
    ? schemaStatement(tokens)
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
      : schemaStatement(tokens);
  }
  return startsWith(tokens, "DROP", "TABLE")
    ? schemaStatement(tokens)
    : noRetry("unread");
}

/** `SELECT …`: only taking a sequence's value runs again; `setval` and anything else do not. */
function selectStatement(
  tokens: readonly StatementToken[]
): StatementJudgement {
  const calls = callsVerdict(tokens);
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
  ALTER: tokens =>
    startsWith(tokens, "ALTER", "TABLE") || startsWith(tokens, "ALTER", "INDEX")
      ? schemaStatement(tokens)
      : noRetry("unread"),
  RENAME: (tokens, dialect) =>
    dialect === "mysql" && startsWith(tokens, "RENAME", "TABLE")
      ? schemaStatement(tokens)
      : noRetry("unread"),
  INSERT: (tokens, _, hasTrigger) =>
    startsWith(tokens, "INSERT", "INTO")
      ? rowChange(tokens, 2, hasTrigger)
      : noRetry("unread"),
  UPDATE: (tokens, _, hasTrigger) => rowChange(tokens, 1, hasTrigger),
  DELETE: (tokens, _, hasTrigger) =>
    startsWith(tokens, "DELETE", "FROM")
      ? rowChange(tokens, 2, hasTrigger)
      : noRetry("unread"),
  SELECT: tokens => selectStatement(tokens),
  // A setting of the connection: undone with a transaction, or still in force for the next try.
  SET: (tokens, dialect) =>
    dialect === "sqlite"
      ? noRetry("unread")
      : (callsVerdict(tokens) ?? MAY_RUN_AGAIN),
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
