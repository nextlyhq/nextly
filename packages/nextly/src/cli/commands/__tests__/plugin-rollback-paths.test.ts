/**
 * The two commands that undo a plugin's modules — `plugins uninstall` and
 * `migrate:down --plugin` — against a real SQLite, through their CLI entry
 * points.
 *
 * Only the config is faked. The adapter is the real SQLite adapter, and the
 * ledger, the owner registry, the drop guard, the checksum checks and the
 * executor are the production ones, because what is under test is what
 * reaches the database: which DOWNs run, in which order, what is refused
 * before anything runs, and which ledger key each outcome is recorded under.
 */
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { reconcileCore } from "../../../domains/schema/migrate/core-reconcile";
import {
  migrationChecksum,
  type MigrationContent,
  type PluginMigration,
} from "../../../domains/schema/migrate/plugin/plugin-migration";
import { SchemaOwnersRepository } from "../../../domains/schema/ownership/schema-owners-repository";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrateDown } from "../migrate-down";
import {
  runPluginInstall,
  runPluginUninstall,
} from "../plugin-lifecycle-runner";

const state = vi.hoisted(() => ({
  adapter: undefined as unknown as {
    transaction: (...args: never[]) => Promise<unknown>;
  },
  sqlite: undefined as unknown as import("better-sqlite3").Database,
  db: undefined as unknown,
  migrations: [] as unknown[],
  transactions: 0,
  /** Whether another process holds the migrate lock for the whole wait. */
  lockHeld: false,
}));

// SQLite has no migrate lock of its own to hold from outside, so a held lock
// is produced at the lock's own boundary: while `lockHeld` is set, the lock
// reports what it reports when another process kept it for the whole wait —
// it did not run the work — after warning as it does. Otherwise the real
// lock runs the work.
vi.mock("../../../domains/schema/pipeline/locks", async importOriginal => {
  const real =
    await importOriginal<
      typeof import("../../../domains/schema/pipeline/locks")
    >();
  return {
    ...real,
    withMigrateLock: ((db, dialect, fn, opts) => {
      if (!state.lockHeld) return real.withMigrateLock(db, dialect, fn, opts);
      opts?.logger?.warn?.(
        "[Nextly] migrate lock still held after waiting; migrations SKIPPED."
      );
      return Promise.resolve({ ran: false, reason: "lock-held" });
    }) as typeof real.withMigrateLock,
  };
});

vi.mock("../../utils/config-loader", () => ({
  loadConfig: async () => ({
    config: {
      db: { migrationsDir: "./migrations" },
      plugins: [
        {
          name: "@acme/fx",
          version: "1.0.0",
          contributes: { schema: { migrations: state.migrations } },
        },
      ],
    },
  }),
}));

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: "sqlite",
    databaseUrl: ":memory:",
  }),
  // The real adapter, with `disconnect` held back so each test can read the
  // database after the command has finished with it, and `transaction`
  // counted so a test can see the work went through the adapter's own
  // single-connection transaction.
  createCliAdapter: async () =>
    Object.assign(Object.create(state.adapter) as object, {
      disconnect: async () => {},
      transaction: (...args: never[]) => {
        state.transactions += 1;
        return state.adapter.transaction(...args);
      },
    }),
}));

const PLUGIN = "@acme/fx";
const key = (module: string) => `plugin:${PLUGIN}/${module}`;

const context = {
  logger: createLogger({ quiet: true }),
} as unknown as CommandContext;

function sealed(content: MigrationContent): PluginMigration {
  return { ...content, checksum: migrationChecksum(content) };
}

/** A module whose SQLite statements are the ones given; no snapshot sides. */
function mod(name: string, up: string[], down: string[]): PluginMigration {
  const none = {
    postgresql: { tables: [] },
    mysql: { tables: [] },
    sqlite: { tables: [] },
  };
  return sealed({
    name,
    schemaVersion: name === "0001_init" ? 1 : 2,
    dialects: {
      postgresql: { up: [], down: [] },
      mysql: { up: [], down: [] },
      sqlite: { up, down },
    },
    snapshot: none,
    before: none,
  });
}

const init = mod(
  "0001_init",
  ["CREATE TABLE fx__notes (id TEXT)"],
  ["DROP TABLE fx__notes"]
);
const more = mod(
  "0002_more",
  [
    "ALTER TABLE fx__notes ADD COLUMN extra TEXT",
    "CREATE TABLE fx__tags (id TEXT)",
  ],
  // Reads fx__notes, so it can only run before 0001's DOWN drops it.
  ["DROP TABLE fx__tags", "ALTER TABLE fx__notes DROP COLUMN extra"]
);

function tables(): string[] {
  return (
    state.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
  ).map(row => row.name);
}

async function ledger(): Promise<Array<{ filename: string; status: string }>> {
  const rows = await new SchemaEventsRepository(
    state.db,
    "sqlite"
  ).listFileApplies();
  return rows
    .filter(row => row.filename?.startsWith("plugin:"))
    .sort((a, b) => +a.startedAt - +b.startedAt)
    .map(row => ({ filename: row.filename ?? "", status: row.status }));
}

/** The ledger keys of the failed rollbacks on record, oldest first. */
async function failedRollbacks(): Promise<string[]> {
  const rows = await new SchemaEventsRepository(
    state.db,
    "sqlite"
  ).listFailedRollbacks();
  return rows
    .sort((a, b) => +a.startedAt - +b.startedAt)
    .map(row => row.filename ?? "");
}

/**
 * Applies both modules as `migrate` would leave them: their UP run, an
 * applied ledger row carrying each module's checksum, owner rows for the
 * plugin's tables — and an app-owned `app_notes` beside them.
 */
async function applied(): Promise<void> {
  for (const statement of [
    ...init.dialects.sqlite.up,
    ...more.dialects.sqlite.up,
  ]) {
    state.sqlite.exec(statement);
  }
  state.sqlite.exec("CREATE TABLE app_notes (id TEXT)");
  const events = new SchemaEventsRepository(state.db, "sqlite");
  for (const [at, module] of [init, more].entries()) {
    await events.insertEvent({
      eventType: "file_apply",
      status: "applied",
      source: "cli-migrate",
      filename: key(module.name),
      sha256: module.checksum,
      startedAt: new Date(1000 + at),
    });
  }
  const row = {
    elementKind: "table" as const,
    elementName: "",
    ownerKind: "plugin" as const,
    ownerId: PLUGIN,
    migratedBy: `plugin:${PLUGIN}`,
    ownerVersion: "1.0.0",
    schemaVersion: 2,
    state: "active" as const,
  };
  await new SchemaOwnersRepository(state.db, "sqlite").upsert([
    { ...row, tableName: "fx__notes" },
    { ...row, tableName: "fx__tags" },
    {
      tableName: "app_notes",
      elementKind: "table",
      elementName: "",
      ownerKind: "app",
      ownerId: "app",
      migratedBy: "app",
      ownerVersion: null,
      schemaVersion: null,
      state: "active",
    },
  ]);
}

beforeEach(async () => {
  const adapter = createSqliteAdapter({ memory: true });
  await adapter.connect();
  state.adapter = adapter as unknown as typeof state.adapter;
  state.db = adapter.getDrizzle();
  state.sqlite = adapter.getDrizzle<{ $client: Database.Database }>().$client;
  state.transactions = 0;
  state.lockHeld = false;
  await reconcileCore({
    db: state.db,
    dialect: "sqlite",
    logger: { info: () => {}, warn: () => {} },
  });
  await applied();
});

const uninstall = () =>
  runPluginUninstall(PLUGIN, { keepData: false, yes: true }, context);

const rollBack = (step: number) =>
  runMigrateDown({ plugin: PLUGIN, step, allowDataLoss: true }, context);

describe("plugins uninstall against a real database", () => {
  it("undoes the modules in reverse apply order, whatever order config lists them in", async () => {
    // Listed out of order: 0002's DOWN reads the table 0001's DOWN drops, so
    // undoing them in the reverse of the ARRAY runs 0001 first and fails.
    state.migrations = [more, init];

    await uninstall();

    expect(tables()).not.toContain("fx__notes");
    expect(tables()).not.toContain("fx__tags");
    // Each rollback lands on the module's own key, retiring its applied row.
    expect(await ledger()).toEqual([
      { filename: key("0001_init"), status: "superseded" },
      { filename: key("0002_more"), status: "superseded" },
      { filename: key("0002_more"), status: "rolled_back" },
      { filename: key("0001_init"), status: "rolled_back" },
    ]);
  });

  it("refuses an older module's foreign drop before the newer module's DOWN runs", async () => {
    const dropsAppTable = mod("0001_init", init.dialects.sqlite.up, [
      "DROP TABLE fx__notes",
      "DROP TABLE app_notes",
    ]);
    // Applied with this content, so only the drop guard can refuse it.
    state.sqlite.exec(
      `UPDATE nextly_schema_events SET sha256 = '${dropsAppTable.checksum}' WHERE filename = '${key("0001_init")}'`
    );
    state.migrations = [dropsAppTable, more];

    await expect(uninstall()).rejects.toMatchObject({
      code: "DROP_OF_FOREIGN_TABLE",
      logContext: { table: "app_notes", source: key("0001_init") },
    });
    // 0002 is the newest module and would have been undone first.
    expect(tables()).toEqual(
      expect.arrayContaining(["fx__notes", "fx__tags", "app_notes"])
    );
    expect((await ledger()).map(row => row.status)).toEqual([
      "applied",
      "applied",
    ]);
  });

  describe("a DOWN that rebuilds another owner's table", () => {
    /** 0001's DOWN, rebuilding `app_notes` to a twin with these columns. */
    const rebuildingDown = (twinColumns: string[]) => {
      const list = twinColumns.map(c => `"${c}"`).join(", ");
      const down = mod("0001_init", init.dialects.sqlite.up, [
        `CREATE TABLE "__new_app_notes" (${twinColumns.map(c => `"${c}" TEXT`).join(", ")})`,
        `INSERT INTO "__new_app_notes" (${list}) SELECT ${list} FROM "app_notes"`,
        'DROP TABLE "app_notes"',
        'ALTER TABLE "__new_app_notes" RENAME TO "app_notes"',
        "DROP TABLE fx__notes",
      ]);
      state.sqlite.exec(
        `UPDATE nextly_schema_events SET sha256 = '${down.checksum}' WHERE filename = '${key("0001_init")}'`
      );
      return down;
    };

    it("is judged against the table's live columns and runs when the twin keeps them all", async () => {
      state.sqlite.exec("INSERT INTO app_notes (id) VALUES ('kept')");
      state.migrations = [rebuildingDown(["id"]), more];

      await uninstall();

      expect(state.sqlite.prepare("SELECT id FROM app_notes").all()).toEqual([
        { id: "kept" },
      ]);
    });

    it("is refused when the twin leaves out a live column", async () => {
      state.sqlite.exec("ALTER TABLE app_notes ADD COLUMN secret TEXT");
      state.migrations = [rebuildingDown(["id"]), more];

      await expect(uninstall()).rejects.toMatchObject({
        code: "DROP_OF_FOREIGN_TABLE",
        logContext: { table: "app_notes", source: key("0001_init") },
      });
      // Refused before anything ran.
      expect(tables()).toEqual(
        expect.arrayContaining(["fx__notes", "fx__tags", "app_notes"])
      );
    });
  });

  it("refuses an older module whose DOWN was edited after sealing, before anything runs", async () => {
    const edited: PluginMigration = {
      ...init,
      dialects: {
        ...init.dialects,
        sqlite: { up: init.dialects.sqlite.up, down: ["DROP TABLE app_notes"] },
      },
    };
    state.migrations = [edited, more];

    await expect(uninstall()).rejects.toMatchObject({
      code: "MIGRATION_CHECKSUM_MISMATCH",
      logContext: { migration: "0001_init" },
    });
    expect(tables()).toEqual(
      expect.arrayContaining(["fx__notes", "fx__tags", "app_notes"])
    );
  });

  it("refuses a module resealed after it was applied, before anything runs", async () => {
    // Internally consistent, so only the ledger's checksum can tell.
    const resealed = mod("0001_init", init.dialects.sqlite.up, [
      "DROP TABLE IF EXISTS fx__notes",
    ]);
    state.migrations = [resealed, more];

    await expect(uninstall()).rejects.toMatchObject({
      code: "MIGRATION_CHECKSUM_MISMATCH",
      logContext: { migration: "0001_init", applied: init.checksum },
    });
    expect(tables()).toContain("fx__tags");
  });

  it("records a failed DOWN under the module's own ledger key, undoing its earlier statements", async () => {
    const failing = mod("0002_more", more.dialects.sqlite.up, [
      "DROP TABLE fx__tags",
      "DROP TABLE fx__missing",
    ]);
    state.sqlite.exec(
      `UPDATE nextly_schema_events SET sha256 = '${failing.checksum}' WHERE filename = '${key("0002_more")}'`
    );
    state.migrations = [init, failing];

    await expect(uninstall()).rejects.toThrow(/fx__missing/);
    // One transaction: the drop that ran before the failure is rolled back.
    expect(tables()).toContain("fx__tags");
    expect(state.transactions).toBe(1);
    // Both modules are still applied; the failure is on record beside them.
    expect(await ledger()).toEqual([
      { filename: key("0001_init"), status: "applied" },
      { filename: key("0002_more"), status: "applied" },
    ]);
    expect(await failedRollbacks()).toEqual([key("0002_more")]);

    // A retry meets the same module first, rather than reading it as pending
    // and undoing the module before it underneath it.
    await expect(uninstall()).rejects.toThrow(/fx__missing/);
    expect(tables()).toEqual(expect.arrayContaining(["fx__notes", "fx__tags"]));
  });
});

describe("migrate:down --plugin against a real database", () => {
  it("rolls the newest module back under its own ledger key", async () => {
    state.migrations = [init, more];

    await rollBack(1);

    expect(tables()).not.toContain("fx__tags");
    expect(await ledger()).toEqual([
      { filename: key("0001_init"), status: "applied" },
      { filename: key("0002_more"), status: "superseded" },
      { filename: key("0002_more"), status: "rolled_back" },
    ]);
  });

  it("refuses a module whose DOWN was edited after sealing, before anything runs", async () => {
    const edited: PluginMigration = {
      ...more,
      dialects: {
        ...more.dialects,
        sqlite: { up: more.dialects.sqlite.up, down: ["DROP TABLE app_notes"] },
      },
    };
    state.migrations = [init, edited];

    await expect(rollBack(1)).rejects.toMatchObject({
      code: "MIGRATION_CHECKSUM_MISMATCH",
      logContext: { migration: "0002_more" },
    });
    expect(tables()).toEqual(
      expect.arrayContaining(["fx__notes", "fx__tags", "app_notes"])
    );
  });

  it("records a failed DOWN under the module's own ledger key", async () => {
    const failing = mod("0002_more", more.dialects.sqlite.up, [
      "DROP TABLE fx__missing",
    ]);
    state.sqlite.exec(
      `UPDATE nextly_schema_events SET sha256 = '${failing.checksum}' WHERE filename = '${key("0002_more")}'`
    );
    state.migrations = [init, failing];

    await expect(rollBack(1)).rejects.toThrow(/fx__missing/);
    expect(await ledger()).toEqual([
      { filename: key("0001_init"), status: "applied" },
      { filename: key("0002_more"), status: "applied" },
    ]);
    expect(await failedRollbacks()).toEqual([key("0002_more")]);

    // Still the newest applied module: a second rollback targets it again,
    // not the module before it.
    await expect(rollBack(1)).rejects.toThrow(/fx__missing/);
    expect(tables()).toContain("fx__notes");
  });
});

describe("the lifecycle commands while another process holds the migrate lock", () => {
  /** A third module, not yet applied, for install to apply. */
  const extra = mod(
    "0003_extra",
    ["CREATE TABLE fx__extra (id TEXT)"],
    ["DROP TABLE fx__extra"]
  );

  it("install refuses, applying nothing", async () => {
    state.migrations = [init, more, extra];
    state.lockHeld = true;

    await expect(runPluginInstall(PLUGIN, {}, context)).rejects.toMatchObject({
      code: "CONFLICT",
      publicMessage: expect.stringContaining(
        `Another migration is holding the migrate lock, so ${PLUGIN}'s migrations were not applied.`
      ),
    });
    expect(tables()).not.toContain("fx__extra");
    expect((await ledger()).map(row => row.filename)).not.toContain(
      key("0003_extra")
    );
  });

  it("install applies the pending module once the lock is free", async () => {
    // The control: the same install, with nothing holding the lock.
    state.migrations = [init, more, extra];

    await runPluginInstall(PLUGIN, {}, context);

    expect(tables()).toContain("fx__extra");
  });

  it("uninstall refuses, running no DOWN", async () => {
    state.migrations = [init, more];
    state.lockHeld = true;

    await expect(uninstall()).rejects.toMatchObject({
      code: "CONFLICT",
      publicMessage: expect.stringContaining(
        "Another migration is holding the migrate lock, so nothing was run."
      ),
    });
    expect(tables()).toEqual(expect.arrayContaining(["fx__notes", "fx__tags"]));
    expect((await ledger()).map(row => row.status)).toEqual([
      "applied",
      "applied",
    ]);
    expect(state.transactions).toBe(0);
  });
});
