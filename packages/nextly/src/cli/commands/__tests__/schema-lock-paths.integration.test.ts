/**
 * Every path that took a lock before the schema lock now holds the schema lock, and changes
 * nothing while another process holds it.
 *
 * Each case starts a second process holding the lock (`schema-lock-holder.ts`), runs the path's
 * own core — `nextly migrate`'s and the boot migrate step's, `migrate:down`'s, `migrate:baseline`'s,
 * `upgrade`'s, `migrate:field-groups --apply`'s, and the Single and field-group Schema Builder
 * saves — and asserts it was refused and that the database's tables and ledger are as they were.
 * Then, two `nextly migrate` runs started together: the second applies nothing the first did.
 *
 * Each dialect runs on a database of its own, because these run whole commands whose core
 * reconcile would otherwise meet whatever the suites before them left.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runFieldGroupMigration } from "../../../domains/field-groups/migration/run";
import { FieldGroupMetadataService } from "../../../domains/field-groups/services/field-group-metadata-service";
import { FieldGroupRegistryService } from "../../../domains/field-groups/services/field-group-registry-service";
import {
  LOCK_DIALECTS,
  lockWorld,
  startHolder,
  type Holder,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { ensureSchemaEventsTable } from "../../../domains/schema/events/schema-events-ddl";
import { SingleMetadataService } from "../../../domains/singles/services/single-metadata-service";
import { SingleRegistryService } from "../../../domains/singles/services/single-registry-service";
import { NextlyError } from "../../../errors/nextly-error";
import { runProdMigrationsIfEnabled } from "../../../init/prod-migrations";
import type { Logger } from "../../../shared/types";
import { createLogger } from "../../utils/logger";
import { baselineCore } from "../migrate-baseline";
import { downDatabaseDeps, migrateDownCore } from "../migrate-down";
import { migrateCore } from "../migrate";
import { withMigrateLock } from "../../../domains/schema/pipeline/locks";
import { runUpgrade } from "../upgrade";

const FILE = "20261027_000001_schema_lock_paths";
const TABLE = "slp_items";

const logger = createLogger({ quiet: true });
const serviceLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe.each(LOCK_DIALECTS)("a held schema lock on %s", dialect => {
  let world: LockWorld;
  let adapter: DrizzleAdapter;
  let migrationsDir: string;
  let holder: Holder | undefined;

  beforeEach(async () => {
    world = await lockWorld(dialect, { fresh: true });
    adapter = await world.connect();
    migrationsDir = mkdtempSync(join(tmpdir(), "nextly-schema-lock-paths-"));
    writeFileSync(
      join(migrationsDir, `${FILE}.sql`),
      `-- Migration: ${FILE}\n\n-- UP\nCREATE TABLE ${TABLE} (id varchar(36) PRIMARY KEY);\n\n-- DOWN\nDROP TABLE ${TABLE};\n`,
      "utf8"
    );
  }, 60_000);

  afterEach(async () => {
    if (holder !== undefined) {
      holder.kill("SIGKILL");
      await holder.exited;
      holder = undefined;
    }
    await adapter.disconnect();
    rmSync(migrationsDir, { recursive: true, force: true });
    await world.dispose();
  }, 60_000);

  /** `nextly migrate`'s core, against this database, waiting at most `waitMs` for the lock. */
  function migrate(waitMs = 1_000) {
    return migrateCore({
      extensionSchema: undefined,
      dialect,
      db: adapter.getDrizzle(),
      adapter: adapter as never,
      migrationsDir,
      logger,
      lockMode: "wait",
      lockWaitMs: waitMs,
      ensureLedger: () => ensureSchemaEventsTable(adapter),
    });
  }

  /** What a refused path must leave alone: every table, and every ledger row. */
  async function databaseState(): Promise<{
    tables: string[];
    ledger: number;
  }> {
    const tables = (await adapter.listTables())
      .filter(name => name !== "nextly_schema_lock")
      .sort();
    const ledger = tables.includes("nextly_schema_events")
      ? Number(
          (
            (await adapter.executeQuery(
              "SELECT COUNT(*) AS n FROM nextly_schema_events"
            )) as Array<{ n: unknown }>
          )[0]?.n ?? 0
        )
      : 0;
    return { tables, ledger };
  }

  async function holdTheLock(): Promise<void> {
    holder = startHolder(world, {
      command: "nextly db:sync",
      leaseSeconds: 30,
      prefix: "slp_holder",
    });
    await holder.printed("held");
  }

  /** Runs `path` under a held lock, and asserts it was refused and changed nothing. */
  async function refusedWhileHeld(
    path: () => Promise<unknown>,
    code: string
  ): Promise<void> {
    await holdTheLock();
    // The holder's own first table is part of the state from here on.
    const before = await databaseState();
    const error = await path().then(
      () => undefined,
      (e: unknown) => e
    );
    expect(NextlyError.is(error) ? error.code : error).toBe(code);
    expect(await databaseState()).toEqual(before);
  }

  it("refuses nextly migrate, changing nothing", async () => {
    await refusedWhileHeld(() => migrate(), "NEXTLY_MIGRATE_LOCK_BUSY");
  }, 90_000);

  it("refuses to start a production boot with migrations on, changing nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await refusedWhileHeld(
        () =>
          runProdMigrationsIfEnabled({
            config: {
              db: {
                runMigrationsOnBoot: true,
                migrationsDir,
                uiSchemaFile: join(migrationsDir, "ui-schema.json"),
              },
              collections: [],
            },
            lockWaitMs: 1_000,
            adapter: Object.assign(adapter, { dialect }) as never,
            logger: serviceLogger,
          }),
        "NEXTLY_BOOT_MIGRATIONS_NOT_RUN"
      );
    } finally {
      vi.unstubAllEnvs();
    }
  }, 90_000);

  it("refuses migrate:down, leaving the migration applied", async () => {
    await migrate();
    await refusedWhileHeld(
      async () =>
        migrateDownCore({
          ...(await downDatabaseDeps({ adapter, dialect })),
          nodeEnv: "test",
          logger,
          options: { step: 1, allowDataLoss: true, yes: true },
          fileExists: () => Promise.resolve(true),
          readDownSql: () =>
            Promise.resolve({ sql: `DROP TABLE ${TABLE};`, transaction: true }),
          withLock: (lockAdapter, d, fn, opts) =>
            withMigrateLock(lockAdapter, d, fn, { ...opts, waitMs: 1_000 }),
        }),
      "NEXTLY_MIGRATE_LOCK_BUSY"
    );
  }, 90_000);

  it("plans migrate:down again once it holds the lock, acting on the database as it stands then", async () => {
    await migrate();
    await holdTheLock();
    const rollback = (async () =>
      migrateDownCore({
        ...(await downDatabaseDeps({ adapter, dialect })),
        nodeEnv: "test",
        logger,
        options: { step: 1, allowDataLoss: true, yes: true },
        fileExists: () => Promise.resolve(true),
        readDownSql: () =>
          Promise.resolve({ sql: `DROP TABLE ${TABLE};`, transaction: true }),
        withLock: (lockAdapter, d, fn, opts) =>
          withMigrateLock(lockAdapter, d, fn, {
            ...opts,
            waitMs: 20_000,
            pollMs: 200,
          }),
      }))();
    await new Promise(resolve => setTimeout(resolve, 1_500));
    // While it waits, another run rolls the same migration back.
    await adapter.executeQuery(`DROP TABLE ${TABLE}`);
    await adapter.executeQuery(
      "UPDATE nextly_schema_events SET status = 'rolled_back' WHERE filename LIKE '%schema_lock_paths%'"
    );
    holder?.send("release");

    // Nothing left to undo: the plan made before the wait would have dropped a table that is gone.
    await expect(rollback).resolves.toEqual({ rolledBack: [] });
  }, 90_000);

  it("refuses migrate:baseline, writing no file", async () => {
    const baselineDir = mkdtempSync(
      join(tmpdir(), "nextly-schema-lock-baseline-")
    );
    try {
      await refusedWhileHeld(
        () =>
          baselineCore({
            adapter: adapter as never,
            db: adapter.getDrizzle(),
            dialect,
            migrationsDir: baselineDir,
            logger,
            lockWaitMs: 1_000,
          }),
        "NEXTLY_MIGRATE_LOCK_BUSY"
      );
    } finally {
      rmSync(baselineDir, { recursive: true, force: true });
    }
  }, 90_000);

  it("refuses upgrade, running no step", async () => {
    let stepRan = false;
    await refusedWhileHeld(
      () =>
        runUpgrade(
          { confirmBackedUp: true },
          {
            adapter: adapter as never,
            lockWaitMs: 1_000,
            steps: [
              {
                title: "a step with work",
                pending: async () => 1,
                run: async () => {
                  stepRan = true;
                  return 1;
                },
              },
            ],
          }
        ),
      "NEXTLY_MIGRATE_LOCK_BUSY"
    );
    expect(stepRan).toBe(false);
  }, 90_000);

  it("refuses migrate:field-groups --apply, changing nothing", async () => {
    await refusedWhileHeld(
      () =>
        runFieldGroupMigration({
          adapter,
          logger: serviceLogger,
          direction: "up",
          backupConfirmed: true,
          lockWaitMs: 1_000,
        }),
      "NEXTLY_MIGRATE_LOCK_BUSY"
    );
  }, 90_000);

  it("refuses a Single Schema Builder save at once, telling the editor to save again", async () => {
    await migrate();
    const service = new SingleMetadataService(
      new SingleRegistryService(adapter, serviceLogger),
      serviceLogger,
      adapter
    );
    await refusedWhileHeld(
      () =>
        service.createSingle({
          slug: "slp-settings",
          label: "Settings",
          fields: [],
        } as never),
      "SERVICE_UNAVAILABLE"
    );
    const error = await service
      .createSingle({
        slug: "slp-settings",
        label: "Settings",
        fields: [],
      } as never)
      .catch((e: unknown) => e);
    expect((error as NextlyError).publicMessage).toBe(
      "A migration is running on this database, so this change was not saved. " +
        "Save it again once the migration ends."
    );
  }, 90_000);

  it("refuses a field-group Schema Builder save at once", async () => {
    await migrate();
    const service = new FieldGroupMetadataService(
      new FieldGroupRegistryService(adapter, serviceLogger),
      serviceLogger,
      adapter
    );
    await refusedWhileHeld(
      () =>
        service.createFieldGroup({
          slug: "slp-hero",
          label: "Hero",
          fields: [],
        } as never),
      "SERVICE_UNAVAILABLE"
    );
  }, 90_000);

  it("lets two nextly migrate runs started together apply each file once", async () => {
    const [first, second] = await Promise.all([
      migrate(20_000),
      migrate(20_000),
    ]);

    // One applied the file; the other found it applied and applied nothing.
    expect([first.applied, second.applied].sort()).toEqual([0, 1]);
    const rows = (await adapter.executeQuery(
      `SELECT status FROM nextly_schema_events WHERE filename LIKE '%schema_lock_paths%' AND event_type = 'file_apply'`
    )) as Array<{ status: string }>;
    expect(rows.map(row => row.status)).toEqual(["applied"]);
    expect(await adapter.listTables()).toContain(TABLE);
  }, 120_000);
});
