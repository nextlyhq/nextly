/**
 * Every command that runs, records or rolls back app migrations checks the
 * app's history before its first write, on PostgreSQL, MySQL and SQLite, and
 * a refused run leaves the schema, the ledger and the registry as they were.
 *
 * - An older build, whose folder lacks a migration a newer build applied,
 *   stops with `MIGRATION_MISSING` (exit code 3) naming it: `nextly migrate`,
 *   `migrate:down`, `migrate:baseline` and `upgrade --reconcile-core` alike.
 * - An applied file whose down section was edited stops each of them with
 *   `MIGRATION_TAMPERED` (exit code 2), and an unresolved attempt stops each
 *   of them too.
 * - A migration the folder lacks that a newer build tried and did not finish
 *   stops them with exit code 3, and they go on once `migrate:resolve
 *   --rolled-back --file-missing` records it.
 * - A removal recorded with `migrate:resolve --removed` is not missing; the
 *   migration stays applied, is never run again when its file returns, and is
 *   checked against its recorded checksum; `migrate:down` refuses it by name
 *   while its file is absent.
 */
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrationStanding } from "../../../domains/schema/events/migration-state";
import { ensureSchemaEventsTable } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { checksumOf } from "../../../domains/schema/migrate/applied-checksums";
import {
  resolveDataLossConsent,
  type DataLossConsent,
} from "../../../domains/schema/migrate/data-loss-consent";
import {
  resolveMigration,
  type ResolveMode,
} from "../../../domains/schema/migrate/resolve";
import { parseSqlSections } from "../../../domains/schema/migrate/sql-sections";
import { marksNoTransaction } from "../../../domains/schema/migrate/split-sql";
import { withMigrateLock } from "../../../domains/schema/pipeline/locks";
import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { NextlyError } from "../../../errors/nextly-error";
import { createLogger } from "../../utils/logger";
import {
  assertAppHistoryHolds,
  migrateCore,
  migrateExitCode,
} from "../migrate";
import { baselineCore } from "../migrate-baseline";
import { downDatabaseDeps, migrateDownCore } from "../migrate-down";
import { runReconcileCore } from "../upgrade";

/** Every table a lock keeps its row in: not part of what a run leaves behind. */
const LOCK_TABLES = new Set([
  "nextly_schema_lock",
  "nextly_field_group_lock",
  "nextly_migrate_lock",
]);

const logger = createLogger({ quiet: true });

describe.each(LOCK_DIALECTS)(
  "the app's history checked first on %s",
  dialect => {
    const P = `mhc_${randomBytes(3).toString("hex")}`;
    const ONE = `20261106_000001_${P}_one`;
    const TWO = `20261106_000002_${P}_two`;
    const THREE = `20261106_000003_${P}_three`;
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let migrationsDir: string;

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-history-checks-"));
      // Nextly's own tables first, then two app files a "newer build" applies.
      await migrate();
      writeFile(
        ONE,
        [`CREATE TABLE ${P}_one (id integer)`],
        [`DROP TABLE ${P}_one`]
      );
      writeFile(
        TWO,
        [`CREATE TABLE ${P}_two (id integer)`],
        [`DROP TABLE ${P}_two`]
      );
      expect((await migrate()).applied).toBe(2);
    }, 180_000);

    afterEach(async () => {
      await adapter.disconnect();
      rmSync(migrationsDir, { recursive: true, force: true });
      await world.dispose();
    }, 60_000);

    const repo = () =>
      new SchemaEventsRepository(adapter.getDrizzle(), dialect);
    const path = (name: string) => join(migrationsDir, `${name}.sql`);

    /** `nextly migrate`'s core, as the command runs it, with the consent it was given. */
    function migrate(consent?: DataLossConsent) {
      return migrateCore({
        ...(consent === undefined ? {} : { consent }),
        extensionSchema: undefined,
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir,
        logger,
        lockMode: "wait",
        lockWaitMs: 30_000,
        ensureLedger: () => ensureSchemaEventsTable(adapter),
      });
    }

    /** `migrate:down --step 1`, wired as the command wires it. */
    async function migrateDown() {
      return migrateDownCore({
        ...(await downDatabaseDeps({ adapter, dialect })),
        nodeEnv: "test",
        logger,
        options: { step: 1, allowDataLoss: true, yes: true },
        fileExists: () => Promise.resolve(true),
        readDownSql: filename => {
          const content = readFileSync(join(migrationsDir, filename), "utf8");
          return Promise.resolve({
            sql: parseSqlSections(content).downSql,
            transaction: !marksNoTransaction(content),
          });
        },
        checkAppHistory: ({ recordChecksums }) =>
          assertAppHistoryHolds({
            adapter: adapter as never,
            db: adapter.getDrizzle(),
            dialect,
            migrationsDir,
            logger,
            command: "nextly migrate:down",
            recordChecksums,
          }),
        removedFiles: async () =>
          new Set(
            (await repo().listFileRemovals()).flatMap(row =>
              row.filename === null ? [] : [row.filename]
            )
          ),
        withLock: withMigrateLock,
      });
    }

    /** `nextly upgrade --reconcile-core`, wired as the command wires it. */
    function reconcileCore() {
      return runReconcileCore({
        adapter: adapter as never,
        confirmDestructive: () => Promise.resolve(true),
        checkAppHistory: () =>
          assertAppHistoryHolds({
            adapter: adapter as never,
            db: adapter.getDrizzle(),
            dialect,
            migrationsDir,
            logger,
            command: "nextly upgrade --reconcile-core",
          }),
      });
    }

    /** `migrate:baseline`'s core. */
    function baseline() {
      return baselineCore({
        adapter: adapter as never,
        db: adapter.getDrizzle(),
        dialect,
        migrationsDir,
        logger,
      });
    }

    /** `nextly migrate:resolve`, reading the folder as the command does. */
    function resolveFile(mode: ResolveMode, name: string, fileMissing = false) {
      return resolveMigration({
        mode,
        filename: `${name}.sql`,
        fileMissing,
        dialect,
        repo: repo(),
        skipVerify: true,
        fileExists: () => Promise.resolve(existsSync(path(name))),
        loadTargetSnapshot: () => Promise.resolve(null),
        marksNoTransaction: () =>
          Promise.resolve(marksNoTransaction(readFileSync(path(name), "utf8"))),
        fileChecksum: () =>
          Promise.resolve(checksumOf(readFileSync(path(name), "utf8"))),
        introspectLive: () => Promise.resolve({ tables: [] }),
      });
    }

    /** A migration file in the shape `migrate:create` writes, maybe marked to run outside a transaction. */
    function writeFile(
      name: string,
      up: string[],
      down: string[],
      marked = false
    ): void {
      const statements = (list: string[]) => list.map(s => `${s};`).join("\n");
      writeFileSync(
        path(name),
        `${marked ? "-- nextly:no-transaction\n" : ""}-- Migration: ${name}\n\n-- UP\n${statements(up)}\n\n-- DOWN\n${statements(down)}\n`,
        "utf8"
      );
    }

    /** Every table with its row count, and every ledger row: what a refused run leaves as it was. */
    async function databaseState() {
      const tables: Record<string, number> = {};
      for (const name of (await adapter.listTables()).sort()) {
        if (LOCK_TABLES.has(name)) continue;
        const rows = await adapter.executeQuery<{ n: unknown }>(
          `SELECT COUNT(*) AS n FROM ${name}`
        );
        tables[name] = Number(rows[0]?.n ?? 0);
      }
      const ledger = [
        ...(await repo().listFileApplies()),
        ...(await repo().listFileRemovals()),
      ]
        .map(row => [row.id, row.eventType, row.status, row.sha256, row.note])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      return { tables, ledger };
    }

    /** The refusal a command ended with, and its exit code. */
    async function refusal(work: Promise<unknown>) {
      const error = await work.then(
        () => undefined,
        (thrown: unknown) => thrown
      );
      expect(NextlyError.is(error), String(error)).toBe(true);
      return {
        code: (error as NextlyError).code,
        exit: migrateExitCode(error),
        context: (error as NextlyError).logContext,
      };
    }

    /** Each history-changing command, refused the same way, with nothing changed. */
    async function eachCommandRefuses(expected: {
      code: string;
      exit: number;
      context?: Record<string, unknown>;
    }) {
      const before = await databaseState();
      for (const command of [migrate, migrateDown, baseline, reconcileCore]) {
        expect(await refusal(command())).toMatchObject(expected);
        expect(await databaseState()).toEqual(before);
      }
    }

    /** A newer build's migration that fails part-way, leaving an unresolved attempt. */
    async function failPartWay(): Promise<void> {
      // MySQL commits a schema statement in a transaction too; elsewhere the
      // file is marked to run outside one, so its first statement stays.
      writeFile(
        THREE,
        [
          `CREATE TABLE ${P}_three (id integer)`,
          `INSERT INTO ${P}_missing (id) VALUES (1)`,
        ],
        [`DROP TABLE ${P}_three`],
        dialect !== "mysql"
      );
      // Its INSERT reaches a table the database lacks, whose code cannot be
      // read, so the run takes the consent without targets.
      const failed = await migrate(
        resolveDataLossConsent({ flag: true, env: {} })
      ).then(
        () => undefined,
        (thrown: unknown) => thrown
      );
      expect(failed).toBeInstanceOf(Error);
      const rows = await repo().findFileApplies(`${THREE}.sql`);
      expect(
        migrationStanding(rows).unresolvedAttempt,
        String(failed)
      ).toBeDefined();
    }

    it("stops an older build that lacks an applied migration, exit 3, naming it, in every command", async () => {
      // The older build's folder: the newer build's second file is not in it.
      rmSync(path(TWO));
      await eachCommandRefuses({
        code: "MIGRATION_MISSING",
        exit: 3,
        context: { files: [`${TWO}.sql`] },
      });
    }, 240_000);

    it("stops every command over an applied file whose down section was edited, exit 2", async () => {
      writeFile(
        TWO,
        [`CREATE TABLE ${P}_two (id integer)`],
        [`DROP TABLE ${P}_one`]
      );
      await eachCommandRefuses({ code: "MIGRATION_TAMPERED", exit: 2 });
    }, 240_000);

    it("stops every command over an unresolved attempt", async () => {
      await failPartWay();
      await eachCommandRefuses({
        code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
        exit: 1,
      });
    }, 240_000);

    it("stops a build that lacks a migration a newer build tried, exit 3, until it is recorded rolled back with its file missing", async () => {
      await failPartWay();
      rmSync(path(THREE));
      await eachCommandRefuses({
        code: "MIGRATION_MISSING",
        exit: 3,
        context: { unresolved: [`${THREE}.sql`] },
      });

      // The operator reverses what of it ran and says the file is gone.
      await adapter.executeQuery(`DROP TABLE ${P}_three`);
      await expect(resolveFile("rolled-back", THREE)).rejects.toMatchObject({
        code: "NEXTLY_MIGRATION_FILE_MISSING",
      });
      await resolveFile("rolled-back", THREE, true);
      expect((await migrate()).applied).toBe(0);
    }, 240_000);

    it("goes on past a removal recorded on purpose, keeps the migration applied, and still stops for any other", async () => {
      rmSync(path(TWO));
      expect(await resolveFile("removed", TWO)).toMatchObject({
        kind: "removed",
      });
      expect((await migrate()).applied).toBe(0);
      expect(
        migrationStanding(await repo().findFileApplies(`${TWO}.sql`)).state
      ).toBe("applied");

      // A rollback reaching it while its file is absent is refused by name.
      const settled = await databaseState();
      await expect(migrateDown()).rejects.toMatchObject({
        publicMessage: expect.stringContaining(`${TWO}.sql`),
      });
      expect(await databaseState()).toEqual(settled);

      // Another applied migration the folder lacks still stops the run, alone.
      const other = `20261106_000009_${P}_other.sql`;
      await repo().insertEvent({
        eventType: "file_apply",
        status: "applied",
        source: "cli-migrate",
        filename: other,
        sha256: "b".repeat(64),
      });
      expect(await refusal(migrate())).toMatchObject({
        code: "MIGRATION_MISSING",
        exit: 3,
        context: { files: [other] },
      });
    }, 240_000);

    it("refuses a baseline dry run on the history, and a refused baseline records no checksum", async () => {
      rmSync(path(TWO));
      const before = await databaseState();
      const dry = await refusal(
        baselineCore({
          adapter: adapter as never,
          db: adapter.getDrizzle(),
          dialect,
          migrationsDir,
          logger,
          dryRun: true,
        })
      );
      expect(dry).toMatchObject({ code: "MIGRATION_MISSING", exit: 3 });
      expect(await databaseState()).toEqual(before);

      // An applied row an earlier version wrote without a checksum: the
      // refused baseline leaves it as it was.
      writeFile(
        TWO,
        [`CREATE TABLE ${P}_two (id integer)`],
        [`DROP TABLE ${P}_two`]
      );
      const one = (await repo().findFileApplies(`${ONE}.sql`)).find(
        row => row.status === "applied"
      );
      await adapter.executeQuery(
        `UPDATE nextly_schema_events SET sha256 = NULL WHERE id = '${String(one?.id)}'`
      );
      const unrecorded = await databaseState();
      expect(await baseline()).toMatchObject({ kind: "history-not-empty" });
      expect(await databaseState()).toEqual(unrecorded);
    }, 240_000);

    it("never runs a removed migration again when its file returns, and checks it against its recorded checksum", async () => {
      const text = readFileSync(path(TWO), "utf8");
      rmSync(path(TWO));
      await resolveFile("removed", TWO);

      // The file back as it was: nothing of it runs, and nothing changes.
      writeFileSync(path(TWO), text, "utf8");
      const before = await databaseState();
      expect((await migrate()).applied).toBe(0);
      expect(await databaseState()).toEqual(before);

      // Edited, it stops the run as any applied file edited since it ran.
      writeFile(
        TWO,
        [`CREATE TABLE ${P}_two (id integer, x integer)`],
        [`DROP TABLE ${P}_two`]
      );
      expect(await refusal(migrate())).toMatchObject({
        code: "MIGRATION_TAMPERED",
        exit: 2,
      });
      expect(await databaseState()).toEqual(before);
    }, 240_000);
  }
);
