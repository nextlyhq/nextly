/**
 * `nextly db:sync` creates a plugin's tables and the columns plugins
 * contribute to entity tables, and keeps a contributed column's data on the
 * next sync.
 *
 * The push pipeline plans from the extension schema the process holds. Boot
 * and a config reload compile and publish it; the CLI process published
 * nothing, so its push created no plugin table and no contributed column,
 * and on a database that already had the column it planned to drop it.
 *
 * Drives the command itself, `runDbSync`, against a real SQLite file, and
 * one re-sync of its watcher (`createDebouncedSync`), so a sync that stops
 * publishing the extension schema fails here. Only the config file is not
 * read from disk: the loader is handed the config each test builds.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { getDialectTables } from "../../../database/index";
import { createAdapter } from "../../../database/factory";
import { SchemaRegistry } from "../../../database/schema-registry";
import { clearActiveExtensionSchema } from "../../../domains/schema/extension/active-schema";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { NO_PLUGIN_CONSENT } from "../../../plugins/plugin-consent";
import { definePlugin } from "../../../plugins/plugin-context";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createCliAdapter } from "../../utils/adapter";
import type { LoadConfigResult } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runDbSync } from "../db-sync";
import type { ResolvedDevOptions } from "../db-sync";
import { createDebouncedSync } from "../dev-watcher";
import { installRegistryResolver } from "../migrate";

/** The config the command loads, set by each test before it runs. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

let dir: string;
let adapter: Awaited<ReturnType<typeof createAdapter>> | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-dbsync-extension-"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${join(dir, "test.db")}`;
  // The command's adapter reads the environment once per process; each test
  // has a database file of its own.
  _resetEnvCache();
});

afterEach(async () => {
  await adapter?.disconnect();
  adapter = undefined;
  // Process-wide, like the dialect: integration files share one fork.
  clearActiveExtensionSchema();
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A config with one collection, and a plugin that declares a table and adds
 * a column to that collection's table. A slug per test: the process keeps
 * what it has pushed, and a second test reusing a slug would find it known.
 */
function configFor(slug: string, prefix: string, extraTable?: string) {
  const plugin = definePlugin({
    name: `@test/${prefix}`,
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      schema: {
        prefix,
        tables: [
          defineTable(
            "notes",
            { id: col.id(), label: col.shortText(), ...col.timestamps() },
            { indexes: [{ columns: ["label"] }] }
          ),
          ...(extraTable === undefined
            ? []
            : [defineTable(extraTable, { id: col.id() })]),
        ],
        extend: [
          ({ schema }) => {
            schema.extendTable(`dc_${slug}`, {
              columns: { indexedAt: col.shortText({ nullable: true }) },
            });
          },
        ],
      },
    },
  });
  return defineConfig({
    collections: [
      defineCollection({ slug, fields: [text({ name: "title" })] }),
    ],
    plugins: [plugin],
  });
}

/** The command's options and context, as `nextly db:sync` builds them. */
function command(): { options: ResolvedDevOptions; context: CommandContext } {
  const logger = createLogger({ quiet: true });
  return {
    options: { cwd: dir, autoSync: true } as ResolvedDevOptions,
    context: { logger, options: {}, cwd: dir } as CommandContext,
  };
}

/** `nextly db:sync`, once, with `config` as the loaded config. */
async function runSync(config: LoadConfigResult["config"]): Promise<void> {
  loaded.config = config;
  const { options, context } = command();
  await runDbSync(options, context);
}

/**
 * One re-sync of the `--watch` loop for `config`, on a connection of its
 * own. The watcher reports nothing when it finishes, so this waits for the
 * re-sync's last step, permission seeding, to report, then for the claim the
 * re-sync holds to be released; it fails on anything logged as an error.
 */
async function watchedResync(
  config: LoadConfigResult["config"]
): Promise<void> {
  const errors: string[] = [];
  let finished!: () => void;
  const done = new Promise<void>(resolve => {
    finished = resolve;
  });
  const { options, context } = command();
  const logger = {
    ...context.logger,
    error: (message: string) => {
      errors.push(message);
      finished();
    },
    success: (message: string) => {
      if (message.startsWith("Permissions:")) finished();
    },
  };
  // Resolving system tables by name, as `runDbSync` sets up the connection
  // it hands the watcher.
  const cli = await createCliAdapter();
  installRegistryResolver(cli as unknown as DrizzleAdapter);
  try {
    const result: LoadConfigResult = {
      config,
      dependencies: [],
      pluginConsent: NO_PLUGIN_CONSENT,
    };
    createDebouncedSync(cli, options, { ...context, logger })(result);
    await done;
    // The claim is released after the seeding returns.
    await new Promise(resolve => setTimeout(resolve, 500));
  } finally {
    await cli.disconnect();
  }
  expect(errors).toEqual([]);
}

/** A connection of the test's own, to read what the command left. */
async function open(): Promise<void> {
  adapter = await createAdapter({
    type: "sqlite",
    url: `file:${join(dir, "test.db")}`,
  } as Parameters<typeof createAdapter>[0]);
  const registry = new SchemaRegistry("sqlite");
  registry.registerStaticSchemas(getDialectTables("sqlite"));
  (adapter as unknown as DrizzleAdapter).setTableResolver(registry);
}

async function columns(table: string): Promise<string[]> {
  const rows = (await adapter?.executeQuery(
    `PRAGMA table_info("${table}")`
  )) as Array<{ name: string }>;
  return rows.map(row => row.name);
}

async function indexes(table: string): Promise<string[]> {
  const rows = (await adapter?.executeQuery(
    `PRAGMA index_list("${table}")`
  )) as Array<{ name: string }>;
  return rows.map(row => row.name);
}

describe("db:sync and the extension schema (integration)", () => {
  it("creates a plugin's table, its index and a contributed column", async () => {
    await open();
    await runSync(configFor("dbsync_ext_posts", "dsx"));

    expect(await columns("dsx__notes")).toEqual(
      expect.arrayContaining(["id", "label"])
    );
    expect(
      (await indexes("dsx__notes")).some(index => index.includes("label"))
    ).toBe(true);
    expect(await columns("dc_dbsync_ext_posts")).toContain("indexed_at");
  });

  it("keeps a contributed column and its data on the next sync", async () => {
    const config = configFor("dbsync_ext_kept", "dsk");
    await open();
    await runSync(config);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_ext_kept" ("id", "title", "slug", "indexed_at", "created_at", "updated_at") VALUES ('p1', 'T', 't', 'kept', 0, 0)`
    );

    await runSync(config);

    const rows = (await adapter?.executeQuery(
      `SELECT "indexed_at" AS v FROM "dc_dbsync_ext_kept" WHERE "id" = 'p1'`
    )) as Array<{ v: string | null }>;
    expect(rows[0]?.v).toBe("kept");
  });

  it("creates a table the plugin declares after the watcher started", async () => {
    await runSync(configFor("dbsync_ext_watch", "dsw"));

    // The config as saved while `db:sync --watch` runs: a second table.
    await watchedResync(configFor("dbsync_ext_watch", "dsw", "tags"));

    await open();
    expect(await columns("dsw__tags")).toEqual(["id"]);
    expect(await columns("dc_dbsync_ext_watch")).toContain("indexed_at");
  });
});
