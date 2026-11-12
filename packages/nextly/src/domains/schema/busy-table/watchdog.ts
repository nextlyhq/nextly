/**
 * The watch that bounds one try as a whole.
 *
 * PostgreSQL's `lock_timeout` and MySQL's `lock_wait_timeout` bound each lock a statement waits
 * for on its own, so a statement that waits for several in turn can wait several times the bound.
 * This watch asks the database, every poll, whether the try's session is waiting for a lock now,
 * adds up the time it is seen waiting, and once that sum reaches the try's bound ends the
 * statement: PostgreSQL's `pg_cancel_backend`, MySQL's `KILL QUERY`. Time the statement spends
 * working is not counted.
 *
 * It asks on the adapter's pool, never on the watched session, which is busy running the
 * statement. It reads only whether the session waits, never what the session runs: a statement's
 * text can hold a literal value that must not leave the database.
 *
 * @module domains/schema/busy-table/watchdog
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql, type SQL } from "drizzle-orm";

import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";

import { sessionNumberOf } from "./ended-waiting";
import type { TryWatchdog } from "./types";

/** How often the session is asked about, by default, in milliseconds. */
const DEFAULT_POLL_MS = 100;

const id = (name: string) => sql.identifier(name);

/**
 * MySQL's process-list states for a statement waiting for a lock: "Waiting for table metadata
 * lock", "Waiting for table level lock", and the other "Waiting for … lock" states (schema,
 * global read, commit and so on), each a lock another session holds.
 */
const MYSQL_LOCK_WAIT_STATE = /^Waiting for .*\block$/i;

/** Whether the session waits for a lock now: one row with `waiting` 1 or true, else none. */
function waitingQuery(dialect: SupportedDialect, session: number): SQL {
  if (dialect === "postgresql") {
    return sql`SELECT ${id("wait_event_type")} AS ${id("state")}
        FROM ${id("pg_stat_activity")} WHERE ${id("pid")} = ${session}`;
  }
  return sql`SELECT ${id("STATE")} AS ${id("state")}
      FROM ${id("information_schema")}.${id("PROCESSLIST")} WHERE ${id("ID")} = ${session}`;
}

/** Whether a row of `waitingQuery` says the session is waiting for a lock. */
function isWaiting(dialect: SupportedDialect, state: unknown): boolean {
  if (typeof state !== "string") return false;
  return dialect === "postgresql"
    ? state === "Lock"
    : MYSQL_LOCK_WAIT_STATE.test(state);
}

/**
 * The statement that ends what the session runs, leaving the session open. PostgreSQL's cancel is
 * asked only while the session still waits for a lock, in the same statement, so a statement that
 * got its lock and went on to work in between is left to finish. MySQL's `KILL QUERY` cannot be
 * made conditional; it takes a literal id, not a parameter, so the id is a checked integer.
 */
function cancelQuery(dialect: SupportedDialect, session: number): SQL {
  if (dialect === "postgresql") {
    return sql`SELECT pg_cancel_backend(${id("pid")}) AS ${id("cancelled")}
        FROM ${id("pg_stat_activity")}
        WHERE ${id("pid")} = ${session} AND ${id("wait_event_type")} = 'Lock'`;
  }
  return sql`KILL QUERY ${sql.raw(String(session))}`;
}

/** A session id as the database gives it: a positive integer, refused otherwise. */
function sessionNumber(session: string): number {
  const number = sessionNumberOf(session);
  if (number !== undefined) return number;
  throw NextlyError.invalidInput({
    message: `A try's watchdog was given ${JSON.stringify(session)} as the session to watch, which is not a database session id.`,
    logContext: { reason: "busy-table-watchdog-session-invalid" },
  });
}

const NO_OP: TryWatchdog = {
  stop: () => Promise.resolve({ fired: false }),
};

/**
 * Watches `session` on `adapter`'s pool every `pollMs` (100 by default) and ends its statement
 * once the time seen waiting for locks adds up to `tryMs`, once. A poll that fails is let go; the
 * next asks again. On SQLite it does nothing: SQLite's busy timeout bounds its one write lock.
 */
export function startTryWatchdog(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  session: string,
  tryMs: number,
  options: { pollMs?: number } = {}
): TryWatchdog {
  if (dialect === "sqlite") return NO_OP;
  const target = sessionNumber(session);
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const asking = waitingQuery(dialect, target);

  let stopped = false;
  let fired = false;
  let waitedMs = 0;
  // When the session was last seen waiting, so the time between two sightings is counted; a
  // sighting after one that found it working starts counting afresh.
  let lastSeenWaitingAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;

  async function poll(): Promise<void> {
    const rows = await adapter.queryStatement<{ state: unknown }>(asking);
    const now = performance.now();
    if (!rows.some(row => isWaiting(dialect, row.state))) {
      lastSeenWaitingAt = undefined;
      return;
    }
    if (lastSeenWaitingAt !== undefined) waitedMs += now - lastSeenWaitingAt;
    lastSeenWaitingAt = now;
    if (waitedMs < tryMs || stopped) return;
    if (dialect === "postgresql") {
      const cancelled = await adapter.queryStatement<{ cancelled: unknown }>(
        cancelQuery(dialect, target)
      );
      // No row: the session stopped waiting between the two asks, so it goes on, unended.
      fired = cancelled.some(row => row.cancelled === true);
    } else {
      await adapter.queryStatement(cancelQuery(dialect, target));
      fired = true;
    }
  }

  async function watch(): Promise<void> {
    while (!stopped && !fired) {
      // A failed ask (a dropped connection, a busy pool) says nothing about the session; the next
      // poll asks again.
      await poll().catch(() => undefined);
      if (stopped || fired) return;
      await new Promise<void>(resolve => {
        wake = resolve;
        timer = setTimeout(resolve, pollMs);
      });
    }
  }

  const watching = watch();
  return {
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      wake?.();
      // A poll already sent is awaited, so no cancel lands after the try has been let go.
      await watching;
      return { fired };
    },
  };
}
