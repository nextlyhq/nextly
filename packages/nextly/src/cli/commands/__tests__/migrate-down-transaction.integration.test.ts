/**
 * A migration's ledger writes and the work they record, on the real SQLite
 * adapter over a real database: a DOWN's `rolled_back` row, the retiring of
 * the applied row it undoes and a plugin's schema version commit with the
 * DOWN's statements or not at all; a run whose ledger write loses to another
 * run's rolls its work back; and `migrate:down` runs on a database that has
 * no owner registry yet.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { reconcileCore } from "../../../domains/schema/migrate/core-reconcile";
import { reconcileFile } from "../../../domains/schema/migrate/drift-reconcile";
import { runMigrationStatements } from "../../../domains/schema/migrate/migration-transaction";
import { SchemaOwnersRepository } from "../../../domains/schema/ownership/schema-owners-repository";
import { withMigrateLock } from "../../../domains/schema/pipeline/locks";
import { createLogger } from "../../utils/logger";
import { downDatabaseDeps, migrateDownCore } from "../migrate-down";

let adapter: ReturnType<typeof createSqliteAdapter>;
let sqlite: Database.Database;
let repo: SchemaEventsRepository;

const APP_FILE = "0001_seed.sql";
const PLUGIN_ROW = "plugin:dnp/001_seed";
/** A DOWN that leaves one row per run, so a second run shows. */
const DOWN = `INSERT INTO "down_log" ("label") VALUES ('undone')`;

beforeEach(async () => {
  adapter = createSqliteAdapter({ memory: true });
  await adapter.connect();
  sqlite = adapter.getDrizzle<{ $client: Database.Database }>().$client;
  repo = new SchemaEventsRepository(adapter.getDrizzle(), "sqlite");
  sqlite.exec(`CREATE TABLE "down_log" ("label" TEXT NOT NULL)`);
});

afterEach(async () => {
  await adapter.disconnect();
});

/** The ledger and the owner registry, as `nextly migrate`'s Phase 1 makes them. */
async function withCoreTables(): Promise<void> {
  await reconcileCore({
    db: adapter.getDrizzle(),
    dialect: "sqlite",
    logger: { info: () => {}, warn: () => {} },
  });
}

/** The ledger alone: a database `nextly migrate` has not yet given a registry. */
function withLedgerOnly(): void {
  for (const statement of getSchemaEventsDdl("sqlite")) sqlite.exec(statement);
}

async function recordApplied(filename: string): Promise<void> {
  await repo.insertEvent({
    eventType: "file_apply",
    status: "applied",
    source: "cli-migrate",
    filename,
    endedAt: new Date(),
  });
}

/** `migrate:down --step 1`, with the command's own database deps. */
async function rollBack(options: {
  plugin?: string;
  dryRun?: boolean;
}): Promise<string[]> {
  const result = await migrateDownCore({
    ...(await downDatabaseDeps({
      adapter: adapter as unknown as DrizzleAdapter,
      dialect: "sqlite",
      plugin:
        options.plugin === undefined
          ? undefined
          : {
              name: options.plugin,
              migrations: [{ name: "001_seed", schemaVersion: 1 }],
            },
    })),
    nodeEnv: "test",
    logger: createLogger({ quiet: true }),
    options: {
      step: 1,
      allowDataLoss: false,
      yes: false,
      dryRun: options.dryRun ?? false,
      plugin: options.plugin,
    },
    fileExists: () => Promise.resolve(true),
    readDownSql: () => Promise.resolve({ sql: DOWN, transaction: true }),
    withLock: withMigrateLock,
  });
  return result.rolledBack;
}

const downRuns = () =>
  (
    sqlite.prepare(`SELECT count(*) AS n FROM "down_log"`).get() as {
      n: number;
    }
  ).n;

/** A file's `file_apply` statuses, oldest first. */
const statuses = (filename: string) =>
  (
    sqlite
      .prepare(
        "SELECT status FROM nextly_schema_events WHERE filename = ? AND event_type = 'file_apply' ORDER BY started_at"
      )
      .all(filename) as Array<{ status: string }>
  ).map(row => row.status);

describe("a DOWN run in a transaction", () => {
  it("rolls an app file's DOWN back with its rolled_back row when the applied row cannot be retired, so a retry runs it once", async () => {
    await withCoreTables();
    await recordApplied(APP_FILE);
    // Retiring the applied row fails, as a lost connection would fail it,
    // after the DOWN's statement and the rolled_back row were written.
    sqlite.exec(`CREATE TRIGGER retire_fails
      BEFORE UPDATE OF status ON nextly_schema_events
      WHEN NEW.status = 'superseded' AND NEW.filename = '${APP_FILE}'
      BEGIN SELECT RAISE(ABORT, 'ledger write failed'); END`);

    // The driver's wording differs by where the write failed; the database
    // and the ledger after it are what the test reads.
    await expect(rollBack({})).rejects.toThrow();
    expect(downRuns()).toBe(0);
    expect(statuses(APP_FILE)).toEqual(["applied"]);

    sqlite.exec("DROP TRIGGER retire_fails");
    expect(await rollBack({})).toEqual([APP_FILE]);
    expect(downRuns()).toBe(1);
    expect(statuses(APP_FILE)).toEqual(["superseded", "rolled_back"]);
  });

  it("rolls a plugin module's DOWN back with its schema version when the rolled_back row cannot be written, so a retry runs it once", async () => {
    await withCoreTables();
    await recordApplied(PLUGIN_ROW);
    const owners = new SchemaOwnersRepository(adapter.getDrizzle(), "sqlite");
    await owners.upsert([
      {
        tableName: "dnp__things",
        ownerKind: "plugin",
        ownerId: "dnp",
        migratedBy: "plugin:dnp",
        ownerVersion: "1.0.0",
        schemaVersion: 1,
        state: "active",
      },
    ]);
    const version = async () =>
      (await owners.read()).find(row => row.ownerId === "dnp")?.schemaVersion;
    sqlite.exec(`CREATE TRIGGER rollback_row_fails
      BEFORE INSERT ON nextly_schema_events
      WHEN NEW.status = 'rolled_back' AND NEW.filename = '${PLUGIN_ROW}'
      BEGIN SELECT RAISE(ABORT, 'ledger write failed'); END`);

    await expect(rollBack({ plugin: "dnp" })).rejects.toThrow();
    expect(downRuns()).toBe(0);
    expect(statuses(PLUGIN_ROW)).toEqual(["applied"]);
    expect(await version()).toBe(1);

    sqlite.exec("DROP TRIGGER rollback_row_fails");
    expect(await rollBack({ plugin: "dnp" })).toEqual([PLUGIN_ROW]);
    expect(downRuns()).toBe(1);
    expect(statuses(PLUGIN_ROW)).toEqual(["superseded", "rolled_back"]);
    expect(await version()).toBeNull();
  });

  it("rolls the DOWN back when another run rolled the migration back first, recording no failure", async () => {
    await withCoreTables();
    await recordApplied(APP_FILE);
    // The other run's rolled_back row, seen on the connection by the time
    // this run's DOWN has run; written by the DOWN itself, the only way one
    // connection can interleave two runs.
    const otherRun = `INSERT INTO nextly_schema_events (id, event_type, status, source, filename, started_at) VALUES ('other-run', 'file_apply', 'rolled_back', 'cli-migrate', '${APP_FILE}', 9999999999999)`;
    const lost = migrateDownCore({
      ...(await downDatabaseDeps({
        adapter: adapter as unknown as DrizzleAdapter,
        dialect: "sqlite",
      })),
      nodeEnv: "test",
      logger: createLogger({ quiet: true }),
      options: { step: 1 },
      fileExists: () => Promise.resolve(true),
      readDownSql: () =>
        Promise.resolve({ sql: `${DOWN};\n${otherRun}`, transaction: true }),
      withLock: withMigrateLock,
    });

    await expect(lost).rejects.toMatchObject({
      code: "NEXTLY_MIGRATION_CONCURRENT_RUN",
    });
    expect(downRuns()).toBe(0);
    expect(statuses(APP_FILE)).toEqual(["applied"]);
    expect((await repo.listFailedRollbacks()).length).toBe(0);
  });
});

describe("an UP whose applied row loses to another run's", () => {
  it("rolls the UP back, discards its attempt and leaves the other run's row as the record", async () => {
    await withCoreTables();
    sqlite.exec(`CREATE TABLE "up_log" ("label" TEXT NOT NULL)`);
    const filename = "0002_seed.sql";
    // Another run records the file applied once this run has started it:
    // its row is committed before this run's statements begin.
    sqlite.exec(`CREATE TRIGGER other_run_wins
      AFTER INSERT ON nextly_schema_events
      WHEN NEW.status = 'in_progress' AND NEW.filename = '${filename}'
      BEGIN
        INSERT INTO nextly_schema_events (id, event_type, status, source, filename, started_at)
        VALUES ('winner', 'file_apply', 'applied', 'cli-migrate', NEW.filename, NEW.started_at - 1);
      END`);
    const empty = { tables: [] };

    await expect(
      reconcileFile({
        file: {
          filename,
          sql: `INSERT INTO "up_log" ("label") VALUES ('seeded')`,
          path: `m/${filename}`,
        },
        before: empty,
        target: empty,
        live: empty,
        dialect: "sqlite",
        repo,
        executeSql: (sqlText, unit, after) =>
          runMigrationStatements(adapter, [sqlText], unit, after),
      })
    ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_CONCURRENT_RUN" });

    expect(
      (
        sqlite.prepare(`SELECT count(*) AS n FROM "up_log"`).get() as {
          n: number;
        }
      ).n
    ).toBe(0);
    expect(
      sqlite
        .prepare(
          "SELECT id, status FROM nextly_schema_events WHERE filename = ?"
        )
        .all(filename)
    ).toEqual([{ id: "winner", status: "applied" }]);
  });
});

describe("migrate:down on a database with no owner registry yet", () => {
  it("previews and rolls back an app file, the registry read as empty", async () => {
    withLedgerOnly();
    await recordApplied(APP_FILE);

    expect(await rollBack({ dryRun: true })).toEqual([]);
    expect(downRuns()).toBe(0);

    expect(await rollBack({})).toEqual([APP_FILE]);
    expect(downRuns()).toBe(1);
    expect(statuses(APP_FILE)).toEqual(["superseded", "rolled_back"]);
  });
});
