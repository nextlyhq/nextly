/**
 * A migration that waits for a table another session is using waits in bounded tries, then stops
 * and says so: `nextly migrate`'s app files, run by `runFileMigrations`, against a second
 * connection that holds the table.
 *
 * On PostgreSQL the holder is an open transaction that has read the table, so the file's ALTER
 * waits for its lock. On SQLite it is an open write transaction on a second connection to the same
 * file, which holds the whole database. The bounds are shortened (one second a try) so the cases
 * run in seconds; the schedule they follow is the default's, which the unit tests pin.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runFileMigrations } from "../../../cli/commands/migrate";
import { createLogger } from "../../../cli/utils/logger";
import type { BusyTableBounds } from "../busy-table/bounds";
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
const TABLES = [BUSY, EARLIER, FIRST];

/** This slice runs a unit in tries where it runs in one transaction on PostgreSQL or SQLite. */
const DIALECTS = LOCK_DIALECTS.filter(
  (dialect): dialect is Exclude<SupportedDialect, "mysql"> =>
    dialect !== "mysql"
);

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
      free();
      await holding.catch(() => {});
      await holderAdapter.disconnect();
      await world.reset(adapter, TABLES);
      await adapter.disconnect();
      await world.dispose();
      rmSync(migrationsDir, { recursive: true, force: true });
    });

    /** A file of `up` statements, run in one transaction. */
    function writeFile(name: string, up: readonly string[]): string {
      const filename = `${name}.sql`;
      writeFileSync(
        join(migrationsDir, filename),
        `-- Migration: ${name}\n\n-- UP\n${up.map(s => `${s};`).join("\n")}\n\n-- DOWN\n`
      );
      return filename;
    }

    /**
     * The second session holds the table until `free()`: on PostgreSQL an open transaction that has
     * read it, on SQLite an open write transaction.
     */
    async function holdTheTable(): Promise<void> {
      let held: () => void = () => {};
      const isHeld = new Promise<void>(resolve => {
        held = resolve;
      });
      const freed = new Promise<void>(resolve => {
        free = resolve;
      });
      holding = holderAdapter.transaction(async ctx => {
        await ctx.queryStatement(
          dialect === "sqlite"
            ? sql.raw(`INSERT INTO ${BUSY} (id) VALUES (0) RETURNING id`)
            : sql.raw(`SELECT id FROM ${BUSY}`)
        );
        held();
        await freed;
      });
      await isHeld;
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
  },
  60_000
);
