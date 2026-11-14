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
 * It asks on another connection than the watched session, which is busy running the statement:
 * the adapter's pool where it can spare one, else a connection of the watch's own
 * (`openWatchConnection`), since on a pool of one every ask would wait behind the watched session.
 * It reads only whether the session waits, never what the session runs: a statement's text can
 * hold a literal value that must not leave the database.
 *
 * @module domains/schema/busy-table/watchdog
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql, type SQL } from "drizzle-orm";

import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";

import { sessionNumberOf } from "./ended-waiting";
import type { TryWatchdog } from "./types";
import {
  openWatchConnection,
  poolCanSpareOne,
  type WatchConnection,
} from "./watch-connection";

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

/** InnoDB's own state of the session's transaction: `LOCK WAIT` while it waits for a row. */
function innodbLockWaitQuery(session: number): SQL {
  return sql`SELECT ${id("trx_state")} AS ${id("state")}
      FROM ${id("information_schema")}.${id("INNODB_TRX")}
      WHERE ${id("trx_mysql_thread_id")} = ${session}`;
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
  /**
   * Resolves once no cancel is under way. The runner awaits it before each statement, so a
   * cancel decided while one statement waited can never land on the next (MySQL's `KILL QUERY`
   * ends whatever its session runs when it arrives).
   */
  idle(): Promise<void>;
  /**
   * Tells the watch which statement the session runs now. A cancel goes ahead only while the
   * statement it saw waiting is still the one running, so it can never end a later one.
   */
  moveTo(statement: number): void;
}

/**
 * A watchdog made before the try's transaction opens, so its asks never run inside that
 * transaction's flow: the loop starts here, waits for `watch(session)`, and only then polls.
 * Every poll and cancel goes through another connection than the watched one, which is the point
 * of the watch: the adapter's pool, or on a pool of one a connection the watch opens once it is
 * given the session and closes when it stops. Each resumes in the context the loop started in.
 * On SQLite it does nothing, as `startTryWatchdog` does.
 */
export function prepareTryWatchdog(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  tryMs: number,
  options: {
    pollMs?: number;
    /**
     * Called once the session's waits reach the bound, just before it is ended: while it is still
     * waiting, which is when the database can still say what it waits for. Not called where the
     * adapter's pool cannot spare a connection: its reads go through that pool, so they would wait
     * behind the watched session, holding the cancel back until the try had ended by itself.
     */
    beforeCancel?: (session: string) => Promise<void>;
  } = {}
): PreparedTryWatchdog {
  if (dialect === "sqlite") {
    return {
      ...NO_OP,
      watch: () => undefined,
      idle: () => Promise.resolve(),
      moveTo: () => undefined,
    };
  }
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
  // The poll under way, which may go on to cancel, awaited by `idle`: set before its first ask,
  // so a poll that has seen the session waiting cannot decide to cancel after `idle` resolved.
  let cancelling: Promise<void> = Promise.resolve();
  // The statement the session runs now, as the runner says (`moveTo`).
  let current = -1;
  // Where the asks go, opened by the loop once the session is given (`openWatchConnection`), and
  // closed by `stop`. Until it opens, nothing is asked.
  let asking: Promise<WatchConnection> | undefined;
  let closing: Promise<void> | undefined;
  // Whether the holder read, which goes through the adapter's pool, can be answered while the
  // watched session holds a connection of that pool.
  const holderReadable = poolCanSpareOne(adapter, dialect);

  /**
   * Whether the session is waiting for a lock now. On MySQL a wait the process list does not word
   * as one (an InnoDB row wait, shown as `updating`) is read from InnoDB's own transactions too;
   * that read needs the PROCESS privilege, and where it is refused the process list's answer
   * stands, the try's backstops still bounding the wait.
   */
  async function waitingNow(
    connection: WatchConnection,
    target: number
  ): Promise<boolean> {
    const rows = await connection.query<{ state: unknown }>(
      waitingQuery(dialect, target)
    );
    if (rows.some(row => isWaiting(dialect, row.state))) return true;
    if (dialect !== "mysql") return false;
    const trx = await connection
      .query<{ state: unknown }>(innodbLockWaitQuery(target))
      .catch(() => []);
    return trx.some(row => row.state === "LOCK WAIT");
  }

  /**
   * Reads the holder, then ends the waiting statement, unless it stopped waiting meanwhile, the
   * runner moved on to another statement (`seen`), or the watch was stopped.
   */
  async function cancel(
    connection: WatchConnection,
    target: number,
    seen: number
  ): Promise<void> {
    const stillThere = () => !stopped && current === seen;
    // What holds the table is read before the cancel, where the pool it is read through can
    // answer now; a failed read leaves the cancel to go on.
    if (holderReadable) {
      await options.beforeCancel?.(String(target)).catch(() => undefined);
    }
    if (!stillThere()) return;
    if (dialect === "postgresql") {
      const cancelled = await connection.query<{ cancelled: unknown }>(
        cancelQuery(dialect, target)
      );
      // No row: the session stopped waiting between the two asks, so it goes on, unended.
      fired = cancelled.some(row => row.cancelled === true);
      return;
    }
    // MySQL's kill cannot be made conditional: asked again just before it, so a statement that
    // got its lock while the holder was read goes on; the runner holds its next statement until
    // this has ended (`idle`), so the kill can only reach the statement that waited.
    if (!(await waitingNow(connection, target)) || !stillThere()) return;
    await connection.query(cancelQuery(dialect, target));
    fired = true;
  }

  async function poll(
    connection: WatchConnection,
    target: number
  ): Promise<void> {
    const seen = current;
    const waiting = await waitingNow(connection, target);
    const now = performance.now();
    if (!waiting) {
      lastSeenWaitingAt = undefined;
      return;
    }
    if (lastSeenWaitingAt !== undefined) waitedMs += now - lastSeenWaitingAt;
    lastSeenWaitingAt = now;
    // Decided and begun with no await in between, so the runner, which awaits `idle` before it
    // moves on, either sees this cancel under way or has already moved, which the cancel checks.
    if (waitedMs < tryMs || stopped || current !== seen) return;
    cancelling = cancel(connection, target, seen).catch(() => undefined);
    await cancelling;
  }

  async function run(): Promise<void> {
    const session = await sessionGiven;
    if (session === undefined || stopped) return;
    const target = sessionNumber(session);
    // Opened here, in the loop's own context, outside the try's transaction; set with no await
    // between the check above and here, so a `stop` from now on finds it to close. It never
    // rejects: a connection that cannot be opened leaves the asks on the pool.
    asking = openWatchConnection(adapter, dialect);
    const connection = await asking;
    while (!stopped && !fired) {
      // A failed ask (a dropped connection, a busy pool) says nothing about the session; the next
      // poll asks again.
      await poll(connection, target).catch(() => undefined);
      if (stopped || fired) return;
      await new Promise<void>(resolve => {
        wake = resolve;
        timer = setTimeout(resolve, pollMs);
      });
    }
  }

  // The loop runs on its own; a failed ask inside it is caught where it is made.
  void run().catch(() => undefined);
  return {
    watch(session) {
      // Checked here, where the caller can still hear of it, rather than in the loop.
      sessionNumber(session);
      given(session);
    },
    idle: () => cancelling,
    moveTo(statement) {
      current = statement;
    },
    async stop() {
      stopped = true;
      given(undefined);
      if (timer !== undefined) clearTimeout(timer);
      wake?.();
      // A cancel under way is awaited, so none lands after the try has been let go. A poll still
      // asking is not: on the pool it can wait for a connection, and once stopped it cancels
      // nothing.
      await cancelling;
      // The watch's own connection, if it opened one, is closed once; a poll still asking on it
      // fails, which the loop lets go. Closing never throws.
      closing ??= asking?.then(connection => connection.close());
      await closing;
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
