/**
 * A plugin whose new release only adds a permission is written by `nextly migrate:create` as a
 * migration with no table statements, naming the plugin and the permission, beside a snapshot that
 * records it — on every configured dialect.
 *
 * The command is driven itself (`runMigrateCreate`) against a project directory of the test's own.
 * Only the config file is not read from disk: the loader is handed the config each step declares,
 * with the plugin at the release that step installs.
 *
 * What separates the correct command from the broken one is the second file existing: a
 * `migrate:create` that compares only tables and settings exits with "no changes" on the upgrade
 * and writes nothing, so the permission would never reach a deployed database through a migration.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { parseSqlSections } from "../../../domains/schema/migrate/sql-sections";
import { splitSqlStatements } from "../../../domains/schema/migrate/split-sql";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrateCreate } from "../migrate-create";

/** The config the command loads, set by each step before it runs it. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const PLUGIN = "@acme/forms";

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-plugin-permission-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  // Each migration file is named by the clock; two runs inside one millisecond would otherwise
  // write the same name.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 10, 12, 0, 0, 0)));
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
 * A booted instance the command reaches through `DATABASE_URL`, so it reads the dialect under
 * test. SQLite runs on a file in the test's directory, which the command's connection can reach.
 */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  if (dialect !== "sqlite") return createTestNextly({ dialect });
  const url = `file:${join(dir, "test.db")}`;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = url;
  _resetEnvCache();
  const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
    typeof createAdapter
  >[0]);
  return createTestNextly({ adapter });
}

/** `nextly migrate:create --name=<name> --non-interactive` over `config`, which must succeed. */
async function migrateCreate(config: unknown, name: string): Promise<void> {
  loaded.config = config;
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 10, 12, 0, 0, clock)));
  const said: string[] = [];
  const capture = (message: string) => {
    said.push(message);
  };
  const context = {
    logger: {
      ...createLogger({ quiet: true }),
      info: capture,
      warn: capture,
      success: capture,
      error: capture,
    },
    options: {},
    cwd: dir,
  } as CommandContext;
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  setNonInteractive(true);
  try {
    await runMigrateCreate(name, { cwd: dir }, context);
  } catch (error) {
    expect.fail(`${(error as Error).message}\n${said.join("\n")}`);
  } finally {
    setNonInteractive(false);
    exit.mockRestore();
  }
}

/** The project's config with the plugin at a release declaring `actions` on its submissions. */
const configWith = (actions: string[]) =>
  defineConfig({
    collections: [
      defineCollection({ slug: "pp_posts", fields: [text({ name: "title" })] }),
    ],
    plugins: [
      definePlugin({
        name: PLUGIN,
        version: "1.0.0",
        nextly: ">=0.0.1",
        contributes: {
          permissions: actions.map(action => ({
            action,
            resource: "submissions",
          })),
        },
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });

/** The migration whose name ends `_<name>.sql`, and its snapshot. */
async function migrationNamed(name: string) {
  const file = readdirSync(join(dir, "migrations")).find(f =>
    f.endsWith(`_${name}.sql`)
  );
  expect(file, `no migration named ${name}`).toBeDefined();
  const sql = await readFile(join(dir, "migrations", file!), "utf-8");
  const snapshot = JSON.parse(
    await readFile(
      join(
        dir,
        "migrations",
        "meta",
        file!.replace(/\.sql$/, ".snapshot.json")
      ),
      "utf-8"
    )
  );
  return { sql, snapshot };
}

describe.each(getConfiguredTestDialects())(
  "a plugin release that only adds a permission travels as a migration (%s)",
  dialect => {
    beforeEach(async () => {
      instance = await boot(dialect);
    });

    it("writes the file, naming the plugin and the permission, with no table statement", async () => {
      await migrateCreate(configWith(["export"]), "create_posts");

      await migrateCreate(configWith(["export", "archive"]), "upgrade_forms");

      const { sql, snapshot } = await migrationNamed("upgrade_forms");
      expect(sql).toContain(`-- Permissions: ${PLUGIN}: + archive-submissions`);
      expect(splitSqlStatements(parseSqlSections(sql).upSql, dialect)).toEqual(
        []
      );
      expect(Object.keys(snapshot.permissions.plugins[PLUGIN]).sort()).toEqual([
        "archive-submissions",
        "export-submissions",
      ]);
      // The collection's own permissions are recorded beside it, though the file names none.
      expect(snapshot.permissions.collections.pp_posts).toHaveProperty(
        "read-pp_posts"
      );
    });
  }
);
