/**
 * An upgrade that changes a plugin's schema prefix is refused before any of
 * its modules runs.
 *
 * Version 1 creates `pa__notes` and records it as the plugin's. Version 2
 * declares the prefix `pb`: compiled, its tables are `pb__notes`, and its new
 * module would create that table beside the old one, whose rows the plugin
 * then never reads again. `nextly migrate` and `nextly plugins install` both
 * reach the plugin phase, which now refuses, naming both prefixes, with the
 * database exactly as version 1 left it. The control upgrade keeps the prefix
 * and applies.
 */
import Database from "better-sqlite3";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildExtensionSchema } from "../../../domains/schema/extension/build-extension-schema";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { buildPluginMigration } from "../../../domains/schema/migrate-create/generate-plugin";
import { reconcileCore } from "../../../domains/schema/migrate/core-reconcile";
import type { PluginMigration } from "../../../domains/schema/migrate/plugin/plugin-migration";
import { CORE_TABLE_NAMES } from "../../../schemas/index";
import { createLogger } from "../../utils/logger";
import { previewMigrate, runPluginPhase } from "../migrate";

const DIALECT = "sqlite" as const;
const PLUGIN = "prefix-fixture";

const notes = defineTable("notes", { id: col.id(), label: col.shortText() });
const tags = defineTable("tags", { id: col.id(), name: col.shortText() });

/** The plugin's schema compiled under `prefix`, as a boot or command does. */
function compiled(prefix: string, tables: ReturnType<typeof defineTable>[]) {
  return buildExtensionSchema({
    dialect: DIALECT,
    coreTableNames: CORE_TABLE_NAMES,
    entities: [],
    pluginPrefixes: new Map([[PLUGIN, prefix]]),
    plugins: [{ owner: { kind: "plugin", id: PLUGIN }, tables }],
  });
}

/** The plugin's next module, generated from its schema under `prefix`. */
async function module(
  prefix: string,
  version: number,
  tables: ReturnType<typeof defineTable>[],
  existing: PluginMigration[]
): Promise<PluginMigration> {
  const built = buildPluginMigration({
    pluginName: PLUGIN,
    schemaVersion: version,
    name: `v${String(version)}`,
    now: new Date(Date.UTC(2026, 10, 13, 10, 0, 0, version)),
    tablesByDialect: {
      sqlite: (await compiled(prefix, tables)).specs,
    } as Parameters<typeof buildPluginMigration>[0]["tablesByDialect"],
    existing,
  });
  if (built === null) throw new Error("the module generated nothing");
  return built.module;
}

describe("a plugin upgrade that changes its schema prefix (sqlite)", () => {
  let sqlite: Database.Database;
  let db: unknown;

  /** What the plugin phase needs, over the live database. */
  function phase(
    prefix: string,
    tables: ReturnType<typeof defineTable>[],
    migrations: PluginMigration[]
  ) {
    return compiled(prefix, tables).then(extensionSchema => ({
      dialect: DIALECT,
      db,
      extensionSchema,
      adapter: {
        dialect: DIALECT,
        transactionOpenInFlow: () => false,
        getCapabilities: () => ({ dialect: DIALECT }),
        executeQuery: async (statement: string) => {
          sqlite.exec(statement);
          return [];
        },
        transaction: async <T>(
          work: (ctx: {
            execute: (statement: string) => Promise<unknown[]>;
            getDrizzle: () => unknown;
            queryStatement: (statement: SQL) => Promise<unknown[]>;
          }) => Promise<T>
        ): Promise<T> => {
          sqlite.exec("BEGIN IMMEDIATE");
          try {
            const result = await work({
              execute: async statement => {
                sqlite.exec(statement);
                return [];
              },
              getDrizzle: () => drizzle({ client: sqlite }),
              queryStatement: async statement =>
                drizzle({ client: sqlite }).all(statement),
            });
            sqlite.exec("COMMIT");
            return result;
          } catch (error) {
            sqlite.exec("ROLLBACK");
            throw error;
          }
        },
        listTables: async () => tableNames(),
      },
      logger: createLogger({ quiet: true }),
      pluginMigrationSets: [
        { pluginName: PLUGIN, pluginVersion: "1.0.0", migrations },
      ],
    }));
  }

  function tableNames(): string[] {
    return (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>
    ).map(row => row.name);
  }

  function ledger(): string[] {
    return (
      sqlite
        .prepare(
          "SELECT filename FROM nextly_schema_events WHERE event_type = 'file_apply' ORDER BY filename"
        )
        .all() as Array<{ filename: string }>
    ).map(row => row.filename);
  }

  let v1: PluginMigration;

  beforeAll(async () => {
    sqlite = new Database(":memory:");
    db = drizzle({ client: sqlite });
    await reconcileCore({
      db,
      dialect: DIALECT,
      logger: { info: () => {}, warn: () => {} },
    });
    // Version 1, installed: its table and its owner row.
    v1 = await module("pa", 1, [notes], []);
    await runPluginPhase((await phase("pa", [notes], [v1])) as never);
    sqlite.exec("INSERT INTO pa__notes (id, label) VALUES ('n1', 'kept')");
  });

  afterAll(() => sqlite.close());

  it("is refused before its new module runs, naming both prefixes", async () => {
    // Written as a fresh history: generated over version 1, the module is
    // refused already (`migrate:create --plugin` reads the move as dropping
    // `pa__notes`), so this is the module a hand-written or regenerated
    // history would ship.
    const v2 = await module("pb", 2, [notes, tags], []);
    await expect(
      runPluginPhase((await phase("pb", [notes, tags], [v1, v2])) as never)
    ).rejects.toThrow(
      /The plugin "prefix-fixture" now has the schema prefix "pb", but its tables were created under "pa" \(pa__notes\)/
    );
    // Nothing of version 2 reached the database.
    expect(tableNames().filter(name => name.startsWith("pb__"))).toEqual([]);
    expect(ledger()).toEqual([`plugin:${PLUGIN}/${v1.name}`]);
    expect(
      sqlite.prepare("SELECT label FROM pa__notes").all() as unknown[]
    ).toEqual([{ label: "kept" }]);
  });

  it("is refused by a dry run too, as the run it previews would be", async () => {
    const args = (prefix: string) =>
      phase(prefix, [notes, tags], [v1]).then(deps => ({
        adapter: deps.adapter,
        db,
        dialect: DIALECT,
        migrationsDir: "/nonexistent-migrations",
        plugins: [],
        logger: deps.logger,
        extensionSchema: deps.extensionSchema,
      }));
    await expect(previewMigrate((await args("pb")) as never)).rejects.toThrow(
      /now has the schema prefix "pb", but its tables were created under "pa"/
    );
    // CONTROL: under the recorded prefix, whatever else the preview finds,
    // it is not this refusal.
    const kept = await previewMigrate((await args("pa")) as never).then(
      () => "listed",
      (error: unknown) => String(error)
    );
    expect(kept).not.toMatch(/schema prefix/);
  });

  it("control: an upgrade keeping the prefix applies its module", async () => {
    const v2 = await module("pa", 2, [notes, tags], [v1]);
    await runPluginPhase((await phase("pa", [notes, tags], [v1, v2])) as never);
    expect(tableNames()).toContain("pa__tags");
    expect(ledger()).toEqual([
      `plugin:${PLUGIN}/${v1.name}`,
      `plugin:${PLUGIN}/${v2.name}`,
    ]);
  });
});
