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

/** A watch made before the try's session is known, given the session once it is. */
export interface PreparedTryWatchdog extends TryWatchdog {
  /** Starts watching `session`; a second call is ignored. */
  watch(session: string): void;
}

/**
 * A watchdog made before the try's transaction opens, so its asks never run inside that
 * transaction's flow: the loop starts here, waits for `watch(session)`, and only then polls.
 * Every poll and cancel goes through the adapter's pool, another connection than the watched one,
 * which is the point of the watch, and resumes in the context the loop started in. On SQLite it
 * does nothing, as `startTryWatchdog` does.
 */
export function prepareTryWatchdog(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  tryMs: number,
  options: {
    pollMs?: number;
    /**
     * Called once the session's waits reach the bound, just before it is ended: while it is still
     * waiting, which is when the database can still say what it waits for.
     */
    beforeCancel?: (session: string) => Promise<void>;
  } = {}
): PreparedTryWatchdog {
  if (dialect === "sqlite") return { ...NO_OP, watch: () => undefined };
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  let given: (session: string | undefined) => void = () => undefined;
  const sessionGiven = new Promise<string | undefined>(resolve => {
    given = resolve;
  });
  let stopped = false;
  let fired = false;
  let waitedMs = 0;
  // When the session was last seen waiting, so the time between two sightings is counted; a
  // sighting after one that found it working starts counting afresh.
  let lastSeenWaitingAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;

  async function poll(target: number): Promise<void> {
    const rows = await adapter.queryStatement<{ state: unknown }>(
      waitingQuery(dialect, target)
    );
    const now = performance.now();
    if (!rows.some(row => isWaiting(dialect, row.state))) {
      lastSeenWaitingAt = undefined;
      return;
    }
    if (lastSeenWaitingAt !== undefined) waitedMs += now - lastSeenWaitingAt;
    lastSeenWaitingAt = now;
    if (waitedMs < tryMs || stopped) return;
    // What holds the table is read before the cancel; a failed read leaves the cancel to go on.
    await options.beforeCancel?.(String(target)).catch(() => undefined);
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

  async function run(): Promise<void> {
    const session = await sessionGiven;
    if (session === undefined || stopped) return;
    const target = sessionNumber(session);
    while (!stopped && !fired) {
      // A failed ask (a dropped connection, a busy pool) says nothing about the session; the next
      // poll asks again.
      await poll(target).catch(() => undefined);
      if (stopped || fired) return;
      await new Promise<void>(resolve => {
        wake = resolve;
        timer = setTimeout(resolve, pollMs);
      });
    }
  }

  const watching = run();
  return {
    watch(session) {
      // Checked here, where the caller can still hear of it, rather than in the loop.
      sessionNumber(session);
      given(session);
    },
    async stop() {
      stopped = true;
      given(undefined);
      if (timer !== undefined) clearTimeout(timer);
      wake?.();
      // A poll already sent is awaited, so no cancel lands after the try has been let go.
      await watching;
      return { fired };
    },
  };
}

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
  const watchdog = prepareTryWatchdog(adapter, dialect, tryMs, options);
  watchdog.watch(session);
  return watchdog;
}
