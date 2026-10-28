/**
 * `nextly plugins uninstall` over DOWNs that leave one of the plugin's tables
 * in place, on a real SQLite, through the command's entry point.
 *
 * What is under test is the ledger afterwards. Refused before any DOWN runs,
 * every module still reads as applied, so the plugin's schema is what the
 * ledger says. Caught only after the DOWNs ran, the plugin is not recorded
 * uninstalled, and the operator finishes it by dropping the table and running
 * the uninstall again.
 */
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { reconcileCore } from "../../../domains/schema/migrate/core-reconcile";
import { resolveDataLossConsent } from "../../../domains/schema/migrate/data-loss-consent";
import {
  migrationChecksum,
  type PluginMigration,
} from "../../../domains/schema/migrate/plugin/plugin-migration";
import { SchemaOwnersRepository } from "../../../domains/schema/ownership/schema-owners-repository";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runPluginUninstall } from "../plugin-lifecycle-runner";

const db = vi.hoisted(() => ({
  adapter: undefined as unknown as {
    transaction: (...args: never[]) => Promise<unknown>;
    disconnect: () => Promise<void>;
  },
  /** The adapter's Drizzle handle, which the repositories read through. */
  drizzle: undefined as unknown,
  migrations: [] as unknown[],
  /** Runs after each adapter transaction commits, when set. */
  afterTransaction: undefined as (() => void) | undefined,
}));

vi.mock("../../utils/config-loader", () => ({
  loadConfig: async () => ({
    config: {
      db: { migrationsDir: "./migrations" },
      plugins: [
        {
          name: "@acme/ul",
          version: "1.0.0",
          contributes: { schema: { migrations: db.migrations } },
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
  // The real adapter, kept connected after the command so the test can read
  // the database, with a hook after each committed transaction.
  createCliAdapter: async () =>
    Object.assign(Object.create(db.adapter) as object, {
      disconnect: async () => {},
      transaction: async (...args: never[]) => {
        const result = await db.adapter.transaction(...args);
        db.afterTransaction?.();
        return result;
      },
    }),
}));

/** The data-loss consent given without targets, as `--accept-data-loss` alone gives it. */
const EVERY_DELETION = resolveDataLossConsent({ flag: true, env: {} });

const PLUGIN = "@acme/ul";
const ledgerKey = (module: string) => `plugin:${PLUGIN}/${module}`;
const context = {
  logger: createLogger({ quiet: true }),
} as unknown as CommandContext;

let sqlite: Database.Database;

/** A sealed module whose SQLite UP and DOWN are the ones given. */
function sealedModule(
  name: string,
  schemaVersion: number,
  up: string[],
  down: string[]
): PluginMigration {
  const noTables = {
    postgresql: { tables: [] },
    mysql: { tables: [] },
    sqlite: { tables: [] },
  };
  const content = {
    name,
    schemaVersion,
    dialects: {
      postgresql: { up: [], down: [] },
      mysql: { up: [], down: [] },
      sqlite: { up, down },
    },
    snapshot: noTables,
    before: noTables,
  };
  return { ...content, checksum: migrationChecksum(content) };
}

const first = sealedModule(
  "0001_init",
  1,
  ["CREATE TABLE ul__notes (id TEXT)"],
  ["DROP TABLE ul__notes"]
);
const SECOND_UP = ["CREATE TABLE ul__tags (id TEXT)"];

/**
 * Applies `first` and a second module with `secondDown` as `nextly migrate`
 * would leave them: UPs run, applied ledger rows, owner rows for both tables.
 */
async function install(secondDown: string[]): Promise<void> {
  const second = sealedModule("0002_tags", 2, SECOND_UP, secondDown);
  db.migrations = [first, second];
  for (const statement of [...first.dialects.sqlite.up, ...SECOND_UP]) {
    sqlite.exec(statement);
  }
  const events = new SchemaEventsRepository(db.drizzle, "sqlite");
  for (const [at, module] of [first, second].entries()) {
    await events.insertEvent({
      eventType: "file_apply",
      status: "applied",
      source: "cli-migrate",
      filename: ledgerKey(module.name),
      sha256: module.checksum,
      startedAt: new Date(1000 + at),
    });
  }
  await new SchemaOwnersRepository(db.drizzle, "sqlite").upsert(
    ["ul__notes", "ul__tags"].map(tableName => ({
      tableName,
      elementKind: "table" as const,
      elementName: "",
      ownerKind: "plugin" as const,
      ownerId: PLUGIN,
      migratedBy: `plugin:${PLUGIN}`,
      ownerVersion: "1.0.0",
      schemaVersion: 2,
      state: "active" as const,
    }))
  );
}

const tableNames = () =>
  (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
  ).map(row => row.name);

/** Each module's newest ledger status, in apply order. */
async function moduleStatuses(): Promise<string[]> {
  const rows = await new SchemaEventsRepository(
    db.drizzle,
    "sqlite"
  ).listFileApplies();
  return [first.name, "0002_tags"].map(
    name =>
      rows
        .filter(row => row.filename === ledgerKey(name))
        .sort((a, b) => +b.startedAt - +a.startedAt)[0]?.status ?? "none"
  );
}

async function ownerStates(): Promise<string[]> {
  const rows = await new SchemaOwnersRepository(db.drizzle, "sqlite").read();
  return [...new Set(rows.map(row => row.state))];
}

const uninstall = () =>
  runPluginUninstall(
    PLUGIN,
    { keepData: false, yes: false, consent: EVERY_DELETION },
    context
  );

beforeEach(async () => {
  const adapter = createSqliteAdapter({ memory: true });
  await adapter.connect();
  db.adapter = adapter as unknown as typeof db.adapter;
  db.drizzle = adapter.getDrizzle();
  db.afterTransaction = undefined;
  sqlite = adapter.getDrizzle<{ $client: Database.Database }>().$client;
  await reconcileCore({
    db: adapter.getDrizzle(),
    dialect: "sqlite",
    logger: { info: () => {}, warn: () => {} },
  });
});

afterEach(async () => {
  await db.adapter.disconnect();
});

describe("plugins uninstall refuses DOWNs that would leave a table", () => {
  it.each([
    // A DOWN with no statements is a module with no DOWN, refused as
    // irreversible; this one runs, and drops nothing.
    ["empties it but drops none of it", ["DELETE FROM ul__tags"]],
    [
      "only rebuilds it",
      [
        'CREATE TABLE "__new_ul__tags" ("id" TEXT)',
        'INSERT INTO "__new_ul__tags" ("id") SELECT "id" FROM "ul__tags"',
        'DROP TABLE "ul__tags"',
        'ALTER TABLE "__new_ul__tags" RENAME TO "ul__tags"',
      ],
    ],
  ])(
    "before anything runs, when the DOWN %s, leaving every module applied",
    async (_case, secondDown) => {
      await install(secondDown);

      await expect(uninstall()).rejects.toMatchObject({
        code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
        logContext: { reason: "down-leaves-tables", tables: ["ul__tags"] },
      });

      // 0001's DOWN, the one that would have run, did not.
      expect(tableNames()).toEqual(
        expect.arrayContaining(["ul__notes", "ul__tags"])
      );
      expect(await moduleStatuses()).toEqual(["applied", "applied"]);
      expect(await ownerStates()).toEqual(["active"]);
    }
  );
});

describe("plugins uninstall with a table still there after its DOWNs ran", () => {
  it("is not recorded uninstalled, and finishes once the table is dropped and it runs again", async () => {
    await install(["DROP TABLE ul__tags"]);
    // Stands in for a DOWN whose effect its text does not show: once the
    // last DOWN commits, ul__tags is there again.
    db.afterTransaction = () => {
      if (tableNames().includes("ul__notes")) return;
      db.afterTransaction = undefined;
      sqlite.exec("CREATE TABLE ul__tags (id TEXT)");
    };

    await expect(uninstall()).rejects.toMatchObject({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      logContext: { reason: "tables-left-by-down", tables: ["ul__tags"] },
    });
    expect(await moduleStatuses()).toEqual(["rolled_back", "rolled_back"]);
    expect(await ownerStates()).toEqual(["active"]);

    sqlite.exec("DROP TABLE ul__tags");
    await uninstall();

    expect(await ownerStates()).toEqual(["uninstalled"]);
    expect(tableNames()).not.toContain("ul__notes");
    expect(tableNames()).not.toContain("ul__tags");
  });
});
