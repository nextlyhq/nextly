/**
 * The app's override of a generated column's storage, written by `nextly
 * migrate:create` and applied by `nextly migrate`, and kept by the owner's
 * next migration, on every configured dialect.
 *
 * The app narrows a collection's, a Single's and a component's text field to
 * `varchar(10)` and widens a whole-number field to `bigint`. The first
 * migration creates the columns with that storage; the owner's next change
 * (a required field made optional, which rebuilds each table on SQLite, and
 * a field added) is written and applied without planning the field's own
 * storage back.
 *
 * The commands are driven themselves (`runMigrateCreate`, `runMigrate`)
 * against a project directory and a database of the test's own, as
 * `migrate-create-required-field.integration.test.ts` drives them.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  number,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import type { SchemaHook } from "../../../domains/schema/extension/draft";
import { col } from "../../../domains/schema/extension/dsl";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { declaredSize } from "../../../domains/schema/pipeline/diff/declared-size";
import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";
import { normalizeType } from "../../../domains/schema/pipeline/diff/normalize-type";
import type { TableSpec } from "../../../domains/schema/pipeline/diff/types";
import { resolveSingleTableName } from "../../../domains/singles/services/resolve-single-table-name";
import { resolveComponentTableName } from "../../../domains/schema/utils/resolve-table-name";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { toCliError } from "../../errors/from-thrown";
import { formatCliError } from "../../errors/render";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";
import { runRepairColumns } from "../repair-columns";

/** The config the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
  projectRoot: "",
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    dependencies: [],
    projectRoot: loaded.projectRoot,
  }),
}));

const POSTS_TABLE = "dc_mo_posts";
const SITE_TABLE = resolveSingleTableName({ slug: "mo_site" });
const SEO_TABLE = resolveComponentTableName("mo_seo");
const TABLES = [POSTS_TABLE, SITE_TABLE, SEO_TABLE] as const;

/** Each table's overridden string column. */
const OVERRIDDEN: Record<(typeof TABLES)[number], string> = {
  [POSTS_TABLE]: "city",
  [SITE_TABLE]: "tagline",
  [SEO_TABLE]: "meta_title",
};

/** The app's hook: each text column to 10 characters, `views` to bigint. */
const overrides: SchemaHook = ({ schema }) => {
  schema.overrideColumn(POSTS_TABLE, "city", col.varchar(10));
  schema.overrideColumn(POSTS_TABLE, "views", col.bigint());
  schema.overrideColumn(SITE_TABLE, "tagline", col.varchar(10));
  schema.overrideColumn(SEO_TABLE, "metaTitle", col.varchar(10));
};

/** The app's config, its headline required or not, with a field added or not. */
const appConfig = (required: boolean, added: boolean) =>
  defineConfig({
    fieldGroups: [
      defineFieldGroup({
        slug: "mo_seo",
        fields: [
          text({ name: "metaTitle" }),
          ...(added ? [text({ name: "metaDescription" })] : []),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: "mo_posts",
        fields: [
          text({ name: "headline", required }),
          text({ name: "city" }),
          number({ name: "views" }),
          fieldGroup({ name: "seo", component: "mo_seo" }),
          ...(added ? [text({ name: "subtitle" })] : []),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "mo_site",
        fields: [
          text({ name: "tagline" }),
          ...(added ? [text({ name: "motto" })] : []),
        ],
      }),
    ],
    db: { migrationsDir: "./migrations", schema: { extend: [overrides] } },
  });

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-column-override-"));
  mkdirSync(join(dir, "migrations"));
  loaded.projectRoot = dir;
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  // Each migration file is named by the clock; two runs inside one
  // millisecond would otherwise write the same name.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 13, 12, 0, 0, 0)));
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
 * A booted instance the commands reach through `DATABASE_URL`, declaring no
 * entity of its own: the tables here come from migrations. SQLite runs on a
 * file in the test's directory, since an in-memory database is unreachable
 * from the commands' connection.
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

/** `nextly migrate:create --name=<name> --non-interactive` over `config`: the file it wrote. */
async function migrateCreate(config: unknown, name: string): Promise<string> {
  loaded.config = config;
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 13, 12, 0, 0, clock)));
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

/** `nextly migrate --non-interactive` over `config`; fails the test on a refusal. */
async function migrate(config: unknown): Promise<void> {
  loaded.config = config;
  const { context, said } = command();
  setNonInteractive(true);
  try {
    await runMigrate({ cwd: dir, throwOnFailure: true }, context);
  } catch (error) {
    said.push(formatCliError(toCliError(error)));
    expect.unreachable(said.join("\n"));
  } finally {
    setNonInteractive(false);
  }
}

const q = (dialect: TestDialect, name: string): string =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** The three tables as the database has them, read by the diff's own introspection. */
async function live(dialect: TestDialect): Promise<Map<string, TableSpec>> {
  const snapshot = await introspectLiveSnapshot(
    instance!.adapter.getDrizzle(),
    dialect,
    [...TABLES]
  );
  return new Map(snapshot.tables.map(table => [table.name, table]));
}

/** Each overridden column holds a string of at most 10 characters, as stored. */
function expectOverridden(
  dialect: TestDialect,
  tables: Map<string, TableSpec>
): void {
  for (const table of TABLES) {
    const column = tables
      .get(table)
      ?.columns.find(c => c.name === OVERRIDDEN[table]);
    expect(column, `${table}.${OVERRIDDEN[table]}`).toBeDefined();
    if (dialect === "sqlite") {
      // SQLite has one string type and keeps no width.
      expect(normalizeType(column!.type)).toBe("text");
    } else {
      expect(normalizeType(column!.type), table).toBe("varchar");
      expect(declaredSize(column!), table).toBe("10");
    }
  }
  const views = tables.get(POSTS_TABLE)?.columns.find(c => c.name === "views");
  expect(normalizeType(views!.type)).toBe(
    dialect === "sqlite" ? "int4" : "int8"
  );
}

/**
 * A literal for a NOT NULL column with no default, by its type: enough to
 * write a row straight to the table.
 */
function literalFor(type: string, id: string): string {
  const t = type.toLowerCase();
  if (/time|date/.test(t)) return "CURRENT_TIMESTAMP";
  if (/int|num|dec|real|double|float|bool/.test(t)) return "1";
  // The row's id, so a unique column (a collection's slug) differs per row.
  return `'${id}'`;
}

/** Write a row to `table` with `value` in `column`, straight to the table. */
async function insertRow(
  dialect: TestDialect,
  table: TableSpec,
  id: string,
  column: string,
  value: string
): Promise<void> {
  const required = table.columns.filter(
    c => c.name !== column && !c.nullable && c.default === undefined
  );
  const names = [...required.map(c => c.name), column];
  const values = [...required.map(c => literalFor(c.type, id)), value];
  await instance!.adapter.executeQuery(
    `INSERT INTO ${q(dialect, table.name)} (${names
      .map(name => q(dialect, name))
      .join(", ")}) VALUES (${values.join(", ")})`
  );
}

/**
 * `nextly repair-columns`, a dry run, over `config`: each finding it reports
 * about an overridden column, as `<table>.<column> <outcome>`.
 */
async function repairFindings(config: unknown): Promise<string[]> {
  loaded.config = config;
  const { context } = command();
  const { document, error } = await runRepairColumns({ cwd: dir }, context);
  expect(document.result, String(error)).not.toBeNull();
  const overridden = new Set([...Object.values(OVERRIDDEN), "views"]);
  return document
    .result!.records.filter(record => overridden.has(record.column))
    .map(record => `${record.table}.${record.column} ${record.outcome}`);
}

describeEachDialect(
  "the app's override of a generated column, through migrations",
  dialect => {
    it("is written by the app's migration, and kept by the owner's next one", async () => {
      instance = await boot(dialect);
      await migrateCreate(appConfig(true, false), "create_entities");
      await migrate(appConfig(true, false));
      const before = await live(dialect);
      expectOverridden(dialect, before);
      // `repair-columns` judges an overridden column against the override,
      // not the field's own storage, so it finds nothing to repair.
      expect(await repairFindings(appConfig(true, false))).toEqual([]);

      // Within the width, and a number a 32-bit integer cannot hold.
      const posts = before.get(POSTS_TABLE)!;
      await insertRow(dialect, posts, "r1", "city", "'0123456789'");
      await instance.adapter.executeQuery(
        `UPDATE ${q(dialect, POSTS_TABLE)} SET ${q(dialect, "views")} = ${String(2 ** 31 + 5)}`
      );
      // Past it: refused where the dialect enforces a width.
      for (const table of TABLES) {
        const write = insertRow(
          dialect,
          before.get(table)!,
          `long-${table}`,
          OVERRIDDEN[table],
          "'0123456789X'"
        );
        if (dialect === "sqlite") await expect(write).resolves.toBeUndefined();
        else await expect(write).rejects.toThrow();
      }

      // The owner's next change: written without the field's own storage.
      await migrateCreate(appConfig(false, true), "owner_update");
      await migrate(appConfig(false, true));

      const after = await live(dialect);
      expect(
        after.get(POSTS_TABLE)!.columns.find(c => c.name === "headline")
          ?.nullable
      ).toBe(true);
      expectOverridden(dialect, after);
      expect(await repairFindings(appConfig(false, true))).toEqual([]);
      const rows = await instance.adapter.executeQuery<Record<string, unknown>>(
        `SELECT ${q(dialect, "city")} AS city, ${q(dialect, "views")} AS views FROM ${q(dialect, POSTS_TABLE)} WHERE ${q(dialect, "id")} = 'r1'`
      );
      expect(rows[0]?.city).toBe("0123456789");
      expect(Number(rows[0]?.views)).toBe(2 ** 31 + 5);
    });
  }
);
