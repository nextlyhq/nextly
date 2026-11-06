/**
 * `nextly migrate` and `nextly migrate:status` name where the registry and the
 * tables disagree, on every configured dialect.
 *
 * A booted instance writes a registry row and a table for each entity. Then,
 * behind the registry's back, one table is dropped, one registered field's
 * column is dropped (a table that lacks a column its row records, the shape a
 * plugin's new column left in production), and one collection's and one
 * single's registry rows are deleted. Both commands are driven themselves,
 * `runMigrateStatus` and `runMigrate`, against that database, and each must
 * name all four, and nothing about the entity left intact.
 *
 * Only the config file is not read from disk: the loader is handed the config
 * the instance was booted with.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineConfig,
  defineSingle,
  text,
  textarea,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateStatus } from "../migrate-status";

/** The config the commands load, set by each test before it runs them. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

/** Left as booted: the negative control, named by neither command. */
const intact = defineCollection({
  slug: "rc_intact",
  fields: [text({ name: "title" })],
});
/** Its `summary` column is dropped. */
const columnLost = defineCollection({
  slug: "rc_column_lost",
  fields: [text({ name: "title" }), textarea({ name: "summary" })],
});
/** Its table is dropped; its registry row stays. */
const tableLost = defineCollection({
  slug: "rc_table_lost",
  fields: [text({ name: "title" })],
});
/** Its registry row is deleted; its table stays. */
const rowLost = defineCollection({
  slug: "rc_row_lost",
  fields: [text({ name: "title" })],
});
/** A single whose registry row is deleted: a registry of its own. */
const singleRowLost = defineSingle({
  slug: "rc_single_row_lost",
  fields: [text({ name: "headline" })],
});

const collections = [intact, columnLost, tableLost, rowLost];
const singles = [singleRowLost];

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-registry-consistency-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
});

afterEach(async () => {
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
 * Boot an instance on `dialect` that the commands can reach through
 * `DATABASE_URL`. PostgreSQL and MySQL get a database of their own, and the
 * harness points `DATABASE_URL` at it; SQLite runs on a file in the test's
 * directory, since an in-memory database is unreachable from another
 * connection.
 */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  if (dialect !== "sqlite") {
    return createTestNextly({ dialect, collections, singles });
  }
  const url = `file:${join(dir, "test.db")}`;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = url;
  _resetEnvCache();
  const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
    typeof createAdapter
  >[0]);
  return createTestNextly({ adapter, collections, singles });
}

/** A quoted identifier, as each dialect spells one. */
function quoted(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

/** Break the database behind the registry's back, in the four ways above. */
async function disagree(t: TestNextly, dialect: TestDialect): Promise<void> {
  const q = (name: string) => quoted(dialect, name);
  await t.adapter.executeQuery(
    `ALTER TABLE ${q("dc_rc_column_lost")} DROP COLUMN ${q("summary")}`
  );
  await t.adapter.executeQuery(`DROP TABLE ${q("dc_rc_table_lost")}`);
  await t.adapter.executeQuery(
    `DELETE FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'rc_row_lost'`
  );
  await t.adapter.executeQuery(
    `DELETE FROM ${q("dynamic_singles")} WHERE ${q("slug")} = 'rc_single_row_lost'`
  );
}

/** A command's options and context, with everything it says captured. */
function command(): {
  context: CommandContext;
  said: string[];
} {
  const said: string[] = [];
  const base = createLogger({ quiet: true });
  const capture = (message: string) => {
    said.push(message);
  };
  const logger = {
    ...base,
    info: capture,
    warn: capture,
    success: capture,
    error: capture,
  };
  return {
    context: { logger, options: {}, cwd: dir } as CommandContext,
    said,
  };
}

/** The lines a command printed that name `needle`. */
function naming(said: readonly string[], needle: string): string[] {
  return said.filter(line => line.includes(needle));
}

/** What each command must say, and what neither may say. */
function expectAllFourNamed(said: readonly string[]): void {
  expect(naming(said, '"rc_table_lost"')).toEqual([
    expect.stringContaining(
      'names table "dc_rc_table_lost", which does not exist'
    ),
  ]);
  expect(naming(said, '"rc_column_lost"')).toEqual([
    expect.stringContaining('field "summary" has no column "summary"'),
  ]);
  expect(naming(said, '"rc_row_lost"')).toEqual([
    expect.stringMatching(/^collection "rc_row_lost".*has no registry row/),
  ]);
  expect(naming(said, '"rc_single_row_lost"')).toEqual([
    expect.stringMatching(/^single "rc_single_row_lost".*has no registry row/),
  ]);
  expect(naming(said, "rc_intact")).toEqual([]);
}

describe.each(getConfiguredTestDialects())(
  "registry and tables disagree (%s)",
  dialect => {
    beforeEach(async () => {
      instance = await boot(dialect);
      loaded.config = defineConfig({
        collections,
        singles,
        db: { migrationsDir: "./migrations" },
      });
    });

    it("migrate:status names each disagreement", async () => {
      const t = instance!;
      await disagree(t, dialect);

      const { context, said } = command();
      await runMigrateStatus({ cwd: dir }, context);

      expectAllFourNamed(said);
    });

    it("migrate:status --json carries each disagreement", async () => {
      const t = instance!;
      await disagree(t, dialect);

      const printed: string[] = [];
      const log = vi.spyOn(console, "log").mockImplementation(value => {
        printed.push(String(value));
      });
      try {
        const { context } = command();
        await runMigrateStatus({ cwd: dir, json: true }, context);
      } finally {
        log.mockRestore();
      }

      const result = JSON.parse(printed.join("\n")) as {
        registry: {
          missingTables: unknown[];
          missingColumns: unknown[];
          unregistered: unknown[];
          unreadable: unknown[];
        };
      };
      expect(result.registry).toEqual({
        missingTables: [
          {
            kind: "collection",
            slug: "rc_table_lost",
            table: "dc_rc_table_lost",
          },
        ],
        missingColumns: [
          {
            kind: "collection",
            slug: "rc_column_lost",
            table: "dc_rc_column_lost",
            field: "summary",
            column: "summary",
          },
        ],
        unregistered: [
          { kind: "collection", slug: "rc_row_lost" },
          { kind: "single", slug: "rc_single_row_lost" },
        ],
        unreadable: [],
      });
    });

    it("migrate names each disagreement when it finishes", async () => {
      const t = instance!;
      await disagree(t, dialect);

      const { context, said } = command();
      await runMigrate({ cwd: dir }, context);

      expectAllFourNamed(said);
      // Named after the run has finished its own work, not instead of it.
      const finished = said.findIndex(line =>
        line.startsWith("Nothing to migrate")
      );
      const named = said.findIndex(line => line.includes('"rc_table_lost"'));
      expect(finished).toBeGreaterThanOrEqual(0);
      expect(named).toBeGreaterThan(finished);
    });

    it("neither command names anything on a database that agrees", async () => {
      const status = command();
      await runMigrateStatus({ cwd: dir }, status.context);
      const migrate = command();
      await runMigrate({ cwd: dir }, migrate.context);

      for (const said of [status.said, migrate.said]) {
        expect(said.filter(line => line.includes("rc_"))).toEqual([]);
      }
    });
  }
);
