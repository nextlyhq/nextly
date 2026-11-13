/**
 * Schema statements that are not a migration unit wait for a busy table in bounded tries, then
 * stop and say so: `migrate:fresh`'s drops, `prune`'s drops, the development start's table
 * creation, and the runner they share (`runStatementsInTries`), against a second connection that
 * holds a table.
 *
 * On PostgreSQL and MySQL the holder is an open transaction that has read the table (with
 * `write`, written a row of it), so a schema change of it waits for its lock. On SQLite it is an
 * open write transaction on a second connection to the same file, which holds the whole database,
 * so it starts only once the statements before the held one have run. The bounds are shortened
 * (one second a try) so the cases run in seconds.
 *
 * Each case runs on a database of its own, since `migrate:fresh` drops every table there is.
 */
import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyCoreStatements } from "../../../cli/commands/dev-server";
import { dropAllTables } from "../../../cli/commands/migrate-fresh";
import { runPrune } from "../../../cli/commands/prune";
import { createLogger } from "../../../cli/utils/logger";
import type { BusyTableBounds } from "../busy-table/bounds";
import { runStatementsInTries } from "../busy-table/run-on-session";
import {
  LOCK_DIALECTS,
  lockWorld,
  sleep,
  type LockWorld,
} from "../pipeline/__tests__/helpers/schema-lock-world";

const PREFIX = `bts_${randomBytes(4).toString("hex")}`;
// Named so `migrate:fresh` drops them in this order: the first, then the held one, then the last.
const FIRST = `${PREFIX}_a`;
const BUSY = `${PREFIX}_b`;
const LAST = `${PREFIX}_c`;
const TABLES = [FIRST, BUSY, LAST];

/** A try of a second and three in all: a try or two, then a stop. */
const STOPS: BusyTableBounds = { tryMs: 1_000, totalMs: 3_000 };
/** Room for tries at 0, 2, 5 and 10 seconds. */
const WAITS: BusyTableBounds = { tryMs: 1_000, totalMs: 20_000 };

const quiet = createLogger({ quiet: true });

describe.each(LOCK_DIALECTS as readonly SupportedDialect[])(
  "statements waiting for a busy table on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let holderAdapter: DrizzleAdapter;
    let free: () => void = () => {};
    let holding: Promise<unknown> = Promise.resolve();
    let notices: string[];

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect({ poolMax: 6 });
      holderAdapter = await world.connect({ poolMax: 2 });
      for (const table of TABLES) {
        await adapter.executeQuery(`CREATE TABLE ${table} (id integer)`);
      }
      notices = [];
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      free();
      await holding.catch(() => {});
      await holderAdapter.disconnect();
      await world.reset(adapter, TABLES);
      await adapter.disconnect();
      await world.dispose();
    });

    /**
     * The second session holds `BUSY` until `free()`: on the servers an open transaction that has
     * read it (with `write`, written a row of it), on SQLite an open write transaction.
     */
    async function holdTheTable(
      options: { write?: boolean } = {}
    ): Promise<void> {
      let held: () => void = () => {};
      const isHeld = new Promise<void>(resolve => {
        held = resolve;
      });
      const freed = new Promise<void>(resolve => {
        free = resolve;
      });
      holding = holderAdapter.transaction(async ctx => {
        await ctx.queryStatement(
          dialect === "sqlite" || options.write === true
            ? sql.raw(`INSERT INTO ${BUSY} (id) VALUES (0) RETURNING id`)
            : sql.raw(`SELECT id FROM ${BUSY}`)
        );
        held();
        await freed;
      });
      await isHeld;
    }

    /**
     * Holds `BUSY` once a statement matching `after` has run: on SQLite, whose holder holds the
     * whole database, only then (the statements run through the adapter one at a time), so the
     * statement before the held table's commits first; on the servers now.
     */
    async function holdAfter(after: RegExp): Promise<void> {
      if (dialect !== "sqlite") {
        await holdTheTable();
        return;
      }
      const run = adapter.executeQuery.bind(adapter);
      let started = false;
      vi.spyOn(adapter, "executeQuery").mockImplementation(
        async (statement, params) => {
          const rows = await run(statement, params);
          if (!started && after.test(statement)) {
            started = true;
            await holdTheTable();
          }
          return rows;
        }
      );
    }

    async function columnsOf(table: string): Promise<string[]> {
      const rows = await adapter.executeQuery<{ name: string }>(
        dialect === "sqlite"
          ? `SELECT name FROM pragma_table_info('${table}')`
          : `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}'`
      );
      return rows.map(row => row.name).sort();
    }

    async function existing(): Promise<string[]> {
      const present: string[] = [];
      for (const table of TABLES) {
        if (await adapter.tableExists(table)) present.push(table);
      }
      return present;
    }

    const notify = (line: string) => notices.push(line);

    it("migrate:fresh stops at the held table naming the tables it dropped, and the next run drops the rest", async () => {
      await holdAfter(new RegExp(`DROP TABLE IF EXISTS .${FIRST}.`));

      const stopped = await dropAllTables(adapter, dialect, quiet, {
        bounds: STOPS,
        notify,
      }).catch((error: unknown) => error);

      expect(stopped).toMatchObject({
        code: "NEXTLY_TABLE_BUSY",
        logContext: {
          stop: {
            change: `nextly migrate:fresh: the drop of table "${BUSY}"`,
            ended: { table: BUSY },
            appliedBefore: [
              `nextly migrate:fresh: the drop of table "${FIRST}"`,
            ],
            outcome: { kind: "nothing-changed" },
          },
        },
      });
      const message = String((stopped as Error).message);
      expect(message).toContain(`the drop of table "${FIRST}"`);
      expect(message).toContain(`the drop of table "${BUSY}"`);
      expect(message).not.toMatch(/DROP TABLE/);
      expect(await existing()).toEqual([BUSY, LAST]);

      free();
      await holding;
      vi.restoreAllMocks();
      const finished = await dropAllTables(adapter, dialect, quiet, {
        bounds: STOPS,
        notify,
      });

      expect(finished.droppedTables).toEqual([BUSY, LAST]);
      expect(await existing()).toEqual([]);
    });

    it("prune stops at the held table, the orphan before it dropped, and the next run finishes", async () => {
      const deleted = new Set<string>();
      const registry = {
        findOrphanedCollections: () =>
          Promise.resolve(
            [FIRST, BUSY]
              .filter(table => !deleted.has(table))
              .map(table => ({ slug: table, tableName: table }))
          ),
        deleteCollection: (slug: string) => {
          deleted.add(slug);
          return Promise.resolve();
        },
        assertNothingDependsOn: () => Promise.resolve(),
      };
      const prune = () =>
        runPrune({
          registry: registry as unknown as Parameters<
            typeof runPrune
          >[0]["registry"],
          adapter,
          busyTable: { adapter, bounds: STOPS, notify },
          lock: work => work(),
          currentSlugs: [],
          approve: () => Promise.resolve(true),
        });
      await holdAfter(new RegExp(`DROP TABLE IF EXISTS .${FIRST}.`));

      const stopped = await prune().catch((error: unknown) => error);

      expect(stopped).toMatchObject({
        code: "NEXTLY_TABLE_BUSY",
        logContext: {
          stop: {
            change: `nextly prune: the drop of table "${BUSY}"`,
            ended: { table: BUSY },
            appliedBefore: [`nextly prune: the drop of table "${FIRST}"`],
          },
        },
      });
      expect(await existing()).toEqual([BUSY, LAST]);
      expect([...deleted]).toEqual([FIRST]);

      free();
      await holding;
      vi.restoreAllMocks();
      const finished = await prune();

      expect(finished.dropped).toEqual([BUSY]);
      expect(await existing()).toEqual([LAST]);
    });

    /** An index on the held table: it waits for the table on the servers, the database on SQLite. */
    const createIndex =
      dialect === "mysql"
        ? `CREATE INDEX ${PREFIX}_busy_id ON ${BUSY} (id)`
        : `CREATE INDEX IF NOT EXISTS ${PREFIX}_busy_id ON ${BUSY} (id)`;

    async function indexed(): Promise<boolean> {
      const rows = await adapter.executeQuery<{ name: string }>(
        dialect === "sqlite"
          ? `SELECT name FROM sqlite_master WHERE type = 'index' AND name = '${PREFIX}_busy_id'`
          : dialect === "postgresql"
            ? `SELECT indexname AS name FROM pg_indexes WHERE indexname = '${PREFIX}_busy_id'`
            : `SELECT INDEX_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME = '${PREFIX}_busy_id'`
      );
      return rows.length > 0;
    }

    it("the development start's table creation stops where the table stays held", async () => {
      // A write holds the table against an index build on PostgreSQL, whose build lets reads by;
      // on MySQL a read already holds the metadata lock the build waits for.
      await holdTheTable({ write: dialect === "postgresql" });
      const warn = vi.spyOn(quiet, "warn");
      vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
      // Tries at 0 and about 2 seconds; a third, after a pause of 2, would not end by 5.
      vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "5");

      const stopped = await applyCoreStatements(adapter, quiet, [
        createIndex,
      ]).catch((error: unknown) => error);
      vi.unstubAllEnvs();

      expect(stopped).toMatchObject({
        code: "NEXTLY_TABLE_BUSY",
        logContext: {
          stop: {
            change: "the core tables' setup: statement 1 of 1",
            tries: 2,
          },
        },
      });
      // The try after the first said so through the logger.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(await indexed()).toBe(false);
    });

    it("the development start's table creation applies once the holder ends during a pause", async () => {
      await holdTheTable({ write: dialect === "postgresql" });
      vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
      vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "20");
      // Tries at 0 and 2 seconds: the first pause runs from 1 to 2.
      const freeing = sleep(1_500).then(() => free());

      await applyCoreStatements(adapter, quiet, [createIndex]);
      await freeing;
      vi.unstubAllEnvs();

      expect(await indexed()).toBe(true);
    });

    it("sends the statement before the held one once and only the held one again, then succeeds", async () => {
      const first = `ALTER TABLE ${FIRST} ADD COLUMN extra integer`;
      await holdAfter(new RegExp(`^ALTER TABLE ${FIRST} `));
      // Tries at 0, 2 and 5 seconds: the second pause runs from 3 to 5.
      const freeing = sleep(3_500).then(() => free());

      const applied = await runStatementsInTries(
        adapter,
        [first, `ALTER TABLE ${BUSY} ADD COLUMN late integer`],
        { change: "nextly test", bounds: WAITS, notify, appliedBefore: [] }
      );
      await freeing;

      // Sent again, the first statement would have failed on its duplicate column.
      expect(applied).toEqual([
        "nextly test: statement 1 of 2",
        "nextly test: statement 2 of 2",
      ]);
      expect(notices.length).toBeGreaterThanOrEqual(1);
      expect(await columnsOf(FIRST)).toEqual(["extra", "id"]);
      expect(await columnsOf(BUSY)).toEqual(["id", "late"]);
    });
  },
  60_000
);
