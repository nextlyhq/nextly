/**
 * Which statements commit MySQL's open transaction implicitly.
 *
 * MySQL commits the open transaction before and after a CREATE, ALTER, DROP or RENAME of a table
 * or an index (the column, key and check changes are an ALTER TABLE's). A temporary table's CREATE
 * and DROP do not commit. After such a commit the session is back in autocommit, so a unit that
 * runs in one transaction opens it again (`runMigrationStatements`), and the statements after the
 * commit roll back together, as the ones before it would have.
 *
 * A statement that commits but is not read as one here (a view's CREATE, a TRUNCATE) is one no
 * later try may send again (`judgeStatement` reads it as unread), so a run stops rather than send
 * it twice.
 *
 * @module domains/schema/migrate/mysql-implicit-commit
 */
import {
  MYSQL_LIVE_RUN_LENGTH,
  mysqlLiveRunAt,
} from "../pipeline/sql-templates/mysql-live-restate";

import { leadingWords, statementTokens } from "./split-sql";

/** The objects whose creation, change, drop or rename commits MySQL's transaction, by verb. */
const MYSQL_COMMITTING: Readonly<Record<string, ReadonlySet<string>>> = {
  CREATE: new Set(["TABLE", "INDEX"]),
  ALTER: new Set(["TABLE", "INDEX"]),
  DROP: new Set(["TABLE", "INDEX"]),
  RENAME: new Set(["TABLE"]),
};

/** The kinds of index MySQL writes before `INDEX`. */
const INDEX_KINDS = new Set(["UNIQUE", "FULLTEXT", "SPATIAL"]);

/** Whether MySQL commits the open transaction implicitly before and after `statement`. */
export function commitsOnMysql(statement: string): boolean {
  const [first, second, third] = leadingWords(statement, "mysql", 3);
  const objects = MYSQL_COMMITTING[first ?? ""];
  if (objects === undefined) return false;
  // `CREATE UNIQUE|FULLTEXT|SPATIAL INDEX`: the object is the third word.
  const object =
    first === "CREATE" && INDEX_KINDS.has(second ?? "") ? third : second;
  return objects.has(object ?? "");
}

/**
 * The first words of the statements that change no row a run could be judged by: a read, the
 * session's own housekeeping, and a schema statement, whose shape is judged from the tables. A
 * `SELECT` that calls a stored function changing rows is the exception nothing here reads.
 */
const LEAVES_ROWS_ALONE = new Set([
  "SELECT",
  "SHOW",
  "EXPLAIN",
  "DESCRIBE",
  "DESC",
  "PREPARE",
  "DEALLOCATE",
  "CREATE",
  "ALTER",
  "DROP",
  "RENAME",
  "LOCK",
  "UNLOCK",
  "GRANT",
  "REVOKE",
  "ANALYZE",
  "BEGIN",
  "START",
  "COMMIT",
  "SAVEPOINT",
  "RELEASE",
  "USE",
]);

/** The first words of the statements that never commit MySQL's transaction. */
const NEVER_COMMITS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "REPLACE",
  "SELECT",
  "WITH",
  "DO",
  "PREPARE",
  "DEALLOCATE",
  "SHOW",
  "EXPLAIN",
  "DESCRIBE",
  "DESC",
  "SAVEPOINT",
  "RELEASE",
  "USE",
]);

/** The words that make a `SET` more than a plain session or user variable. */
const NOT_A_PLAIN_SET = new Set([
  "AUTOCOMMIT",
  "PASSWORD",
  "ROLE",
  "TRANSACTION",
  "GLOBAL",
  "PERSIST",
  "PERSIST_ONLY",
  "NAMES",
  "CHARACTER",
  "CHARSET",
  "DEFAULT",
  "RESOURCE",
]);

/**
 * Whether `statement` sets only plain session or user variables, whatever their values are read
 * from, a subquery included. `SET autocommit` commits, so it is none, under any of its spellings.
 */
function setsPlainVariables(statement: string): boolean {
  const tokens = statementTokens(statement, "mysql");
  return (
    tokens[0] === "SET" &&
    tokens.every(token => {
      // Every part of a qualified name is read (`@@GLOBAL.x`), as a quoted one's is.
      const word = typeof token === "string" ? token : (token.name ?? "");
      return !word
        .replace(/^@+/, "")
        .split(".")
        .some(part => NOT_A_PLAIN_SET.has(part));
    })
  );
}

/**
 * The indexes in `statements` where one of Nextly's own restatements (`mysqlLiveRunAt`) runs: an
 * `EXECUTE` of a schema statement the module wrote, which commits and changes no row.
 */
function restatementsRunIn(statements: readonly string[]): ReadonlySet<number> {
  const executes = new Set<number>();
  for (let at = 0; at < statements.length; at++) {
    if (mysqlLiveRunAt(statements, at) === undefined) continue;
    executes.add(at + MYSQL_LIVE_RUN_LENGTH - 2);
    at += MYSQL_LIVE_RUN_LENGTH - 1;
  }
  return executes;
}

/** Whether `statement` may change rows on MySQL: every one not known to leave them alone. */
function mayChangeRowsOnMysql(statement: string): boolean {
  const first = leadingWords(statement, "mysql", 1)[0] ?? "";
  return first === "SET"
    ? !setsPlainVariables(statement)
    : !LEAVES_ROWS_ALONE.has(first);
}

/**
 * Whether `statement` may commit MySQL's open transaction: every one not known not to. It errs toward
 * rows reported durable, never toward rows reported undone.
 */
function mayCommitOnMysql(statement: string): boolean {
  if (commitsOnMysql(statement)) return true;
  const [first, second] = leadingWords(statement, "mysql", 2);
  if (first === "SET") return !setsPlainVariables(statement);
  // A temporary table's CREATE and DROP do not commit.
  if ((first === "CREATE" || first === "DROP") && second === "TEMPORARY") {
    return false;
  }
  return !NEVER_COMMITS.has(first ?? "");
}

/**
 * Whether `statement` runs a statement whose text is not read here, so an error it answers may come
 * from one that already committed: a prepared statement, and a procedure.
 */
export function runsAnotherStatementOnMysql(statement: string): boolean {
  const first = leadingWords(statement, "mysql", 1)[0];
  return first === "EXECUTE" || first === "CALL";
}

/**
 * How many of a unit's statements MySQL made durable by committing implicitly, where rows changed
 * among them: told each statement as it starts and once it ran, it answers `kept`.
 */
export interface DurableRows {
  starting(statement: string, index: number): void;
  ran(statement: string, index: number): void;
  /** MySQL could not read the statement just started, so it committed nothing (`starting` undone). */
  unread(): void;
  /**
   * The statements, from the first, that stay applied whatever happens after: undefined where no
   * statement that changes rows is among them, or not on MySQL.
   */
  kept(): number | undefined;
}

/**
 * The statements of a unit run in one transaction that MySQL made durable with rows among them. A
 * statement that commits (`mayCommitOnMysql`) commits the open transaction before it runs, so a row
 * statement before it stays applied from the moment it starts, and the committing statement itself
 * once it ran. A try resumed at `from` starts past statements an earlier try kept, committed
 * already. Only rows decide it: a unit whose committed statements change no row is judged from its
 * tables, as before, and other dialects keep nothing here.
 */
export function durableRowsOf(
  dialect: string,
  statements: readonly string[],
  from: number
): DurableRows {
  if (dialect !== "mysql") {
    return {
      starting: () => undefined,
      ran: () => undefined,
      unread: () => undefined,
      kept: () => undefined,
    };
  }
  const restatements = restatementsRunIn(statements);
  const changesRowsAt = (statement: string, index: number) =>
    !restatements.has(index) && mayChangeRowsOnMysql(statement);
  let kept = statements.slice(0, from).some(changesRowsAt) ? from : undefined;
  // A statement that may have changed rows since the last commit, which the next one makes durable.
  let rowsOpen = false;
  // What both were before the statement just started.
  let before = { kept, rowsOpen };
  return {
    starting(statement, index) {
      before = { kept, rowsOpen };
      if (!mayCommitOnMysql(statement)) return;
      if (rowsOpen || kept !== undefined) kept = index;
      rowsOpen = false;
    },
    ran(statement, index) {
      const changesRows = changesRowsAt(statement, index);
      if (mayCommitOnMysql(statement)) {
        // One that changes rows and may commit has made its own durable, whatever came before it.
        if (kept !== undefined || changesRows) kept = index + 1;
      } else if (changesRows) {
        rowsOpen = true;
      }
    },
    unread() {
      ({ kept, rowsOpen } = before);
    },
    kept: () => kept,
  };
}
