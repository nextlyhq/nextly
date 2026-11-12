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
import { resolveDataLossConsent } from "../../../domains/schema/migrate/data-loss-consent";
import {
  migrationChecksum,
  type MigrationContent,
  type PluginMigration,
} from "../../../domains/schema/migrate/plugin/plugin-migration";
import { SchemaOwnersRepository } from "../../../domains/schema/ownership/schema-owners-repository";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { installRegistryResolver } from "../../utils/registry-resolver";
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
  /** How many times a run cleared the migrate lock with `forceUnlock`. */
  unlocks: 0,
  /** Whether another process holds the migrate lock for the whole wait. */
  lockHeld: false,
  /** Whether the app's Builder manifest cannot be read. */
  manifestBroken: false,
}));

// A registry write's transaction, and the schema version stored in it, are
// the integration suite's subject (`schema-version-writers.integration.test.ts`):
// here a registry write runs on the adapter itself, as it did before it had one.
vi.mock("../../../domains/schema/schema-version", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../domains/schema/schema-version")
  >()),
  writeRegistryRows: (adapter: unknown, work: (tx: unknown) => unknown) =>
    work(adapter),
  writeRegistryRowsWith: (_adapter: unknown, work: () => unknown) => work(),
}));

// The permissions, roles and grants a recorded plugin state brings are the integration suite's
// subject (`plugin-lifecycle-writes-its-access.integration.test.ts`); they reach every permission
// and role service, so here they write nothing and the rollback paths are judged alone.
vi.mock("../../../domains/schema/migrate/command-access", () => ({
  seedAccessOnCommandConnection: async () => {},
  orphanOwnedPermissionsOnCommandConnection: async () => {},
}));

// SQLite has no migrate lock of its own to hold from outside, so a held lock
// is produced at the lock's own boundary: while `lockHeld` is set, the lock
// reports what it reports when another process kept it for the whole wait —
// it did not run the work — after warning as it does. Otherwise the real
// lock runs the work.
// `program` imports every command, `migrate` with its whole graph among them;
// the command under test takes only its context factory from it, and is
// handed its context here.
vi.mock("../../program", () => ({
  createContext: () => ({
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
  }),
}));

vi.mock("../../../domains/schema/pipeline/locks", async importOriginal => {
  const real =
    await importOriginal<
      typeof import("../../../domains/schema/pipeline/locks")
    >();
  return {
    ...real,
    forceUnlock: ((db, dialect) => {
      state.unlocks += 1;
      return real.forceUnlock(db, dialect);
    }) as typeof real.forceUnlock,
    withMigrateLock: ((db, dialect, fn, opts) => {
      if (!state.lockHeld) return real.withMigrateLock(db, dialect, fn, opts);
      opts?.logger?.warn?.(
        "[Nextly] migrate lock still held after waiting; migrations SKIPPED."
      );
      return Promise.resolve({ ran: false, reason: "lock-held" });
    }) as typeof real.withMigrateLock,
  };
});

// The app's manifest is read for the junction tables it declares. A broken one
// throws there, as a malformed `ui-schema.json` does.
vi.mock(
  "../../../domains/schema/migrate/resolved-schema",
  async importOriginal => {
    const real =
      await importOriginal<
        typeof import("../../../domains/schema/migrate/resolved-schema")
      >();
    return {
      ...real,
      declaredNamesOf: ((...args: Parameters<typeof real.declaredNamesOf>) =>
        state.manifestBroken
          ? Promise.reject(new Error("ui-schema.json is malformed"))
          : real.declaredNamesOf(...args)) as typeof real.declaredNamesOf,
    };
  }
);

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

vi.mock("../../utils/adapter", () => {
  const mocked = {
    validateDatabaseEnv: () => ({
      valid: true,
      dialect: "sqlite",
      databaseUrl: ":memory:",
    }),
    // The real adapter, with `disconnect` held back so each test can read the
    // database after the command has finished with it, and `transaction`
    // counted so a test can see the work went through the adapter's own
    // single-connection transaction. The schema lock's own bookkeeping is not
    // counted: every one of its transactions starts by locking a lock table's
    // row (or seeding the field-group one), which no transaction of the work does.
    createCliAdapter: async () =>
      Object.assign(Object.create(state.adapter) as object, {
        disconnect: async () => {},
        transaction: (
          work: (ctx: Record<string, unknown>) => Promise<unknown>,
          ...rest: never[]
        ) =>
          state.adapter.transaction(
            ((ctx: Record<string, unknown>) => {
              let first = true;
              const watched = new Proxy(ctx, {
                get(target, prop) {
                  const value = Reflect.get(target, prop);
                  if (typeof value !== "function") return value;
                  return (...callArgs: unknown[]) => {
                    if (first) {
                      first = false;
                      const lockBookkeeping =
                        (prop === "lockRow" || prop === "insert") &&
                        LOCK_TABLES.has(String(callArgs[0]));
                      if (!lockBookkeeping) state.transactions += 1;
                    }
                    return (value as (...a: unknown[]) => unknown).apply(
                      target,
                      callArgs
                    );
                  };
                },
              });
              return work(watched);
            }) as never,
            ...rest
          ),
      }),
  };
  // Commands open the database through this, for a real run and a dry run
  // alike; the database here is always there.
  return { ...mocked, openCommandAdapter: () => mocked.createCliAdapter() };
});

/** The tables the schema lock and the earlier field-group lock it holds keep their rows in. */
const LOCK_TABLES = new Set(["nextly_schema_lock", "nextly_field_group_lock"]);

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

/** The distinct states of the plugin's owner rows. */
async function ownerStates(): Promise<string[]> {
  const rows = await new SchemaOwnersRepository(state.db, "sqlite").read();
  return [
    ...new Set(
      rows.filter(row => row.ownerId === PLUGIN).map(row => row.state)
    ),
  ];
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
  // The static resolver every production adapter carries: the schema lock seeds
  // its row through a transaction insert, which an adapter refuses for a table
  // its resolver does not hold.
  installRegistryResolver(adapter);
  state.adapter = adapter as unknown as typeof state.adapter;
  state.db = adapter.getDrizzle();
  state.sqlite = adapter.getDrizzle<{ $client: Database.Database }>().$client;
  state.transactions = 0;
  state.unlocks = 0;
  state.lockHeld = false;
  await reconcileCore({
    db: state.db,
    dialect: "sqlite",
    logger: { info: () => {}, warn: () => {} },
  });
  await applied();
});

const uninstall = () =>
  runPluginUninstall(
    PLUGIN,
    {
      keepData: false,
      yes: false,
      consent: resolveDataLossConsent({ flag: true, env: {} }),
    },
    context
  );

const rollBack = (step: number) =>
  runMigrateDown({ plugin: PLUGIN, step, allowDataLoss: true }, context);

describe("plugins uninstall against a real database", () => {
  it("undoes the modules in reverse apply order, whatever order config lists them in", async () => {
    // Listed out of order: 0002's DOWN reads the table 0001's DOWN drops, so
    // undoing them in the reverse of the ARRAY runs 0001 first and fails.
    state.migrations = [more, init];

    await uninstall();

    // Undone in the wrong order, 0002's DOWN fails on the table 0001's DOWN
    // already dropped, so both tables gone is the order holding.
    expect(tables()).not.toContain("fx__notes");
    expect(tables()).not.toContain("fx__tags");
    // A full uninstall forgets the plugin's migrations, so a later install
    // applies them again from the first.
    expect(await ledger()).toEqual([]);
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
      "DROP INDEX fx__missing_idx",
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

  it("refuses while an applied module is no longer shipped, before anything runs", async () => {
    // 0002 is applied, and the configured version ships only 0001. Undoing
    // 0001 and recording the plugin uninstalled would leave 0002's table,
    // column and applied ledger row behind.
    state.migrations = [init];

    await expect(uninstall()).rejects.toMatchObject({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      logContext: { reason: "module-not-shipped", modules: ["0002_more"] },
    });
    expect(tables()).toEqual(expect.arrayContaining(["fx__notes", "fx__tags"]));
    expect(await ownerStates()).toEqual(["active"]);
  });

  it("completes after migrate:down --plugin rolled every module back", async () => {
    // The owner rows outlive the tables as ownership history. Read as tables
    // still to drop, with no applied module to drop them, they refused the
    // uninstall as a development push's.
    state.migrations = [init, more];
    await rollBack(2);
    expect(tables()).not.toContain("fx__notes");

    await uninstall();

    // A full uninstall forgets its owner records with its tables, and the
    // migration rows of the modules migrate:down already undid.
    expect(await ownerStates()).toEqual([]);
    expect(await ledger()).toEqual([]);
  });

  it("rolls a plugin back while the app's manifest cannot be read", async () => {
    // A plugin's DOWNs come from its definition and never from the app's
    // folder, so the app's manifest has nothing to say about them.
    state.migrations = [init, more];
    state.manifestBroken = true;
    try {
      await rollBack(2);
    } finally {
      state.manifestBroken = false;
    }
    expect(tables()).not.toContain("fx__notes");
  });

  it("names only the elements on its own tables as dropped with them", async () => {
    // fx also owns an index on the app's table. The app's own index there is
    // not dropped by anything, so the confirmation must not list it.
    const element = {
      tableName: "app_notes",
      elementKind: "index" as const,
      ownerVersion: null,
      schemaVersion: null,
      state: "active" as const,
    };
    await new SchemaOwnersRepository(state.db, "sqlite").upsert([
      {
        ...element,
        elementName: "fx_idx",
        ownerKind: "plugin",
        ownerId: PLUGIN,
        migratedBy: `plugin:${PLUGIN}`,
      },
      {
        ...element,
        elementName: "app_idx",
        ownerKind: "app",
        ownerId: "app",
        migratedBy: "app",
      },
    ]);
    state.migrations = [init, more];
    const warn = vi.spyOn(context.logger, "warn");

    const refusal: unknown = await runPluginUninstall(
      PLUGIN,
      { keepData: false, yes: false },
      context
    ).catch((error: unknown) => error);
    expect(refusal).toMatchObject({ code: "PLUGIN_UNINSTALL_UNCONFIRMED" });

    // What the operator is shown: the warnings, and the refusal that lists
    // what would be deleted.
    const shown = [
      ...warn.mock.calls.map(call => String(call[0])),
      (refusal as { publicMessage: string }).publicMessage,
    ].join("\n");
    warn.mockRestore();
    expect(shown).toContain("table fx__notes");
    expect(shown).not.toContain("app_idx");
  });
});

describe("plugins uninstall refuses to drop what another owner built", () => {
  it("refuses while the app's index is on one of its tables, naming it, and drops nothing", async () => {
    await new SchemaOwnersRepository(state.db, "sqlite").upsert([
      {
        tableName: "fx__notes",
        elementKind: "index" as const,
        elementName: "app_idx_on_notes",
        ownerKind: "app",
        ownerId: "app",
        migratedBy: "app",
        ownerVersion: null,
        schemaVersion: null,
        state: "active" as const,
      },
    ]);
    state.migrations = [init, more];

    const refusal: unknown = await uninstall().catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "PLUGIN_UNINSTALL_WOULD_DROP_OTHERS",
    });
    const message = (refusal as { publicMessage: string }).publicMessage;
    expect(message).toContain("app_idx_on_notes");
    expect(message).toContain("the app");
    expect(message).toContain("--keep-data");
    // Refused before anything ran: both tables and the applied rows remain.
    expect(tables()).toContain("fx__notes");
    expect(tables()).toContain("fx__tags");
    expect(await ownerStates()).not.toEqual([]);
  });
});

describe("plugins uninstall reads the keys the database holds", () => {
  it("refuses while a key no configuration declares any more points into one of its tables", async () => {
    // The app's key into fx__notes, its declaration removed from code and
    // never migrated away.
    state.sqlite.exec(
      "CREATE TABLE app_links (note_id TEXT, CONSTRAINT fk_app_links_note FOREIGN KEY (note_id) REFERENCES fx__notes (id))"
    );
    state.migrations = [init, more];

    await expect(uninstall()).rejects.toMatchObject({
      code: "PLUGIN_UNINSTALL_WOULD_DROP_OTHERS",
      publicMessage: expect.stringContaining(
        '"fk_app_links_note" on app_links'
      ),
    });
    expect(tables()).toContain("fx__notes");
    expect(await ownerStates()).toEqual(["active"]);
  });
});

describe("a full uninstall forgets the plugin", () => {
  it("leaves another owner's rows that share its name", async () => {
    await new SchemaOwnersRepository(state.db, "sqlite").upsert([
      {
        tableName: "app_notes",
        elementKind: "index" as const,
        elementName: "app_idx_named_like_the_plugin",
        ownerKind: "app",
        ownerId: PLUGIN,
        migratedBy: "app",
        ownerVersion: null,
        schemaVersion: null,
        state: "active" as const,
      },
    ]);
    state.migrations = [init, more];

    await uninstall();

    const left = await new SchemaOwnersRepository(state.db, "sqlite").read([
      "app_notes",
    ]);
    expect(left.map(row => row.elementName)).toContain(
      "app_idx_named_like_the_plugin"
    );
  });

  it("deletes its settings, secrets included, and leaves another owner's", async () => {
    const insert = state.sqlite.prepare(
      `INSERT INTO "nextly_plugin_settings" ("owner", "key", "value", "is_secret", "updated_at") VALUES (?, ?, ?, ?, ?)`
    );
    insert.run(PLUGIN, "apiKey", '"secret"', 1, Date.now());
    insert.run(PLUGIN, "mode", '"fast"', 0, Date.now());
    insert.run("other-plugin", "mode", '"slow"', 0, Date.now());
    state.migrations = [init, more];

    await uninstall();

    const owners = state.sqlite
      .prepare(
        `SELECT "owner", "key" FROM "nextly_plugin_settings" ORDER BY "owner", "key"`
      )
      .all();
    expect(owners).toEqual([{ owner: "other-plugin", key: "mode" }]);
  });

  it("CONTROL: keeping the data keeps its settings", async () => {
    state.sqlite
      .prepare(
        `INSERT INTO "nextly_plugin_settings" ("owner", "key", "value", "is_secret", "updated_at") VALUES (?, ?, ?, ?, ?)`
      )
      .run(PLUGIN, "mode", '"fast"', 0, Date.now());
    state.migrations = [init, more];

    await runPluginUninstall(PLUGIN, { keepData: true, yes: false }, context);

    const count = state.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM "nextly_plugin_settings" WHERE "owner" = ?`
      )
      .get(PLUGIN) as { n: number };
    expect(count.n).toBe(1);
  });
});

describe("plugins uninstall names a column it added to another owner's table", () => {
  it("only while the column is still there", async () => {
    // fx records a column on the app's table, as a module that added one
    // would. Its ownership row outlives a rollback that removed the column.
    await new SchemaOwnersRepository(state.db, "sqlite").upsert([
      {
        tableName: "app_notes",
        elementKind: "column",
        elementName: "fx_flag",
        ownerKind: "plugin",
        ownerId: PLUGIN,
        migratedBy: `plugin:${PLUGIN}`,
        ownerVersion: null,
        schemaVersion: null,
        state: "active",
      },
    ]);
    state.migrations = [init, more];
    const refusal = async () => {
      const error: unknown = await runPluginUninstall(
        PLUGIN,
        { keepData: false, yes: false },
        context
      ).catch((caught: unknown) => caught);
      return (error as { publicMessage: string }).publicMessage;
    };

    expect(await refusal()).not.toContain("app_notes.fx_flag");

    state.sqlite.exec("ALTER TABLE app_notes ADD COLUMN fx_flag TEXT");
    expect(await refusal()).toContain("column app_notes.fx_flag");
  });
});

describe("plugins uninstall over a column it contributed that is already gone", () => {
  it("is not refused over an element on that table whose owner is not configured", async () => {
    // fx's column row on the app's table outlives the rollback that removed
    // the column. An index there whose owner is gone cannot be described,
    // and was counted as possibly using a column no DOWN left will drop.
    const element = {
      tableName: "app_notes",
      ownerVersion: null,
      schemaVersion: null,
      state: "active" as const,
    };
    await new SchemaOwnersRepository(state.db, "sqlite").upsert([
      {
        ...element,
        elementKind: "column",
        elementName: "fx_flag",
        ownerKind: "plugin",
        ownerId: PLUGIN,
        migratedBy: `plugin:${PLUGIN}`,
      },
      {
        ...element,
        elementKind: "index",
        elementName: "gone_idx",
        ownerKind: "plugin",
        ownerId: "@acme/gone",
        migratedBy: "plugin:@acme/gone",
      },
    ]);
    state.migrations = [init, more];

    await uninstall();

    expect(tables()).not.toContain("fx__notes");
    expect(tables()).not.toContain("fx__tags");
  });

  it("CONTROL: is refused over that element while the column is still there", async () => {
    await new SchemaOwnersRepository(state.db, "sqlite").upsert([
      {
        tableName: "app_notes",
        elementKind: "column",
        elementName: "fx_flag",
        ownerKind: "plugin",
        ownerId: PLUGIN,
        migratedBy: `plugin:${PLUGIN}`,
        ownerVersion: null,
        schemaVersion: null,
        state: "active",
      },
      {
        tableName: "app_notes",
        elementKind: "index",
        elementName: "gone_idx",
        ownerKind: "plugin",
        ownerId: "@acme/gone",
        migratedBy: "plugin:@acme/gone",
        ownerVersion: null,
        schemaVersion: null,
        state: "active",
      },
    ]);
    state.sqlite.exec("ALTER TABLE app_notes ADD COLUMN fx_flag TEXT");
    state.migrations = [init, more];

    await expect(uninstall()).rejects.toMatchObject({
      code: "PLUGIN_UNINSTALL_WOULD_DROP_OTHERS",
      publicMessage: expect.stringContaining("gone_idx"),
    });
    expect(tables()).toContain("fx__notes");
  });
});

describe("migrate:down --plugin against a real database", () => {
  it("clears no lock under --dry-run --force-unlock, and changes nothing", async () => {
    state.migrations = [init, more];
    const before = await ledger();

    await runMigrateDown(
      {
        plugin: PLUGIN,
        step: 1,
        allowDataLoss: true,
        dryRun: true,
        forceUnlock: true,
      },
      context
    );

    expect(state.unlocks).toBe(0);
    expect(await ledger()).toEqual(before);
    expect(tables()).toContain("fx__tags");

    // The same run without --dry-run does clear it.
    await runMigrateDown(
      { plugin: PLUGIN, step: 1, allowDataLoss: true, forceUnlock: true },
      context
    );
    expect(state.unlocks).toBe(1);
  });

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
      "DROP INDEX fx__missing_idx",
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
        "Another migration is holding the migrate lock, so nothing was run."
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
