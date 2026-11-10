/**
 * A run that takes over a lapsed schema lock makes its first change only once every statement of
 * the earlier holder has ended, on PostgreSQL and MySQL.
 *
 * The earlier holder is a second process whose statement waits on a table this suite keeps busy.
 * It is paused past its lease, or killed, while the statement waits; a second run then takes the
 * lock, makes its first change and lets the table go. The earlier holder's statement, which the
 * database would otherwise run as soon as the table was free, never lands.
 *
 * SQLite runs one writer at a time: a statement of the holder that is still running keeps every
 * other run from claiming the row at all, so there is no takeover to fence there.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installRegistryResolver } from "../../../../cli/utils/registry-resolver";
import { withSchemaLock } from "../schema-lock";

import {
  LOCK_DIALECTS,
  lockWorld,
  sleep,
  startScript,
  tablesWithPrefix,
  type Holder,
  type LockWorld,
} from "./helpers/schema-lock-world";

const PREFIX = `slt_${randomBytes(4).toString("hex")}`;
/** A role that may see every session's statement but stop none of a superuser's. */
const WATCHER = `${PREFIX}_watcher`;
const BUSY = `${PREFIX}_busy`;
const TAKER = `${PREFIX}_taker`;
const TABLES = [BUSY, TAKER];

const STATEMENT_HOLDER = join(
  __dirname,
  "helpers",
  "schema-lock-statement-holder.ts"
);

const quiet = { warn: () => {}, info: () => {} };

const LEASE_SECONDS = 2;
/** Long enough past a 2 s lease for the holder's row to have lapsed. */
const PAST_THE_LEASE_MS = 2_500;

const SERVERS = LOCK_DIALECTS.filter(
  (dialect): dialect is Exclude<SupportedDialect, "sqlite"> =>
    dialect !== "sqlite"
);

/** How many statements marked with a schema lock claim are running on this database. */
async function markedRunning(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<number> {
  const rows = await adapter.executeQuery<{ n: unknown }>(
    dialect === "postgresql"
      ? `SELECT count(*) AS n FROM pg_stat_activity
          WHERE state = 'active' AND datname = current_database()
            AND query LIKE '/* nextly-lock:%'`
      : `SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST
          WHERE DB = DATABASE() AND COMMAND = 'Query' AND INFO LIKE '/* nextly-lock:%'`
  );
  return Number(rows[0]?.n ?? 0);
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

async function until(
  check: () => Promise<boolean>,
  what: string,
  ms = 15_000
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

describe.each(SERVERS)(
  "a takeover of the schema lock on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let holder: Holder | undefined;
    let freeTheTable: () => void = () => {};
    let busy: Promise<unknown> = Promise.resolve();

    beforeEach(async () => {
      world = await lockWorld(dialect);
      // One connection keeps the table busy, the rest are the taking run's.
      adapter = await world.connect({ poolMax: 6 });
      await world.reset(adapter, TABLES);
      await adapter.executeQuery(`CREATE TABLE ${BUSY} (id integer)`);
      // An open transaction that has read the table: the holder's ALTER waits for it to end.
      let read: () => void = () => {};
      const hasRead = new Promise<void>(resolve => {
        read = resolve;
      });
      const freed = new Promise<void>(resolve => {
        freeTheTable = resolve;
      });
      busy = adapter.transaction(async ctx => {
        await ctx.queryStatement(sql.raw(`SELECT id FROM ${BUSY}`));
        read();
        await freed;
      });
      await hasRead;
    });

    afterEach(async () => {
      freeTheTable();
      await busy.catch(() => {});
      if (holder !== undefined) {
        holder.kill("SIGCONT");
        holder.kill("SIGKILL");
        await holder.exited;
        holder = undefined;
      }
      await world.reset(adapter, TABLES);
      await adapter.disconnect();
      await world.dispose();
    });

    /** A second process holding the lock, its marked ALTER waiting on the busy table. */
    async function holderWaitingOnTheTable(): Promise<Holder> {
      const started = startScript(STATEMENT_HOLDER, [
        dialect,
        world.url,
        String(LEASE_SECONDS),
        PREFIX,
      ]);
      holder = started;
      await started.printed("sent");
      await until(
        async () => (await markedRunning(adapter, dialect)) === 1,
        "the holder's statement to wait on the table"
      );
      return started;
    }

    /** A second run: takes the lock, makes its first change, then lets the table go. */
    const takeOver = () =>
      withSchemaLock(
        {
          adapter,
          command: "nextly migrate",
          whenHeld: "wait",
          waitMs: 8_000,
          leaseSeconds: LEASE_SECONDS,
          logger: quiet,
        },
        async () => {
          await adapter.executeQuery(`CREATE TABLE ${TAKER} (id integer)`);
          freeTheTable();
          await busy;
          // Time for a statement still waiting on the table to land, were one left.
          await sleep(1_000);
          return columnsOf(adapter, dialect, BUSY);
        }
      );

    it("stops a statement of a holder killed while it waits, before the first change", async () => {
      const killed = await holderWaitingOnTheTable();
      killed.kill("SIGKILL");
      await killed.exited;
      holder = undefined;
      await sleep(PAST_THE_LEASE_MS);

      const outcome = await takeOver();

      expect(outcome).toEqual({ ran: true, value: ["id"] });
      expect(await tablesWithPrefix(adapter, PREFIX)).toEqual([BUSY, TAKER]);
      expect(await columnsOf(adapter, dialect, BUSY)).toEqual(["id"]);
      expect(await markedRunning(adapter, dialect)).toBe(0);
    });

    it("lands no statement of a holder paused past its lease after the first change", async () => {
      const paused = await holderWaitingOnTheTable();
      paused.kill("SIGSTOP");
      await sleep(PAST_THE_LEASE_MS);

      if (dialect === "mysql") {
        // The paused holder's connection still holds the named lock taken beside the row, which
        // the database ties to that connection: the second run waits and changes nothing.
        await expect(takeOver()).rejects.toMatchObject({
          code: "NEXTLY_MIGRATE_LOCK_BUSY",
        });
        expect(await tablesWithPrefix(adapter, PREFIX)).toEqual([BUSY]);
        return;
      }

      const outcome = await takeOver();
      expect(outcome).toEqual({ ran: true, value: ["id"] });

      // Resumed, the earlier holder finds its statement stopped and sends nothing further.
      paused.kill("SIGCONT");
      await paused.exited;
      holder = undefined;
      expect(paused.lines()).not.toContain("done");
      expect(await tablesWithPrefix(adapter, PREFIX)).toEqual([BUSY, TAKER]);
      expect(await columnsOf(adapter, dialect, BUSY)).toEqual(["id"]);
    });

    it.runIf(dialect === "postgresql")(
      "refuses, changing nothing, when an earlier statement outlives the wait",
      async () => {
        const killed = await holderWaitingOnTheTable();
        killed.kill("SIGKILL");
        await killed.exited;
        holder = undefined;
        await adapter.executeQuery(
          `CREATE ROLE ${WATCHER} LOGIN PASSWORD 'watcher'`
        );
        await adapter.executeQuery(`GRANT pg_read_all_stats TO ${WATCHER}`);
        await adapter.executeQuery(`GRANT ALL ON SCHEMA public TO ${WATCHER}`);
        await adapter.executeQuery(
          `GRANT ALL ON ALL TABLES IN SCHEMA public TO ${WATCHER}`
        );
        const url = new URL(world.url);
        url.username = WATCHER;
        url.password = "watcher";
        const watcher = createPostgresAdapter({
          url: url.toString(),
        }) as unknown as DrizzleAdapter;
        await watcher.connect();
        installRegistryResolver(watcher);
        try {
          await sleep(PAST_THE_LEASE_MS);

          const refused = await withSchemaLock(
            {
              adapter: watcher,
              command: "nextly migrate",
              whenHeld: "wait",
              waitMs: 1_000,
              leaseSeconds: LEASE_SECONDS,
              logger: quiet,
            },
            async () => {
              await watcher.executeQuery(`CREATE TABLE ${TAKER} (id integer)`);
            }
          ).catch((error: unknown) => error);

          expect(refused).toMatchObject({
            code: "NEXTLY_MIGRATE_LOCK_BUSY",
            logContext: { holder: { kind: "earlier-statement" } },
          });
          expect(String((refused as Error).message)).toContain(
            `ALTER TABLE ${BUSY} ADD COLUMN late integer`
          );
          expect(await tablesWithPrefix(adapter, PREFIX)).toEqual([BUSY]);
          // Refused with the lock given back, so the next run need not wait out a lease.
          const rows = await adapter.executeQuery<{ owner: string | null }>(
            "SELECT owner FROM nextly_schema_lock"
          );
          expect(rows).toEqual([{ owner: null }]);
        } finally {
          await watcher.disconnect();
          freeTheTable();
          await busy.catch(() => {});
          await adapter.executeQuery(`DROP OWNED BY ${WATCHER}`);
          await adapter.executeQuery(`DROP ROLE ${WATCHER}`);
        }
      }
    );
  },
  60_000
);
