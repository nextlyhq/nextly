/**
 * A migration that waits for a table another session is using waits in bounded tries, then stops
 * and says so: `nextly migrate`'s app files, run by `runFileMigrations`, against a second
 * connection that holds the table.
 *
 * On PostgreSQL and MySQL the holder is an open transaction that has read the table, so the
 * file's ALTER waits for its lock (on MySQL, the table's metadata lock). On SQLite it is an open
 * write transaction on a second connection to the same file, which holds the whole database. The
 * bounds are shortened (one second a try) so the cases run in seconds; the schedule they follow is
 * the default's, which the unit tests pin.
 *
 * A unit whose statements commit as they run (MySQL's schema statements, a file marked to run
 * outside a transaction) resumes past what an ended try kept: a statement sent twice would fail
 * on its duplicate column, or add its row twice.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runFileMigrations } from "../../../cli/commands/migrate";
import { createLogger } from "../../../cli/utils/logger";
import type { BusyTableBounds } from "../busy-table/bounds";
import { triggerTables } from "../busy-table/run-unit";
import { getSchemaEventsDdl } from "../events/schema-events-ddl";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import {
  LOCK_DIALECTS,
  lockWorld,
  sleep,
  type LockWorld,
} from "../pipeline/__tests__/helpers/schema-lock-world";

const PREFIX = `btw_${randomBytes(4).toString("hex")}`;
const BUSY = `${PREFIX}_busy`;
const EARLIER = `${PREFIX}_earlier`;
const FIRST = `${PREFIX}_first`;
const OTHER = `${PREFIX}_other`;
// The ledger too: on a server every test shares one database, and a file one test recorded
// applied would be skipped by the next.
const TABLES = [BUSY, EARLIER, FIRST, OTHER, "nextly_schema_events"];

const DIALECTS: readonly SupportedDialect[] = LOCK_DIALECTS;

const quiet = createLogger({ quiet: true });

describe.each(DIALECTS)(
  "a busy table on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let holderAdapter: DrizzleAdapter;
    let migrationsDir: string;
    let free: () => void = () => {};
    let holding: Promise<unknown> = Promise.resolve();
    let notices: string[];

    beforeEach(async () => {
      world = await lockWorld(dialect);
      adapter = await world.connect({ poolMax: 6 });
      holderAdapter = await world.connect({ poolMax: 2 });
      await world.reset(adapter, TABLES);
      for (const statement of getSchemaEventsDdl(dialect)) {
        await adapter.executeQuery(statement);
      }
      await adapter.executeQuery(`CREATE TABLE ${BUSY} (id integer)`);
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-busy-table-"));
      notices = [];
    });

    afterEach(async () => {
      // A spy on the repository's prototype would reach the next test's runs.
      vi.restoreAllMocks();
      free();
      await holding.catch(() => {});
      await holderAdapter.disconnect();
      await world.reset(adapter, TABLES);
      await adapter.disconnect();
      await world.dispose();
      rmSync(migrationsDir, { recursive: true, force: true });
    });

    /** A file of `up` statements, run in one transaction unless `outside` marks it. */
    function writeFile(
      name: string,
      up: readonly string[],
      options: { outside?: boolean } = {}
    ): string {
      const filename = `${name}.sql`;
      const marker =
        options.outside === true ? "-- nextly:no-transaction\n" : "";
      writeFileSync(
        join(migrationsDir, filename),
        `${marker}-- Migration: ${name}\n\n-- UP\n${up.map(s => `${s};`).join("\n")}\n\n-- DOWN\n`
      );
      return filename;
    }

    /**
     * The second session holds the table until `free()`: on PostgreSQL and MySQL an open
     * transaction that has read it (with `write`, one that has written a row of it), on SQLite an
     * open write transaction.
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
     * MySQL's second session takes the table with `LOCK TABLES … WRITE` until `free()`, so a row
     * change of the file waits for the table's lock, as a schema change would.
     */
    async function lockTheTableForWriting(): Promise<void> {
      let held: () => void = () => {};
      const isHeld = new Promise<void>(resolve => {
        held = resolve;
      });
      const freed = new Promise<void>(resolve => {
        free = resolve;
      });
      holding = holderAdapter.withSession(async session => {
        await session.execute(`LOCK TABLES ${BUSY} WRITE`);
        held();
        await freed;
        await session.execute("UNLOCK TABLES");
      });
      await isHeld;
    }

    /**
     * Holds the table once the file's statement `after` has run: on SQLite, whose holder holds the
     * whole database, the hold starts only then (the statements outside a transaction run through
     * the adapter one at a time), so the statement before the held table's commits first; on the
     * servers the hold starts now, as it holds the one table.
     */
    async function holdAfter(after: string): Promise<void> {
      if (dialect !== "sqlite") {
        await holdTheTable();
        return;
      }
      const run = adapter.executeQuery.bind(adapter);
      vi.spyOn(adapter, "executeQuery").mockImplementation(
        async (statement, params) => {
          const rows = await run(statement, params);
          if (statement === after) await holdTheTable();
          return rows;
        }
      );
    }

    /** Runs the app files with `bounds`, each try's notice kept; `beforeApply` before each file. */
    function migrate(
      bounds: BusyTableBounds,
      beforeApply?: (name: string) => Promise<void>
    ): Promise<number> {
      return runFileMigrations({
        ...(beforeApply === undefined ? {} : { beforeApply }),
        adapter: adapter as unknown as Parameters<
          typeof runFileMigrations
        >[0]["adapter"],
        db: adapter.getDrizzle(),
        dialect,
        migrationsDir,
        logger: quiet,
        busyTable: { bounds, notify: line => notices.push(line) },
      });
    }

    async function columnsOf(table: string): Promise<string[]> {
      const rows = await adapter.executeQuery<{ name: string }>(
        dialect === "sqlite"
          ? `SELECT name FROM pragma_table_info('${table}')`
          : `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}'`
      );
      return rows.map(row => row.name).sort();
    }

    async function idsOf(table: string): Promise<number[]> {
      const rows = await adapter.executeQuery<{ id: unknown }>(
        `SELECT id FROM ${table}`
      );
      return rows.map(row => Number(row.id)).sort((a, b) => a - b);
    }

    async function tableExists(table: string): Promise<boolean> {
      return adapter.tableExists(table);
    }

    async function appliedRows(filename: string): Promise<number> {
      const repo = new SchemaEventsRepository(adapter.getDrizzle(), dialect);
      const rows = await repo.listFileApplies();
      return rows.filter(
        row => row.filename === filename && row.status === "applied"
      ).length;
    }

    it("stops within the total bound plus five seconds after the scheduled tries, the column absent", async () => {
      writeFile("20261112_000001_add_late", [
        `ALTER TABLE ${BUSY} ADD COLUMN late integer`,
      ]);
      await holdTheTable();

      const started = Date.now();
      const stopped = await migrate({ tryMs: 1_000, totalMs: 10_000 }).catch(
        (error: unknown) => error
      );
      const elapsed = Date.now() - started;

      expect(stopped).toMatchObject({
        code: "NEXTLY_TABLE_BUSY",
        logContext: { reason: "table busy" },
      });
      // A try of 1 second and a total of 10 give tries at 0, 2 and 5 seconds.
      expect(
        (stopped as { logContext: { stop: { tries: number } } }).logContext.stop
          .tries
      ).toBe(3);
      expect(elapsed).toBeLessThan(15_000);
      expect(notices).toHaveLength(2);
      expect(await columnsOf(BUSY)).toEqual(["id"]);
      expect(String((stopped as Error).message)).toContain("nothing changed");
      // The holder is read while the statement still waits, so the database names it.
      if (dialect === "postgresql") {
        expect(String((stopped as Error).message)).toMatch(/session \d+/);
      }
    });

    it("applies on the next try once the holder ends during the third pause", async () => {
      const filename = writeFile("20261112_000001_add_late", [
        `ALTER TABLE ${BUSY} ADD COLUMN late integer`,
      ]);
      await holdTheTable();
      // Tries at 0, 2, 5 and 10 seconds: the third pause runs from 6 to 10.
      const freeing = sleep(7_500).then(() => free());

      const applied = await migrate({ tryMs: 1_000, totalMs: 20_000 });
      await freeing;

      expect(applied).toBe(1);
      expect(await columnsOf(BUSY)).toEqual(["id", "late"]);
      expect(notices).toHaveLength(3);
      expect(await appliedRows(filename)).toBe(1);
    });

    it("reports table busy, nothing changed, with an earlier file of the run applied and named", async () => {
      const earlier = writeFile("20261112_000001_create_earlier", [
        `CREATE TABLE ${EARLIER} (id integer)`,
      ]);
      writeFile("20261112_000002_add_late", [
        `ALTER TABLE ${BUSY} ADD COLUMN late integer`,
      ]);
      // The earlier file applies before the table is held (on SQLite the holder holds the whole
      // database); the table is held just before the next one, which meets the holder.
      const stopped = await migrate(
        { tryMs: 1_000, totalMs: 3_000 },
        async name => {
          if (name === "20261112_000002_add_late") await holdTheTable();
        }
      ).catch((error: unknown) => error);

      expect(stopped).toMatchObject({ code: "NEXTLY_TABLE_BUSY" });
      const message = String((stopped as Error).message);
      expect(message).toContain(earlier);
      expect(message).toContain("nothing changed");
      expect(await tableExists(EARLIER)).toBe(true);
      expect(await appliedRows(earlier)).toBe(1);
      expect(await columnsOf(BUSY)).toEqual(["id"]);
    });

    it("applies a two-statement file held on its second table once, with one attempt recorded", async () => {
      const filename = writeFile("20261112_000001_two_statements", [
        `CREATE TABLE ${FIRST} (id integer)`,
        `ALTER TABLE ${BUSY} ADD COLUMN late integer`,
      ]);
      await holdTheTable();
      // Tries at 0, 2 and 5 seconds: the second pause runs from 3 to 5.
      const freeing = sleep(3_500).then(() => free());

      const applied = await migrate({ tryMs: 1_000, totalMs: 20_000 });
      await freeing;

      expect(applied).toBe(1);
      expect(await tableExists(FIRST)).toBe(true);
      expect(await columnsOf(BUSY)).toEqual(["id", "late"]);
      expect(await appliedRows(filename)).toBe(1);
    });

    it.runIf(dialect === "mysql")(
      "keeps a schema change MySQL committed before the wait, and sends only the waiting one again",
      async () => {
        await adapter.executeQuery(`CREATE TABLE ${OTHER} (id integer)`);
        const filename = writeFile("20261112_000001_two_alters", [
          `ALTER TABLE ${OTHER} ADD COLUMN extra integer`,
          `ALTER TABLE ${BUSY} ADD COLUMN late integer`,
        ]);
        await holdTheTable();
        // Tries at 0, 2 and 5 seconds: the second pause runs from 3 to 5.
        const freeing = sleep(3_500).then(() => free());

        const applied = await migrate({ tryMs: 1_000, totalMs: 20_000 });
        await freeing;

        // Sent again, the first ALTER would have failed on its duplicate column.
        expect(applied).toBe(1);
        expect(notices).toHaveLength(2);
        expect(await columnsOf(OTHER)).toEqual(["extra", "id"]);
        expect(await columnsOf(BUSY)).toEqual(["id", "late"]);
        expect(await appliedRows(filename)).toBe(1);
      }
    );

    it.runIf(dialect === "mysql")(
      "runs MySQL's open transaction again from its first row change once the table is free",
      async () => {
        await adapter.executeQuery(`CREATE TABLE ${OTHER} (id integer)`);
        const filename = writeFile("20261112_000001_two_rows", [
          `INSERT INTO ${OTHER} (id) VALUES (1)`,
          `INSERT INTO ${BUSY} (id) VALUES (2)`,
        ]);
        await lockTheTableForWriting();
        const freeing = sleep(3_500).then(() => free());

        const applied = await migrate({ tryMs: 1_000, totalMs: 20_000 });
        await freeing;

        // The first try's row was rolled back with its transaction, and added again once.
        expect(applied).toBe(1);
        expect(notices).toHaveLength(2);
        expect(await idsOf(OTHER)).toEqual([1]);
        expect(await idsOf(BUSY)).toEqual([2]);
        expect(await appliedRows(filename)).toBe(1);
      }
    );

    it.runIf(dialect === "mysql")(
      "adds a row written after a schema statement's implicit commit once, though the try after it waited",
      async () => {
        await adapter.executeQuery(`CREATE TABLE ${OTHER} (id integer)`);
        const filename = writeFile("20261113_000001_after_commit", [
          `CREATE TABLE ${FIRST} (id integer)`,
          `INSERT INTO ${OTHER} (id) VALUES (1)`,
          `INSERT INTO ${BUSY} (id) VALUES (2)`,
        ]);
        await lockTheTableForWriting();
        const freeing = sleep(3_500).then(() => free());

        const applied = await migrate({ tryMs: 1_000, totalMs: 20_000 });
        await freeing;

        // MySQL committed at the CREATE; the row after it rolled back with the try that waited,
        // and was added again once, not kept and added a second time.
        expect(applied).toBe(1);
        expect(await idsOf(OTHER)).toEqual([1]);
        expect(await idsOf(BUSY)).toEqual([2]);
        expect(await appliedRows(filename)).toBe(1);
      }
    );

    it.runIf(dialect === "mysql")(
      "says a transaction MySQL rolled back whole was undone where a no-retry row change waited",
      async () => {
        await adapter.executeQuery(`CREATE TABLE ${OTHER} (id integer)`);
        await adapter.executeQuery(
          `CREATE TRIGGER ${PREFIX}_keep BEFORE INSERT ON ${BUSY} FOR EACH ROW SET NEW.id = NEW.id`
        );
        writeFile("20261113_000001_triggered", [
          `INSERT INTO ${OTHER} (id) VALUES (1)`,
          `INSERT INTO ${BUSY} (id) VALUES (2)`,
        ]);
        await lockTheTableForWriting();

        const stopped = await migrate({ tryMs: 1_000, totalMs: 20_000 }).catch(
          (error: unknown) => error
        );

        expect(stopped).toMatchObject({
          code: "NEXTLY_TABLE_BUSY",
          logContext: {
            stop: {
              tries: 1,
              outcome: {
                kind: "no-retry",
                statementNumber: 2,
                reason: "trigger",
                restUndone: true,
              },
            },
          },
        });
        expect(await idsOf(OTHER)).toEqual([]);
        expect(String((stopped as Error).message)).toContain(
          "was undone whole"
        );
      }
    );

    it.runIf(dialect === "mysql")(
      "bounds a row change waiting on a row another session holds, not InnoDB's own 50 seconds",
      async () => {
        await adapter.executeQuery(`INSERT INTO ${BUSY} (id) VALUES (5)`);
        writeFile("20261113_000001_update_row", [
          `UPDATE ${BUSY} SET id = 7 WHERE id = 5`,
        ]);
        // The second session holds the row, not the table: an open transaction that updated it.
        let held: () => void = () => {};
        const isHeld = new Promise<void>(resolve => {
          held = resolve;
        });
        const freed = new Promise<void>(resolve => {
          free = resolve;
        });
        holding = holderAdapter.transaction(async ctx => {
          await ctx.queryStatement(
            sql.raw(`UPDATE ${BUSY} SET id = 6 WHERE id = 5`)
          );
          held();
          await freed;
        });
        await isHeld;

        const started = Date.now();
        const stopped = await migrate({ tryMs: 1_000, totalMs: 3_000 }).catch(
          (error: unknown) => error
        );

        expect(stopped).toMatchObject({ code: "NEXTLY_TABLE_BUSY" });
        expect(Date.now() - started).toBeLessThan(10_000);
      }
    );

    it("resumes a file run outside a transaction at its waiting statement, the one before it not sent again", async () => {
      await adapter.executeQuery(`CREATE TABLE ${OTHER} (id integer)`);
      const first = `ALTER TABLE ${OTHER} ADD COLUMN extra integer`;
      const filename = writeFile(
        "20261112_000001_outside",
        [first, `ALTER TABLE ${BUSY} ADD COLUMN late integer`],
        { outside: true }
      );
      await holdAfter(first);
      const freeing = sleep(3_500).then(() => free());

      const applied = await migrate({ tryMs: 1_000, totalMs: 20_000 });
      await freeing;

      // Sent again, the first statement would have failed on its duplicate column.
      expect(applied).toBe(1);
      expect(notices.length).toBeGreaterThanOrEqual(1);
      expect(await columnsOf(OTHER)).toEqual(["extra", "id"]);
      expect(await columnsOf(BUSY)).toEqual(["id", "late"]);
      expect(await appliedRows(filename)).toBe(1);
    });

    it("stops a file run outside a transaction part-way, naming the kept statement by its position", async () => {
      await adapter.executeQuery(`CREATE TABLE ${OTHER} (id integer)`);
      const first = `ALTER TABLE ${OTHER} ADD COLUMN extra integer`;
      writeFile(
        "20261112_000001_outside",
        [first, `ALTER TABLE ${BUSY} ADD COLUMN late integer`],
        { outside: true }
      );
      await holdAfter(first);
      const stopped = await migrate({ tryMs: 1_000, totalMs: 3_000 }).catch(
        (error: unknown) => error
      );

      expect(stopped).toMatchObject({
        code: "NEXTLY_TABLE_BUSY",
        logContext: {
          stop: { outcome: { kind: "part-way", committed: [1] } },
        },
      });
      expect(await columnsOf(OTHER)).toEqual(["extra", "id"]);
      expect(await columnsOf(BUSY)).toEqual(["id"]);
      const message = String((stopped as Error).message);
      expect(message).toContain("Statement 1 had committed");
      // Named by position only: a statement's text can hold a literal value.
      expect(message).not.toMatch(/ALTER|ADD COLUMN|extra/i);
    });

    it.runIf(dialect !== "sqlite")(
      "stops after one try where a statement it kept made a temporary table the next try's session would not have",
      async () => {
        const stage = `${PREFIX}_stage`;
        writeFile(
          "20261112_000001_staged",
          [
            `CREATE TEMPORARY TABLE ${stage} (id integer)`,
            `INSERT INTO ${stage} (id) VALUES (1)`,
            `ALTER TABLE ${BUSY} ADD COLUMN late integer`,
          ],
          { outside: true }
        );
        await holdTheTable();

        const stopped = await migrate({ tryMs: 1_000, totalMs: 20_000 }).catch(
          (error: unknown) => error
        );

        // Resumed on a new session, the third statement would run without the staged rows, or a
        // later statement reading them would fail: the run stops instead, naming the first.
        expect(stopped).toMatchObject({
          code: "NEXTLY_TABLE_BUSY",
          logContext: {
            stop: {
              tries: 1,
              outcome: {
                kind: "no-retry",
                statementNumber: 1,
                reason: "session-state",
              },
            },
          },
        });
        expect(notices).toHaveLength(0);
        expect(await columnsOf(BUSY)).toEqual(["id"]);
      }
    );

    it.runIf(dialect === "postgresql")(
      "stops where a row change waits on a table the file itself gave a trigger, reading the triggers after the try",
      async () => {
        const touch = `${PREFIX}_touch`;
        await adapter.executeQuery(`CREATE TABLE ${OTHER} (id integer)`);
        await adapter.executeQuery(`INSERT INTO ${OTHER} (id) VALUES (1)`);
        writeFile(
          "20261112_000001_trigger",
          [
            `CREATE FUNCTION ${touch}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`,
            `CREATE TRIGGER ${touch} BEFORE UPDATE ON ${OTHER} FOR EACH ROW EXECUTE FUNCTION ${touch}()`,
            `UPDATE ${OTHER} SET id = id WHERE id = 1`,
          ],
          { outside: true }
        );
        // A row lock on the row the update changes: the trigger's CREATE does not wait for it,
        // the update does, once the trigger exists.
        let held: () => void = () => {};
        const isHeld = new Promise<void>(resolve => {
          held = resolve;
        });
        const freed = new Promise<void>(resolve => {
          free = resolve;
        });
        holding = holderAdapter.transaction(async ctx => {
          await ctx.queryStatement(
            sql.raw(`SELECT id FROM ${OTHER} WHERE id = 1 FOR UPDATE`)
          );
          held();
          await freed;
        });
        await isHeld;
        try {
          const stopped = await migrate({
            tryMs: 1_000,
            totalMs: 3_000,
          }).catch((error: unknown) => error);

          // Read before the file, the triggers named none on that table; sent again, the update
          // would run the trigger's code a second time for the rows it already reached.
          expect(stopped).toMatchObject({
            code: "NEXTLY_TABLE_BUSY",
            logContext: {
              stop: {
                tries: 1,
                outcome: {
                  kind: "no-retry",
                  statementNumber: 3,
                  reason: "trigger",
                },
              },
            },
          });
        } finally {
          free();
          await holding.catch(() => {});
          await adapter.executeQuery(`DROP TABLE IF EXISTS ${OTHER}`);
          await adapter.executeQuery(`DROP FUNCTION IF EXISTS ${touch}()`);
        }
      }
    );

    /**
     * Makes a DDL event trigger for the test, owned by `plpgsql` where `extensionOwned`, and
     * returns what drops it again.
     */
    async function ddlEventTrigger(
      extensionOwned: boolean
    ): Promise<() => Promise<void>> {
      const name = `${PREFIX}_ddl_watch`;
      await adapter.executeQuery(
        `CREATE FUNCTION ${name}() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN END $$`
      );
      await adapter.executeQuery(
        `CREATE EVENT TRIGGER ${name} ON ddl_command_start EXECUTE FUNCTION ${name}()`
      );
      if (extensionOwned) {
        await adapter.executeQuery(
          `ALTER EXTENSION plpgsql ADD EVENT TRIGGER ${name}`
        );
      }
      return async () => {
        if (extensionOwned) {
          await adapter.executeQuery(
            `ALTER EXTENSION plpgsql DROP EVENT TRIGGER ${name}`
          );
        }
        await adapter.executeQuery(`DROP EVENT TRIGGER IF EXISTS ${name}`);
        await adapter.executeQuery(`DROP FUNCTION IF EXISTS ${name}()`);
      };
    }

    it.runIf(dialect === "postgresql")(
      "stops after one try where a DDL event trigger would run its code again for the schema change",
      async () => {
        const drop = await ddlEventTrigger(false);
        try {
          writeFile("20261113_000001_add_late", [
            `ALTER TABLE ${BUSY} ADD COLUMN late integer`,
          ]);
          await holdTheTable();

          const stopped = await migrate({
            tryMs: 1_000,
            totalMs: 4_000,
          }).catch((error: unknown) => error);

          expect(stopped).toMatchObject({
            code: "NEXTLY_TABLE_BUSY",
            logContext: {
              stop: {
                tries: 1,
                outcome: {
                  kind: "no-retry",
                  statementNumber: 1,
                  reason: "event-trigger",
                  restUndone: true,
                },
              },
            },
          });
          expect(notices).toHaveLength(0);
        } finally {
          free();
          await holding.catch(() => {});
          await drop();
        }
      }
    );

    it.runIf(dialect === "postgresql")(
      "keeps trying where the only DDL event trigger belongs to an installed extension",
      async () => {
        const drop = await ddlEventTrigger(true);
        try {
          writeFile("20261113_000001_add_late", [
            `ALTER TABLE ${BUSY} ADD COLUMN late integer`,
          ]);
          await holdTheTable();

          const stopped = await migrate({
            tryMs: 1_000,
            totalMs: 4_000,
          }).catch((error: unknown) => error);

          expect(stopped).toMatchObject({
            code: "NEXTLY_TABLE_BUSY",
            logContext: {
              stop: { tries: 2, outcome: { kind: "nothing-changed" } },
            },
          });
        } finally {
          free();
          await holding.catch(() => {});
          await drop();
        }
      }
    );

    it.runIf(dialect === "postgresql")(
      "reads the triggers of a schema the file puts on its search path before judging a row change",
      async () => {
        const schema = `${PREFIX}_audit`;
        const touch = `${PREFIX}_touch`;
        await adapter.executeQuery(`CREATE SCHEMA ${schema}`);
        try {
          await adapter.executeQuery(
            `CREATE TABLE ${schema}.${OTHER} (id integer)`
          );
          await adapter.executeQuery(
            `CREATE FUNCTION ${schema}.${touch}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`
          );
          await adapter.executeQuery(
            `CREATE TRIGGER ${touch} BEFORE INSERT ON ${schema}.${OTHER} FOR EACH ROW EXECUTE FUNCTION ${schema}.${touch}()`
          );
          writeFile("20261113_000001_audited", [
            `SET LOCAL search_path TO ${schema}, public`,
            `INSERT INTO ${OTHER} (id) VALUES (1)`,
            `ALTER TABLE ${BUSY} ADD COLUMN late integer`,
          ]);
          await holdTheTable();

          const stopped = await migrate({
            tryMs: 1_000,
            totalMs: 4_000,
          }).catch((error: unknown) => error);

          // Sent again, the insert would fire the trigger's code a second time.
          expect(stopped).toMatchObject({
            code: "NEXTLY_TABLE_BUSY",
            logContext: {
              stop: {
                tries: 1,
                outcome: {
                  kind: "no-retry",
                  statementNumber: 2,
                  reason: "trigger",
                },
              },
            },
          });
        } finally {
          free();
          await holding.catch(() => {});
          await adapter.executeQuery(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        }
      }
    );

    it.runIf(dialect === "mysql")(
      "trusts the trigger list of an account that may see every trigger of the database",
      async () => {
        // The test account holds every privilege: the grant must be found, or every row change
        // would stop a run as one whose triggers could not be seen.
        expect(await triggerTables(adapter, dialect)).toBeInstanceOf(Set);
      }
    );

    it.runIf(dialect === "postgresql")(
      "stops after one try where the waiting statement builds an index concurrently",
      async () => {
        await adapter.executeQuery(`CREATE TABLE ${OTHER} (id integer)`);
        writeFile(
          "20261112_000001_concurrent_index",
          [
            `ALTER TABLE ${OTHER} ADD COLUMN extra integer`,
            `CREATE INDEX CONCURRENTLY ${PREFIX}_busy_id ON ${BUSY} (id)`,
          ],
          { outside: true }
        );
        // A concurrent build waits for the transactions that have written the table.
        await holdTheTable({ write: true });

        const stopped = await migrate({ tryMs: 1_000, totalMs: 20_000 }).catch(
          (error: unknown) => error
        );

        expect(stopped).toMatchObject({
          code: "NEXTLY_TABLE_BUSY",
          logContext: {
            stop: {
              tries: 1,
              outcome: {
                kind: "no-retry",
                statementNumber: 2,
                reason: "concurrent-index",
              },
            },
          },
        });
        expect(notices).toHaveLength(0);
        expect(String((stopped as Error).message)).not.toMatch(
          /CREATE INDEX|CONCURRENTLY/i
        );
      }
    );
  },
  60_000
);
