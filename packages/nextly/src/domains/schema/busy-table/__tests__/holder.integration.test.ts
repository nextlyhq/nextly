/**
 * What holds a busy table, as the database names it on PostgreSQL and MySQL: the session whose
 * open transaction has read the table, by its real id, with its user, address and the age of its
 * transaction, and never the text of anything it ran. A reader that may not see other sessions
 * gets what it can read and a line saying what it could not and why. SQLite names no holder.
 */
import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOCK_DIALECTS,
  lockWorld,
  sleep,
  type LockWorld,
} from "../../pipeline/__tests__/helpers/schema-lock-world";
import { ownSessionId } from "../ended-waiting";
import { readHolders } from "../holder";
import type { HolderReport } from "../types";

const PREFIX = `bth_${randomBytes(4).toString("hex")}`;
const BUSY = `${PREFIX}_busy`;
/** A user that may not see other users' sessions. */
const READER = `${PREFIX}_reader`;
/** A literal only the holder's statement carries, which no report may repeat. */
const HOLDER_LITERAL = `holder_secret_${randomBytes(6).toString("hex")}`;

const SERVERS = LOCK_DIALECTS.filter(
  (dialect): dialect is Exclude<SupportedDialect, "sqlite"> =>
    dialect !== "sqlite"
);

async function sessionOf(
  run: { queryStatement: DrizzleAdapter["queryStatement"] },
  dialect: SupportedDialect
): Promise<string> {
  const rows = await run.queryStatement<{ session_id: unknown }>(
    ownSessionId(dialect)!
  );
  return String(rows[0]?.session_id);
}

describe.each(SERVERS)("the holder of a busy table on %s", dialect => {
  let world: LockWorld;
  let adapter: DrizzleAdapter;
  let holderSession: string;
  let freeTheTable: () => void = () => {};
  let holding: Promise<unknown> = Promise.resolve();

  beforeEach(async () => {
    world = await lockWorld(dialect);
    adapter = await world.connect({ poolMax: 6 });
    await world.reset(adapter, [BUSY]);
    await adapter.executeQuery(`CREATE TABLE ${BUSY} (id integer)`);
    // An open transaction that has read the table, with a statement carrying the literal: an
    // ALTER of the table waits for it to end.
    let read: () => void = () => {};
    const hasRead = new Promise<void>(resolve => {
      read = resolve;
    });
    const freed = new Promise<void>(resolve => {
      freeTheTable = resolve;
    });
    holding = adapter
      .transaction(async ctx => {
        holderSession = await sessionOf(ctx, dialect);
        await ctx.queryStatement(
          sql.raw(`SELECT id, '${HOLDER_LITERAL}' AS marker FROM ${BUSY}`)
        );
        read();
        await freed;
      })
      .catch((error: unknown) => error);
    await hasRead;
  });

  afterEach(async () => {
    freeTheTable();
    await holding;
    await world.reset(adapter, [BUSY]);
    await adapter.disconnect();
    await world.dispose();
  });

  /** An ALTER of the busy table on a session of its own, waiting with no per-lock timeout. */
  async function waitingAlter(): Promise<{
    session: string;
    outcome: Promise<unknown>;
  }> {
    let known: (id: string) => void = () => {};
    const session = new Promise<string>(resolve => {
      known = resolve;
    });
    const outcome = adapter
      .transaction(async ctx => {
        known(await sessionOf(ctx, dialect));
        await ctx.runStatement(
          sql.raw(
            dialect === "postgresql"
              ? "SET LOCAL lock_timeout = 0"
              : "SET SESSION lock_wait_timeout = 31536000"
          )
        );
        await ctx.runStatement(
          sql.raw(`ALTER TABLE ${BUSY} ADD COLUMN late integer`)
        );
      })
      .then(
        () => "completed",
        (error: unknown) => error
      );
    return { session: await session, outcome };
  }

  /** The report for `session` once it names a session, or the last one read after five seconds. */
  async function reportOnceNamed(
    reader: DrizzleAdapter,
    session: string
  ): Promise<HolderReport> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const report = await readHolders(reader, dialect, session);
      const named = report.kind === "named" && report.sessions.length > 0;
      if (named || Date.now() > deadline) return report;
      await sleep(50);
    }
  }

  it("names the session holding the table, never its statement's text", async () => {
    const waiting = await waitingAlter();

    const report = await reportOnceNamed(adapter, waiting.session);

    expect(report).toMatchObject({ kind: "named", unreadable: [] });
    if (report.kind !== "named") throw new Error("unreachable");
    expect(report.sessions.map(session => session.id)).toEqual([holderSession]);
    const [holder] = report.sessions;
    expect(holder.user).toBe(dialect === "postgresql" ? "postgres" : "root");
    expect(typeof holder.clientAddress).toBe("string");
    // The address alone, without the client's port.
    expect(holder.clientAddress).not.toMatch(/^[^:]+:\d+$/);
    expect(holder.transactionOpenSeconds).toEqual(expect.any(Number));
    expect(holder.transactionOpenSeconds).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(report)).not.toContain(HOLDER_LITERAL);

    freeTheTable();
    expect(await waiting.outcome).toBe("completed");
  });

  it("names no one for a session that waits for nothing", async () => {
    const idle = await sessionOf(adapter, dialect);

    expect(await readHolders(adapter, dialect, idle)).toEqual({
      kind: "named",
      sessions: [],
      unreadable: [],
    });
  });

  it("says so when it does not know which session waited", async () => {
    const report = await readHolders(adapter, dialect, undefined);

    expect(report).toMatchObject({ kind: "named", sessions: [] });
    if (report.kind !== "named") throw new Error("unreachable");
    expect(report.unreadable).toHaveLength(1);
    expect(report.unreadable[0]).toMatch(/waiting session/);
  });

  it("names what a reader without the right to see other sessions could not read", async () => {
    const url = new URL(world.url);
    const remove = async () => {
      if (dialect === "postgresql") {
        await adapter.executeQuery(`DROP OWNED BY ${READER}`);
        await adapter.executeQuery(`DROP ROLE ${READER}`);
      } else {
        await adapter.executeQuery(`DROP USER '${READER}'@'%'`);
      }
    };
    try {
      if (dialect === "postgresql") {
        await adapter.executeQuery(
          `CREATE ROLE ${READER} LOGIN PASSWORD 'reader'`
        );
      } else {
        const database = url.pathname.replace(/^\//, "");
        await adapter.executeQuery(
          `CREATE USER '${READER}'@'%' IDENTIFIED BY 'reader'`
        );
        await adapter.executeQuery(
          `GRANT ALL ON \`${database}\`.* TO '${READER}'@'%'`
        );
      }
    } catch (error) {
      await remove().catch(() => {});
      throw error;
    }
    url.username = READER;
    url.password = "reader";
    const reader = (dialect === "postgresql"
      ? createPostgresAdapter({ url: url.toString() })
      : createMySqlAdapter({
          url: url.toString(),
        })) as unknown as DrizzleAdapter;
    try {
      await reader.connect();
      const waiting = await waitingAlter();

      const report =
        dialect === "postgresql"
          ? await reportOnceNamed(reader, waiting.session)
          : await readHolders(reader, dialect, waiting.session);

      expect(report.kind).toBe("named");
      if (report.kind !== "named") throw new Error("unreachable");
      if (dialect === "postgresql") {
        // PostgreSQL shows another user's session's id and user, but not its address or the
        // age of its transaction.
        expect(report.sessions).toEqual([
          {
            id: holderSession,
            user: "postgres",
            clientAddress: null,
            applicationName: null,
            transactionOpenSeconds: null,
          },
        ]);
        expect(report.unreadable).toHaveLength(1);
        expect(report.unreadable[0]).toContain(holderSession);
        expect(report.unreadable[0]).toContain("pg_read_all_stats");
      } else {
        // MySQL refuses performance_schema to a user without SELECT on it.
        expect(report.sessions).toEqual([]);
        expect(report.unreadable).toHaveLength(1);
        expect(report.unreadable[0]).toMatch(/performance_schema/);
        expect(report.unreadable[0]).toMatch(/privilege|may not/);
      }
      expect(JSON.stringify(report)).not.toContain(HOLDER_LITERAL);

      freeTheTable();
      expect(await waiting.outcome).toBe("completed");
    } finally {
      await reader.disconnect().catch(() => {});
      await remove();
    }
  });
});

describe("the holder of a busy table on sqlite", () => {
  it("is unnamed, SQLite saying only that another connection holds its write lock", async () => {
    const world = await lockWorld("sqlite");
    const adapter = await world.connect();
    try {
      expect(await readHolders(adapter, "sqlite", undefined)).toEqual({
        kind: "unnamed",
        reason:
          "SQLite does not say which connection holds the database: another connection holds its write lock.",
      });
    } finally {
      await adapter.disconnect();
      await world.dispose();
    }
  });
});
