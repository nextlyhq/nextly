/**
 * A permitted transform of another plugin's collection leaves its table and
 * rows where they were.
 *
 * Drives `nextly db:sync` itself against a real SQLite file: once with the
 * owning plugin alone, then, with a row written, again with a plugin that
 * depends on the owner and transforms its collection. The second sync is
 * where a transformed definition meets a table that already holds data, so a
 * transform that rebuilt or replaced the owner's table, or lost its rows,
 * fails here. Only the config file is not read from disk: the loader is
 * handed the config each sync builds, folded by the loader's own fold.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, number, text } from "../../config";
import { createAdapter } from "../../database/factory";
import { clearActiveExtensionSchema } from "../../domains/schema/extension/active-schema";
import { _resetEnvCache } from "../../shared/lib/env";
import type { CommandContext } from "../../cli/program";
import { runDbSync, type ResolvedDevOptions } from "../../cli/commands/db-sync";
import { mergeSetupResultIntoConfig } from "../../cli/utils/config-loader";
import { createLogger } from "../../cli/utils/logger";
import { definePlugin } from "../plugin-context";

/** The config the command loads, set before each sync. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../cli/utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SLUG = "tx_own_orders";
const TABLE = `dc_${SLUG}`;

const shop = definePlugin({
  name: "@test/tx-own-shop",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    collections: [
      defineCollection({
        slug: SLUG,
        fields: [text({ name: "reference" }), number({ name: "total" })],
      }),
    ],
  },
});

/** Depends on the shop and adds a field and an admin group to its orders. */
const reviews = definePlugin({
  name: "@test/tx-own-reviews",
  version: "1.0.0",
  nextly: ">=0.0.0",
  dependsOn: { "@test/tx-own-shop": "*" },
  contributes: {
    transforms: [
      {
        target: SLUG,
        transform: entity => ({
          ...entity,
          fields: [...(entity.fields as unknown[]), number({ name: "rating" })],
          admin: { group: "Sales" },
        }),
      },
    ],
  },
});

let dir: string;
let adapter: Awaited<ReturnType<typeof createAdapter>> | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-transform-ownership-"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${join(dir, "test.db")}`;
  // The command's adapter reads the environment once per process.
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

/** `nextly db:sync`, once, with these plugins configured. */
async function sync(plugins: ReturnType<typeof definePlugin>[]) {
  const config = defineConfig({ collections: [], plugins });
  // The plugins' collections and transforms, merged as `loadConfig` merges
  // them: the loader is replaced, its fold is not.
  loaded.config = mergeSetupResultIntoConfig(config, config, plugins);
  const logger = createLogger({ quiet: true });
  await runDbSync(
    { cwd: dir, autoSync: true } as ResolvedDevOptions,
    { logger, options: {}, cwd: dir } as CommandContext
  );
}

/** A connection of the test's own, to write and read what the syncs leave. */
async function open(): Promise<void> {
  adapter = await createAdapter({
    type: "sqlite",
    url: `file:${join(dir, "test.db")}`,
  } as Parameters<typeof createAdapter>[0]);
}

async function query<T>(sql: string): Promise<T[]> {
  return (await adapter?.executeQuery(sql)) as T[];
}

describe("a permitted transform of another plugin's collection (SQLite)", () => {
  it("keeps the owner's table and its rows, and adds what the transform adds", async () => {
    await sync([shop]);
    await open();
    await query(
      `INSERT INTO "${TABLE}" ("id", "title", "slug", "reference", "total", "created_at", "updated_at") VALUES ('o1', 'First', 'first', 'A-1', 42, 0, 0)`
    );

    await sync([shop, reviews]);

    expect(
      await query(`SELECT "id", "reference", "total" FROM "${TABLE}"`)
    ).toEqual([{ id: "o1", reference: "A-1", total: 42 }]);
    const columns = (
      await query<{ name: string }>(`PRAGMA table_info("${TABLE}")`)
    ).map(column => column.name);
    // The transform reached the table: without this, an apply that never
    // saw the transformed definition would keep every row just as well.
    expect(columns).toEqual(
      expect.arrayContaining(["reference", "total", "rating"])
    );
  });
});
