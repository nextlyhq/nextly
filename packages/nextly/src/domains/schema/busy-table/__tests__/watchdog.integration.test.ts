/**
 * A try's watchdog ends a statement once the time it has spent waiting for locks adds up to the
 * try's bound, on PostgreSQL and MySQL: one wait that long, or two shorter ones in turn, while the
 * database's own per-lock timeout is off. Time the statement spends working is not counted.
 *
 * Another connection keeps each table busy: an open transaction that has read it, so an
 * `ALTER TABLE` on it waits for that transaction's lock until the transaction ends.
 *
 * SQLite's busy timeout bounds its one write lock, so its watchdog does nothing; a case says so.
 */
import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOCK_DIALECTS,
  lockWorld,
  sleep,
  type LockWorld,
} from "../../pipeline/__tests__/helpers/schema-lock-world";
import { endedWaiting, ownSessionId } from "../ended-waiting";
import { startTryWatchdog } from "../watchdog";

const PREFIX = `btw_${randomBytes(4).toString("hex")}`;
const FIRST = `${PREFIX}_first`;
const SECOND = `${PREFIX}_second`;
const TABLES = [FIRST, SECOND];

const TRY_MS = 1_000;

const SERVERS = LOCK_DIALECTS.filter(
  (dialect): dialect is Exclude<SupportedDialect, "sqlite"> =>
    dialect !== "sqlite"
);

/** The statement that turns the database's own per-lock timeout off for this session. */
function perLockTimeoutOff(dialect: SupportedDialect) {
  return dialect === "postgresql"
    ? sql.raw("SET LOCAL lock_timeout = 0")
    : // MySQL has no "off": a year is longer than any case here waits.
      sql.raw("SET SESSION lock_wait_timeout = 31536000");
}

/** A transaction that has read `table` and holds it until `free` is called. */
interface TableHolder {
  free(): void;
  readonly ended: Promise<unknown>;
}

async function holdTable(
  adapter: DrizzleAdapter,
  table: string
): Promise<TableHolder> {
  let read: () => void = () => {};
  const hasRead = new Promise<void>(resolve => {
    read = resolve;
  });
  let free: () => void = () => {};
  const freed = new Promise<void>(resolve => {
    free = resolve;
  });
  const ended = adapter
    .transaction(async ctx => {
      await ctx.queryStatement(sql.raw(`SELECT id FROM ${table}`));
      read();
      await freed;
    })
    .catch((error: unknown) => error);
  await hasRead;
  return { free, ended };
}

/**
 * Runs `statements` in turn on one session of its own with the per-lock timeout off, and resolves
 * `session` with that session's id before the first is sent.
 */
function runOnOneSession(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  statements: readonly string[],
  onStatement: (index: number) => void = () => {}
): { session: Promise<string>; outcome: Promise<unknown> } {
  let known: (id: string) => void = () => {};
  const session = new Promise<string>(resolve => {
    known = resolve;
  });
  const outcome = adapter
    .transaction(async ctx => {
      const rows = await ctx.queryStatement<{ session_id: unknown }>(
        ownSessionId(dialect)!
      );
      known(String(rows[0]?.session_id));
      await ctx.runStatement(perLockTimeoutOff(dialect));
      for (const [index, statement] of statements.entries()) {
        onStatement(index);
        await ctx.runStatement(sql.raw(statement));
      }
    })
    .then(
      () => "completed",
      (error: unknown) => error
    );
  return { session, outcome };
}

async function columnsOf(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  table: string
): Promise<string[]> {
  const rows = await adapter.executeQuery<{ name: string }>(
    dialect === "postgresql"
      ? `SELECT column_name AS name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = '${table}'`
      : `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
  );
  return rows.map(row => row.name).sort();
}

describe.each(SERVERS)("a try's watchdog on %s", dialect => {
  let world: LockWorld;
  let adapter: DrizzleAdapter;
  const holders: TableHolder[] = [];

  beforeEach(async () => {
    world = await lockWorld(dialect);
    // Two holders, the watched session, the watchdog's polls and this suite's own reads.
    adapter = await world.connect({ poolMax: 8 });
    await world.reset(adapter, TABLES);
    for (const table of TABLES) {
      await adapter.executeQuery(`CREATE TABLE ${table} (id integer)`);
    }
  });

  afterEach(async () => {
    for (const holder of holders.splice(0)) {
      holder.free();
      await holder.ended;
    }
    await world.reset(adapter, TABLES);
    await adapter.disconnect();
    await world.dispose();
  });

  it("ends a statement that has waited one try for a held table", async () => {
    holders.push(await holdTable(adapter, FIRST));
    const run = runOnOneSession(adapter, dialect, [
      `ALTER TABLE ${FIRST} ADD COLUMN late integer`,
    ]);
    const session = await run.session;
    const started = Date.now();
    const watchdog = startTryWatchdog(adapter, dialect, session, TRY_MS);

    const error = await run.outcome;
    const elapsed = Date.now() - started;
    const { fired } = await watchdog.stop();

    expect(fired).toBe(true);
    expect(error).not.toBe("completed");
    expect(endedWaiting(error, dialect, true)).toBe(true);
    // A whole try was waited, and not much more: the watchdog polls every 100 ms.
    expect(elapsed).toBeGreaterThanOrEqual(TRY_MS);
    expect(elapsed).toBeLessThan(1_500);
    expect(await columnsOf(adapter, dialect, FIRST)).toEqual(["id"]);
  });

  it("adds up the waits for two locks in turn rather than bounding each", async () => {
    const first = await holdTable(adapter, FIRST);
    holders.push(first, await holdTable(adapter, SECOND));
    const FIRST_WAIT_MS = 700;
    let reached = -1;
    const run = runOnOneSession(
      adapter,
      dialect,
      [
        `ALTER TABLE ${FIRST} ADD COLUMN late integer`,
        `ALTER TABLE ${SECOND} ADD COLUMN late integer`,
      ],
      index => {
        reached = index;
        // The first table is let go part-way through one try; the second never is.
        if (index === 0) setTimeout(() => first.free(), FIRST_WAIT_MS);
      }
    );
    const session = await run.session;
    const started = Date.now();
    const watchdog = startTryWatchdog(adapter, dialect, session, TRY_MS);

    const error = await run.outcome;
    const elapsed = Date.now() - started;
    const { fired } = await watchdog.stop();

    expect(fired).toBe(true);
    expect(endedWaiting(error, dialect, true)).toBe(true);
    // The first statement got its table and ran, so the second was the one ended waiting. (On
    // PostgreSQL the rollback then undoes the first as well; MySQL had already committed it.)
    expect(reached).toBe(1);
    expect(await columnsOf(adapter, dialect, SECOND)).toEqual(["id"]);
    // Bounding each wait alone would have let the second wait a whole try after the first's 700 ms.
    expect(elapsed).toBeGreaterThanOrEqual(TRY_MS);
    expect(elapsed).toBeLessThan(FIRST_WAIT_MS + TRY_MS);
  });

  it("bounds the try on a pool of one connection, which the watched session holds", async () => {
    // The holder is on the suite's adapter; the watched session and the watch share an adapter
    // whose pool has one connection, which the session's transaction takes. A watch asking
    // through that pool would wait behind the session until it ended, so it must ask elsewhere.
    const lone = await world.connect({ poolMax: 1 });
    try {
      const holder = await holdTable(adapter, FIRST);
      holders.push(holder);
      // Lets the table go well past a try, so a watch that never asks still ends the case: the
      // statement then completes, unended, rather than waiting until the case times out.
      const letGo = setTimeout(() => holder.free(), 3 * TRY_MS);
      const run = runOnOneSession(lone, dialect, [
        `ALTER TABLE ${FIRST} ADD COLUMN late integer`,
      ]);
      const session = await run.session;
      const started = Date.now();
      const watchdog = startTryWatchdog(lone, dialect, session, TRY_MS);

      const error = await run.outcome;
      const elapsed = Date.now() - started;
      clearTimeout(letGo);
      const { fired } = await watchdog.stop();

      expect(fired).toBe(true);
      expect(endedWaiting(error, dialect, true)).toBe(true);
      // A whole try was waited, and not much more, although the pool had nothing to spare.
      expect(elapsed).toBeGreaterThanOrEqual(TRY_MS);
      expect(elapsed).toBeLessThan(1_500);
      expect(await columnsOf(adapter, dialect, FIRST)).toEqual(["id"]);
    } finally {
      await lone.disconnect();
    }
  });

  it("does not count time the statement spends working", async () => {
    const run = runOnOneSession(adapter, dialect, [
      dialect === "postgresql" ? "SELECT pg_sleep(1.5)" : "SELECT SLEEP(1.5)",
    ]);
    const session = await run.session;
    const watchdog = startTryWatchdog(adapter, dialect, session, TRY_MS);

    expect(await run.outcome).toBe("completed");
    expect(await watchdog.stop()).toEqual({ fired: false });
  });

  it("stops polling once stopped, firing nothing later", async () => {
    holders.push(await holdTable(adapter, FIRST));
    const run = runOnOneSession(adapter, dialect, [
      `ALTER TABLE ${FIRST} ADD COLUMN late integer`,
    ]);
    const session = await run.session;
    const watchdog = startTryWatchdog(adapter, dialect, session, TRY_MS);
    await sleep(300);

    expect(await watchdog.stop()).toEqual({ fired: false });
    // Past the try's bound, the statement still waits: no cancel was sent after the stop.
    await sleep(TRY_MS);
    holders[0].free();
    expect(await run.outcome).toBe("completed");
  });
});

describe("a try's watchdog on sqlite", () => {
  it("does nothing, SQLite's busy timeout bounding its one write lock", async () => {
    const world = await lockWorld("sqlite");
    const adapter = await world.connect();
    try {
      const watchdog = startTryWatchdog(adapter, "sqlite", "unused", 10, {
        pollMs: 1,
      });
      await sleep(50);
      expect(await watchdog.stop()).toEqual({ fired: false });
    } finally {
      await adapter.disconnect();
      await world.dispose();
    }
  });
});
