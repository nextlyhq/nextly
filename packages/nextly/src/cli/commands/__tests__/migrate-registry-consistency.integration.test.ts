/**
 * `nextly migrate` and `nextly migrate:status` name where the registry and the
 * tables disagree, on every configured dialect.
 *
 * A booted instance writes a registry row and a table for each entity. Then,
 * behind the registry's back, one table is dropped, one registered field's
 * column is dropped (a table that lacks a column its row records, the shape a
 * plugin's new column left in production), and one collection's and one
 * single's registry rows are deleted. Both commands are driven themselves,
 * `runMigrateStatus` and `runMigrate`, against that database. `migrate:status`
 * must name all four, and nothing about the entity left intact. `nextly
 * migrate` names the two lost rows once it has finished, and refuses, with
 * nothing changed, a database lacking a table or column its applied
 * migrations record.
 *
 * Only the config file is not read from disk: the loader is handed the config
 * the instance was booted with.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineConfig,
  defineSingle,
  text,
  textarea,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
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
import { runMigrateBaseline } from "../migrate-baseline";
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

/** Drop the one table and the one column behind the registry's back. */
async function loseTableAndColumn(
  t: TestNextly,
  dialect: TestDialect
): Promise<void> {
  const q = (name: string) => quoted(dialect, name);
  await t.adapter.executeQuery(
    `ALTER TABLE ${q("dc_rc_column_lost")} DROP COLUMN ${q("summary")}`
  );
  await t.adapter.executeQuery(`DROP TABLE ${q("dc_rc_table_lost")}`);
}

/** Delete the collection's and the single's registry rows behind its back. */
async function loseRows(t: TestNextly, dialect: TestDialect): Promise<void> {
  const q = (name: string) => quoted(dialect, name);
  await t.adapter.executeQuery(
    `DELETE FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'rc_row_lost'`
  );
  await t.adapter.executeQuery(
    `DELETE FROM ${q("dynamic_singles")} WHERE ${q("slug")} = 'rc_single_row_lost'`
  );
}

/** Break the database behind the registry's back, in the four ways above. */
async function disagree(t: TestNextly, dialect: TestDialect): Promise<void> {
  await loseTableAndColumn(t, dialect);
  await loseRows(t, dialect);
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

/**
 * `nextly migrate:baseline`: the booted database's tables become the
 * migration its history begins from, recorded as applied. `nextly migrate`
 * refuses a database whose folder records none of the tables it holds.
 */
async function baseline(): Promise<void> {
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`migrate:baseline exited ${String(code)}`);
  });
  setNonInteractive(true);
  try {
    await runMigrateBaseline({ cwd: dir }, command().context);
  } finally {
    setNonInteractive(false);
    exit.mockRestore();
  }
}

/**
 * Make each snapshot in the folder one an earlier release wrote: no registry
 * metadata, no permission record. Past the first run on this release such a
 * snapshot is no registry source, so a lost row stays lost for the commands
 * to name rather than being written back from it.
 */
function asEarlierRelease(): void {
  const meta = join(dir, "migrations", "meta");
  const files = readdirSync(meta).filter(f => f.endsWith(".snapshot.json"));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const path = join(meta, file);
    const snapshot = JSON.parse(readFileSync(path, "utf-8")) as Record<
      string,
      unknown
    >;
    delete snapshot.entities;
    delete snapshot.permissions;
    writeFileSync(path, JSON.stringify(snapshot, null, 2));
  }
}

/** `nextly migrate`, which must be refused: the error it ends with. */
async function migrateRefused(
  context: CommandContext
): Promise<{ code?: unknown; why?: unknown }> {
  const error = await runMigrate(
    { cwd: dir, throwOnFailure: true },
    context
  ).then(
    () => undefined,
    (thrown: unknown) => thrown
  );
  expect(error, "the run was not refused").toBeDefined();
  return error as { code?: unknown; why?: unknown };
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
          behindSnapshot: unknown[];
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
        behindSnapshot: [],
        unreadable: [],
      });
    });

    it("migrate names each lost row when it finishes, and refuses a lost table or column", async () => {
      const t = instance!;
      // A database adopted by an earlier release and past its first run on
      // this one, whose registry rows come from no migration: a first run
      // would write the lost rows from the configuration instead of naming
      // them, and a snapshot carrying the registry metadata would write them
      // back.
      await baseline();
      asEarlierRelease();
      await runMigrate({ cwd: dir, throwOnFailure: true }, command().context);
      await loseRows(t, dialect);

      const { context, said } = command();
      await runMigrate({ cwd: dir, throwOnFailure: true }, context);

      expect(naming(said, '"rc_row_lost"')).toEqual([
        expect.stringMatching(/^collection "rc_row_lost".*has no registry row/),
      ]);
      expect(naming(said, '"rc_single_row_lost"')).toEqual([
        expect.stringMatching(
          /^single "rc_single_row_lost".*has no registry row/
        ),
      ]);
      for (const slug of ["rc_intact", "rc_table_lost", "rc_column_lost"]) {
        expect(naming(said, slug)).toEqual([]);
      }
      // Named after the run has finished its own work, not instead of it.
      const finished = said.findIndex(line =>
        line.startsWith("Nothing to migrate")
      );
      const named = said.findIndex(line => line.includes('"rc_row_lost"'));
      expect(finished).toBeGreaterThanOrEqual(0);
      expect(named).toBeGreaterThan(finished);

      // A table or column the applied migrations record and the database
      // lacks ends the run before it changes anything, naming each one.
      await loseTableAndColumn(t, dialect);
      const refused = command();
      const error = await migrateRefused(refused.context);
      expect(error.code).toBe("DATABASE_BEHIND_MIGRATIONS");
      const lines = String(error.why).split("\n");
      expect(lines).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^- table dc_rc_table_lost \(created by /),
          expect.stringMatching(
            /^- column dc_rc_column_lost\.summary \(created by /
          ),
        ])
      );
      expect(lines.filter(line => line.includes("rc_intact"))).toEqual([]);
      // Refused before its own work: nothing was migrated or put back.
      expect(
        refused.said.filter(line => line.startsWith("Nothing to migrate"))
      ).toEqual([]);
      expect(
        await (t.adapter as unknown as DrizzleAdapter).tableExists(
          "dc_rc_table_lost"
        )
      ).toBe(false);
    });

    it("neither command names anything on a database that agrees", async () => {
      await baseline();
      const status = command();
      await runMigrateStatus({ cwd: dir }, status.context);
      const migrate = command();
      await runMigrate({ cwd: dir, throwOnFailure: true }, migrate.context);

      for (const said of [status.said, migrate.said]) {
        expect(said.filter(line => line.includes("rc_"))).toEqual([]);
      }
    });
  }
);
