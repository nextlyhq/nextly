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
 * Drives the command's own sequence against a real SQLite file, as the
 * localized-companion test beside it does.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { getDialectTables } from "../../../database/index";
import { createAdapter } from "../../../database/factory";
import { SchemaRegistry } from "../../../database/schema-registry";
import { clearActiveExtensionSchema } from "../../../domains/schema/extension/active-schema";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { definePlugin } from "../../../plugins/plugin-context";
import type { CommandContext } from "../../program";
import type { CLIDatabaseAdapter } from "../../utils/adapter";
import type { LoadConfigResult } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import type { ResolvedDevOptions } from "../db-sync";
import {
  publishExtensionSchema,
  syncCollections,
  syncComponents,
  syncSingles,
} from "../dev-build";
import { ensureCoreTables } from "../dev-server";

let dir: string;
let adapter: Awaited<ReturnType<typeof createAdapter>> | undefined;
let previousDialect: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-dbsync-extension-"));
  previousDialect = process.env.DB_DIALECT;
});

afterEach(async () => {
  await adapter?.disconnect();
  adapter = undefined;
  // Process-wide, like the dialect: integration files share one fork.
  clearActiveExtensionSchema();
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A config with one collection, and a plugin that declares a table and adds
 * a column to that collection's table. A slug per test: the process keeps
 * what it has pushed, and a second test reusing a slug would find it known.
 */
function configFor(slug: string, prefix: string) {
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

/** Opened once per test; a second sync reuses it, as a second run would. */
async function open(): Promise<void> {
  process.env.DB_DIALECT = "sqlite";
  adapter = await createAdapter({
    type: "sqlite",
    url: `file:${join(dir, "test.db")}`,
  } as Parameters<typeof createAdapter>[0]);
  const registry = new SchemaRegistry("sqlite");
  registry.registerStaticSchemas(getDialectTables("sqlite"));
  (adapter as unknown as DrizzleAdapter).setTableResolver(registry);
}

/** The command's sequence for the schema, minus the parts that read disk. */
async function runSync(config: LoadConfigResult["config"]): Promise<void> {
  const logger = createLogger({ quiet: true });
  const options = {
    cwd: dir,
    autoSync: true,
    acceptDataLoss: false,
  } as ResolvedDevOptions;
  const context = { logger, options: {}, cwd: dir } as CommandContext;
  const cli = adapter as unknown as CLIDatabaseAdapter;
  await ensureCoreTables(cli, options, context);
  const configResult = { config } as LoadConfigResult;
  await publishExtensionSchema(configResult, cli, context);
  await syncCollections(configResult, cli, options, context);
  await syncSingles(configResult, cli, options, context);
  await syncComponents(configResult, cli, options, context);
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
});
