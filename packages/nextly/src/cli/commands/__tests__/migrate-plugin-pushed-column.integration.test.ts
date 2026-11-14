/**
 * A plugin's column on a collection's table that development push already
 * made, migrated through the app's own stream, on every configured dialect.
 *
 * The column is made by the real push: booting with the plugin's schema hook
 * creates the collection's table with it through `applyDesiredSchema`. Then
 * `nextly migrate:create` writes the app's migration from the same
 * configuration and `nextly migrate` applies it, as a project moving from
 * development to migrations does. A column that matches the migration is
 * adopted without running its statements, keeping its values; one that does
 * not is refused as drift, and nothing is recorded.
 *
 * The app's stream, not the plugin's: `migrate:create --plugin` compiles a
 * plugin with its declared dependencies alone, never the app's entity tables,
 * so no plugin module carries a column on one. The app's migrations carry
 * every contribution to its collections, Singles and field groups, whoever
 * made it, and a push records such a column as the app's stream's.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { col, type ColumnBuilder } from "../../../domains/schema/extension/dsl";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  definePlugin,
  type PluginDefinition,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

/** The config the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const PLUGIN = "@test/pushcol-search";
/** The collection's slug; its table is named for this file alone. */
const SLUG = "pushcol_posts";
const TABLE = `dc_${SLUG}`;
const COLUMN = "search_vector";

const posts = defineCollection({
  slug: SLUG,
  fields: [text({ name: "title" })],
});

/** A plugin whose schema hook adds `searchVector` to the collection's table. */
function contributor(column: () => ColumnBuilder): PluginDefinition {
  return definePlugin({
    name: PLUGIN,
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      schema: {
        extend: [
          ({ schema }) => {
            schema.extendTable(TABLE, {
              columns: { searchVector: column() },
            });
          },
        ],
      },
    },
  });
}

/** The app's configuration, the plugin declaring its column as text. */
const appConfig = defineConfig({
  collections: [posts],
  plugins: [contributor(() => col.text({ nullable: true }))],
  db: { migrationsDir: "./migrations" },
});

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-pushcol-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  // The migration file is named by the clock.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 14, 12, 0, 0, 0)));
});

afterEach(async () => {
  vi.useRealTimers();
  await instance?.destroy();
  instance = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Boots with the collection and the plugin's hook, so the push creates the
 * table and the column, where the commands reach it through `DATABASE_URL`.
 * SQLite runs on a file in the test's directory, since an in-memory database
 * is unreachable from the commands' connection.
 */
async function bootPushing(
  dialect: TestDialect,
  column: () => ColumnBuilder
): Promise<TestNextly> {
  const declared = { collections: [posts], plugins: [contributor(column)] };
  if (dialect !== "sqlite") {
    return createTestNextly({ dialect, ...declared });
  }
  const url = `file:${join(dir, "test.db")}`;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = url;
  _resetEnvCache();
  const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
    typeof createAdapter
  >[0]);
  return createTestNextly({ adapter, ...declared });
}

/** A command's context, with everything it says captured. */
function command(): { context: CommandContext; said: string[] } {
  const said: string[] = [];
  const base = createLogger({ quiet: true });
  const capture = (message: string) => {
    said.push(message);
  };
  return {
    context: {
      logger: {
        ...base,
        info: capture,
        warn: capture,
        success: capture,
        error: capture,
      },
      options: {},
      cwd: dir,
    } as CommandContext,
    said,
  };
}

/** `nextly migrate:create --name=<name> --non-interactive` over the app's config: the file it wrote. */
async function migrateCreate(name: string): Promise<string> {
  loaded.config = appConfig;
  const { context, said } = command();
  const printed = vi.spyOn(console, "error").mockImplementation(message => {
    said.push(String(message));
  });
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}\n${said.join("\n")}`);
  });
  setNonInteractive(true);
  try {
    await runMigrateCreate(name, { cwd: dir }, context);
  } finally {
    setNonInteractive(false);
    printed.mockRestore();
    exit.mockRestore();
  }
  const file = readdirSync(join(dir, "migrations")).find(f =>
    f.endsWith(`_${name}.sql`)
  );
  expect(file, `no migration named ${name}\n${said.join("\n")}`).toBeDefined();
  return file!;
}

/** `nextly migrate --non-interactive` over the app's config: what it threw, if anything. */
async function migrate(): Promise<unknown> {
  loaded.config = appConfig;
  const { context } = command();
  setNonInteractive(true);
  try {
    await runMigrate({ cwd: dir, throwOnFailure: true }, context);
    return undefined;
  } catch (error) {
    return error;
  } finally {
    setNonInteractive(false);
  }
}

/** One stored post, with a value in the pushed column. */
async function seedRow(value: string | number): Promise<string> {
  const created = await instance!.nextly.create({
    collection: SLUG,
    data: { title: "first" },
    overrideAccess: true,
  });
  const id = (created.item as { id: string }).id;
  await instance!.adapter.update(
    TABLE,
    { [COLUMN]: value },
    { and: [{ column: "id", op: "=", value: id }] }
  );
  return id;
}

/** The ledger row of `file`, as status and statement count. */
async function ledgerOf(dialect: TestDialect, file: string) {
  const rows = await new SchemaEventsRepository(
    instance!.adapter.getDrizzle(),
    dialect
  ).listFileApplies();
  return rows
    .filter(row => row.filename === file)
    .map(row => [row.status, row.statementsExecuted ?? 0]);
}

describeEachDialect(
  "a plugin's column dev push already made on a collection's table, through the app's migration",
  dialect => {
    it("adopts a matching pushed column without running the migration, keeping its values", async () => {
      instance = await bootPushing(dialect, () => col.text({ nullable: true }));
      const id = await seedRow("indexed");
      const file = await migrateCreate("create_posts");

      expect(await migrate()).toBeUndefined();

      expect(await ledgerOf(dialect, file)).toEqual([["applied", 0]]);
      const row = await instance.adapter.selectOne<Record<string, unknown>>(
        TABLE,
        { where: { and: [{ column: "id", op: "=", value: id }] } }
      );
      expect(row?.[COLUMN]).toBe("indexed");
    });

    it("refuses a pushed column whose type differs from the migration's as drift, recording nothing", async () => {
      // Pushed as an integer: the configuration declares text.
      instance = await bootPushing(dialect, () =>
        col.integer({ nullable: true })
      );
      const id = await seedRow(7);
      const file = await migrateCreate("create_posts");

      const refused = await migrate();

      // The app's first migration compares the whole table, so its drift
      // names the table the column is on.
      expect(refused).toMatchObject({ code: "NEXTLY_MIGRATION_DRIFT" });
      expect((refused as Error).message).toContain(TABLE);
      expect(
        (await ledgerOf(dialect, file)).filter(
          ([status]) => status === "applied"
        )
      ).toEqual([]);
      const row = await instance.adapter.selectOne<Record<string, unknown>>(
        TABLE,
        { where: { and: [{ column: "id", op: "=", value: id }] } }
      );
      expect(Number(row?.[COLUMN])).toBe(7);
    });
  }
);
