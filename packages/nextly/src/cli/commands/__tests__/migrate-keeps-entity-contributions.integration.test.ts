/**
 * What a plugin contributes to a collection's, a Single's and a component's
 * table — a hidden column and an index over it — reaches the app's migration
 * that creates the tables, and is kept, with the column's values, by the
 * owner's next migration, written by `nextly migrate:create` and applied by
 * `nextly migrate`. On every configured dialect.
 *
 * The owner's change makes a required field optional and adds a field. On
 * SQLite a column's nullability cannot be altered in place, so the migration
 * rebuilds each table; a rebuild written from the owner's fields alone would
 * copy the rows into a table without the column or its index. On PostgreSQL
 * and MySQL a migration written from the owner's fields alone would drop
 * both as drift.
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
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { col } from "../../../domains/schema/extension/dsl";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";
import type { TableSpec } from "../../../domains/schema/pipeline/diff/types";
import { resolveSingleTableName } from "../../../domains/singles/services/resolve-single-table-name";
import { resolveComponentTableName } from "../../../domains/schema/utils/resolve-table-name";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { definePlugin } from "../../../plugins/plugin-context";
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

/** The config the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const POSTS_TABLE = "dc_mk_posts";
const SITE_TABLE = resolveSingleTableName({ slug: "mk_site" });
const SEO_TABLE = resolveComponentTableName("mk_seo");
const TABLES = [POSTS_TABLE, SITE_TABLE, SEO_TABLE] as const;

/** Each entity's own field, required in the first migration and optional after. */
const OWN_FIELD: Record<(typeof TABLES)[number], string> = {
  [POSTS_TABLE]: "headline",
  [SITE_TABLE]: "tagline",
  [SEO_TABLE]: "meta_title",
};

/**
 * The contributor: a nullable column and an index over it, on each of the
 * three tables.
 */
const contributor = definePlugin({
  name: "@test/migrate-keeper",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    schema: {
      extend: [
        ({ schema }) => {
          for (const table of TABLES) {
            schema.extendTable(table, {
              columns: { searchKey: col.shortText({ nullable: true }) },
              indexes: [{ columns: ["searchKey"] }],
            });
          }
        },
      ],
    },
  },
});

/** The app's config, its own fields required or not, with a field added or not. */
const appConfig = (required: boolean, added: boolean) =>
  defineConfig({
    fieldGroups: [
      defineFieldGroup({
        slug: "mk_seo",
        fields: [
          text({ name: "metaTitle", required }),
          ...(added ? [text({ name: "metaDescription" })] : []),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: "mk_posts",
        fields: [
          text({ name: "headline", required }),
          fieldGroup({ name: "seo", component: "mk_seo" }),
          ...(added ? [text({ name: "subtitle" })] : []),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "mk_site",
        fields: [
          text({ name: "tagline", required }),
          ...(added ? [text({ name: "motto" })] : []),
        ],
      }),
    ],
    plugins: [contributor],
    db: { migrationsDir: "./migrations" },
  });

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-entity-contributions-"));
  mkdirSync(join(dir, "migrations"));
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

/** The index the contribution asks for: one over `search_key` alone. */
function contributedIndex(table: TableSpec) {
  return (table.indexes ?? []).find(
    index =>
      index.columns.length === 1 &&
      index.columns[0] === "search_key" &&
      !index.unique
  );
}

/**
 * A literal for a NOT NULL column with no default, by its type: enough to
 * write one row straight to the table, as an entry saved before the edit.
 */
function literalFor(type: string): string {
  const t = type.toLowerCase();
  if (/time|date/.test(t)) return "CURRENT_TIMESTAMP";
  if (/int|num|dec|real|double|float|bool/.test(t)) return "1";
  return "'v'";
}

/** One row in `table`, with the contributor's value in its column. */
async function insertRow(
  dialect: TestDialect,
  table: TableSpec
): Promise<void> {
  const columns = table.columns.filter(
    column =>
      column.name === "search_key" ||
      (!column.nullable && column.default === undefined)
  );
  const values = columns.map(column =>
    column.name === "search_key"
      ? `'key-${table.name}'`
      : column.name === "id"
        ? `'row-1'`
        : literalFor(column.type)
  );
  await instance!.adapter.executeQuery(
    `INSERT INTO ${q(dialect, table.name)} (${columns
      .map(column => q(dialect, column.name))
      .join(", ")}) VALUES (${values.join(", ")})`
  );
}

/** Each table's contributed values, by table. */
async function contributedValues(
  dialect: TestDialect
): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const rows = await instance!.adapter.executeQuery<Record<string, unknown>>(
      `SELECT ${q(dialect, "search_key")} AS v FROM ${q(dialect, table)}`
    );
    out[table] = rows.map(row => row.v ?? row.V);
  }
  return out;
}

describeEachDialect(
  "a plugin's column and index on a collection, a Single and a component, through migrations",
  dialect => {
    it("is created by the app's migration, and kept with its values by the owner's next one", async () => {
      instance = await boot(dialect);
      await migrateCreate(appConfig(true, false), "create_entities");
      await migrate(appConfig(true, false));

      const before = await live(dialect);
      for (const table of TABLES) {
        const spec = before.get(table);
        expect(spec, `${table} exists`).toBeDefined();
        expect(spec!.columns.map(c => c.name)).toContain("search_key");
        expect(contributedIndex(spec!), `${table}'s index`).toBeDefined();
        // The premise of the owner's change: its field starts NOT NULL.
        expect(
          spec!.columns.find(c => c.name === OWN_FIELD[table])?.nullable,
          `${table}.${OWN_FIELD[table]} starts required`
        ).toBe(false);
        await insertRow(dialect, spec!);
      }
      const expected = Object.fromEntries(
        TABLES.map(table => [table, [`key-${table}`]])
      );
      expect(await contributedValues(dialect)).toEqual(expected);

      await migrateCreate(appConfig(false, true), "owner_update");
      await migrate(appConfig(false, true));

      const after = await live(dialect);
      for (const table of TABLES) {
        const spec = after.get(table)!;
        const names = spec.columns.map(c => c.name);
        // The owner's change landed: its field is optional now, so on
        // SQLite the table was rebuilt, and its new field was added.
        expect(
          spec.columns.find(c => c.name === OWN_FIELD[table])?.nullable,
          `${table}.${OWN_FIELD[table]} is optional after the migration`
        ).toBe(true);
        expect(names.length).toBe(before.get(table)!.columns.length + 1);
        // And the contribution is still there, index included.
        expect(names).toContain("search_key");
        expect(contributedIndex(spec), `${table}'s index`).toBeDefined();
      }
      expect(await contributedValues(dialect)).toEqual(expected);
    });
  }
);
