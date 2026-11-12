/**
 * Whether an error a try's statement ended with says its wait for a lock ended, and how a try's
 * session reads its own id for the watchdog and the holder report.
 *
 * The database's own per-lock timeout always means the wait ended. A cancelled or interrupted
 * statement means it only when the try's watchdog sent the cancel: one the watchdog did not send
 * came from someone else (an operator, a statement timeout) and is that statement's own failure,
 * not a busy table.
 *
 * @module domains/schema/busy-table/ended-waiting
 */
import { sql, type SQL } from "drizzle-orm";

import type { SupportedDialect } from "../../../database/schema-registry";

/** How deep the `cause` chain is read: past an ORM's and an adapter's wrappers, never forever. */
const MAX_DEPTH = 6;

/** PostgreSQL's lock_not_available: `lock_timeout` ran out, or a `NOWAIT` found the lock taken. */
const PG_LOCK_NOT_AVAILABLE = "55P03";
/** PostgreSQL's query_canceled: what `pg_cancel_backend` ends a statement with. */
const PG_QUERY_CANCELED = "57014";
/** MySQL's ER_LOCK_WAIT_TIMEOUT: `lock_wait_timeout` or `innodb_lock_wait_timeout` ran out. */
const MYSQL_LOCK_WAIT_TIMEOUT = { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 };
/** MySQL's ER_QUERY_INTERRUPTED: what `KILL QUERY` ends a statement with. */
const MYSQL_QUERY_INTERRUPTED = { code: "ER_QUERY_INTERRUPTED", errno: 1317 };

/** Whether one link of the chain carries `driver`'s MySQL code, by name or by number. */
function isMysql(
  code: unknown,
  errno: unknown,
  driver: { code: string; errno: number }
): boolean {
  return code === driver.code || errno === driver.errno;
}

/** Whether one link of the chain says the wait ended, on `dialect`. */
function linkEndedWaiting(
  link: { code?: unknown; errno?: unknown },
  dialect: SupportedDialect,
  watchdogFired: boolean
): boolean {
  const { code, errno } = link;
  if (dialect === "postgresql") {
    return (
      code === PG_LOCK_NOT_AVAILABLE ||
      (watchdogFired && code === PG_QUERY_CANCELED)
    );
  }
  if (dialect === "mysql") {
    return (
      isMysql(code, errno, MYSQL_LOCK_WAIT_TIMEOUT) ||
      (watchdogFired && isMysql(code, errno, MYSQL_QUERY_INTERRUPTED))
    );
  }
  // SQLite's busy timeout bounds the wait for its one write lock; the extended codes
  // (SQLITE_BUSY_SNAPSHOT, SQLITE_BUSY_RECOVERY, SQLITE_BUSY_TIMEOUT) are the same wait.
  return (
    typeof code === "string" && code.toUpperCase().startsWith("SQLITE_BUSY")
  );
}

/**
 * True when `error` says the statement's wait for a lock ended: on PostgreSQL lock_not_available,
 * or query_canceled where the try's watchdog fired; on MySQL ER_LOCK_WAIT_TIMEOUT, or
 * ER_QUERY_INTERRUPTED where the watchdog fired; on SQLite SQLITE_BUSY and its extended codes.
 * The code is looked for down the `cause` chain, at most six links deep.
 */
export function endedWaiting(
  error: unknown,
  dialect: SupportedDialect,
  watchdogFired: boolean
): boolean {
  let link: unknown = error;
  for (
    let depth = 0;
    depth < MAX_DEPTH && typeof link === "object" && link !== null;
    depth++
  ) {
    const fields = link as { code?: unknown; errno?: unknown; cause?: unknown };
    if (linkEndedWaiting(fields, dialect, watchdogFired)) return true;
    link = fields.cause;
  }
  return false;
}

/**
 * The statement that reads the session id of the connection it runs on, as the column
 * `session_id`: PostgreSQL's backend pid, MySQL's connection id. Undefined on SQLite, whose
 * connections have no id another connection can name.
 */
export function ownSessionId(dialect: SupportedDialect): SQL | undefined {
  if (dialect === "postgresql") {
    return sql`SELECT pg_backend_pid() AS ${sql.identifier("session_id")}`;
  }
  if (dialect === "mysql") {
    return sql`SELECT CONNECTION_ID() AS ${sql.identifier("session_id")}`;
  }
  return undefined;
}

/**
 * A session id as `ownSessionId` reads it, as the integer the database's own statements take
 * (`pg_cancel_backend`, `KILL QUERY`, `pg_blocking_pids`); undefined for anything that is not a
 * positive whole number, so no other text reaches those statements.
 */
export function sessionNumberOf(session: string): number | undefined {
  const number = /^[0-9]+$/.test(session) ? Number(session) : Number.NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}
