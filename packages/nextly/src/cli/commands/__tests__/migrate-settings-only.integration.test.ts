/**
 * A settings-only edit, made in code or in the Schema Builder, is written by
 * `nextly migrate:create` as a migration with no table statements, beside its
 * snapshot, and `nextly migrate` records it like any other — on every
 * configured dialect.
 *
 * The commands are driven themselves (`runMigrateCreate`, `runMigrate`)
 * against a project directory and a database of the test's own. Only the
 * config file is not read from disk: the loader is handed the config each step
 * declares. The Builder's edit is made with `mutateManifest`, the mutation the
 * Builder's write API applies to `ui-schema.json`, and written to the file the
 * command reads.
 *
 * What separates the correct command from the broken one is the second file
 * existing: a `migrate:create` that compares only tables exits 2 ("no changes")
 * on each edit below and writes nothing.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  defineCollection,
  defineConfig,
  text,
  textarea,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { splitSqlStatements } from "../../../domains/schema/migrate/split-sql";
import { mutateManifest } from "../../../domains/schema/ui-schema/mutate";
import { loadedDialect } from "../../../database/dialect-tables";
import { uiSchemaManifest } from "../../../schemas/_zod/ui-schema";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { parseSqlSections, runMigrate } from "../migrate";
import { runMigrateDown } from "../migrate-down";
import { runMigrateCreate } from "../migrate-create";

/** The config the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-settings-only-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  // Each migration file is named by the clock; two runs inside one
  // millisecond would otherwise write the same name.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 28, 12, 0, 0, 0)));
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
 * entity of its own: every content table here comes from a migration. SQLite
 * runs on a file in the test's directory, since an in-memory database is
 * unreachable from the commands' connection.
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

/** Run `fn`, turning `process.exit` into a thrown `exit <code>`. */
async function exiting(fn: () => Promise<void>): Promise<number | undefined> {
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await fn();
    return undefined;
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return Number(match[1]);
    throw error;
  } finally {
    exit.mockRestore();
  }
}

/** `nextly migrate:create --name=<name> --non-interactive` over `config`. */
async function migrateCreate(config: unknown, name: string): Promise<void> {
  loaded.config = config;
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 28, 12, 0, 0, clock)));
  const { context, said } = command();
  const code = await exiting(() =>
    runMigrateCreate(name, { cwd: dir, nonInteractive: true }, context)
  );
  expect(code, said.join("\n")).toBeUndefined();
}

/** `nextly migrate` over `config`, which must succeed. */
async function migrate(config: unknown): Promise<string[]> {
  loaded.config = config;
  const { context, said } = command();
  const code = await exiting(() => runMigrate({ cwd: dir }, context));
  expect(code, said.join("\n")).toBeUndefined();
  return said;
}

/** The migration file whose name ends `_<name>.sql`. */
async function migrationNamed(name: string): Promise<{
  file: string;
  sql: string;
}> {
  const file = readdirSync(join(dir, "migrations")).find(f =>
    f.endsWith(`_${name}.sql`)
  );
  expect(file, `no migration named ${name}`).toBeDefined();
  return {
    file: file!,
    sql: await readFile(join(dir, "migrations", file!), "utf-8"),
  };
}

/** The UP's statements, as `nextly migrate` splits them on `dialect`. */
function upStatements(sql: string, dialect: TestDialect): string[] {
  return splitSqlStatements(parseSqlSections(sql).upSql, dialect);
}

/** Whether the ledger records `file` applied. */
function applied(t: TestNextly, dialect: TestDialect, file: string) {
  return new SchemaEventsRepository(
    (t.adapter as unknown as DrizzleAdapter).getDrizzle(),
    dialect
  ).isFileApplied(file);
}

const postsConfig = (description: string) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: "so_posts",
        description,
        fields: [text({ name: "headline" }), textarea({ name: "body" })],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });

/** The project's `ui-schema.json`, as the Builder leaves it. */
async function writeManifest(manifest: unknown): Promise<void> {
  await writeFile(
    join(dir, "ui-schema.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

const builderOnly = defineConfig({
  collections: [],
  db: { migrationsDir: "./migrations" },
});

describe.each(getConfiguredTestDialects())(
  "a settings-only change travels as a migration (%s)",
  dialect => {
    beforeEach(async () => {
      instance = await boot(dialect);
    });

    it("a description edited in code", async () => {
      await migrateCreate(postsConfig("Blog posts"), "create_posts");
      await migrate(postsConfig("Blog posts"));

      await migrateCreate(postsConfig("Articles for the blog"), "describe");

      const { file, sql } = await migrationNamed("describe");
      expect(sql).toContain("-- Settings: so_posts: description");
      expect(upStatements(sql, dialect)).toEqual([]);
      const snapshot = JSON.parse(
        await readFile(
          join(
            dir,
            "migrations",
            "meta",
            file.replace(/\.sql$/, ".snapshot.json")
          ),
          "utf-8"
        )
      );
      expect(snapshot.entities.collections.so_posts.settings.description).toBe(
        "Articles for the blog"
      );

      // `nextly migrate` records it like any other migration.
      await migrate(postsConfig("Articles for the blog"));
      expect(await applied(instance!, dialect, file)).toBe(true);
    });

    it("migrate:down rolls a settings-only migration back, with no table to undo", async () => {
      await migrateCreate(postsConfig("Blog posts"), "create_posts");
      await migrate(postsConfig("Blog posts"));
      await migrateCreate(postsConfig("Articles for the blog"), "describe");
      await migrate(postsConfig("Articles for the blog"));
      const { file } = await migrationNamed("describe");

      loaded.config = postsConfig("Articles for the blog");
      const { context, said } = command();
      const code = await exiting(() => runMigrateDown({ cwd: dir }, context));

      expect(code, said.join("\n")).toBeUndefined();
      expect(await applied(instance!, dialect, file)).toBe(false);
      // The step stopped at the settings-only file: the table migration before
      // it is still applied, and its table is still there.
      const { file: created } = await migrationNamed("create_posts");
      expect(await applied(instance!, dialect, created)).toBe(true);
    });

    it("a description edited in the Schema Builder", async () => {
      const created = uiSchemaManifest.parse({
        collections: [
          {
            slug: "so_events",
            description: "Things that happen",
            fields: [{ name: "title", type: "text" }],
          },
        ],
      });
      await writeManifest(created);
      await migrateCreate(builderOnly, "create_events");
      await migrate(builderOnly);

      // The Builder's edit: the whole entity upserted, as its write API sends it.
      await writeManifest(
        mutateManifest(created, {
          type: "upsert",
          kind: "collections",
          entity: {
            slug: "so_events",
            description: "Upcoming events",
            fields: [{ name: "title", type: "text" }],
          },
        })
      );
      await migrateCreate(builderOnly, "describe_events");

      const { file, sql } = await migrationNamed("describe_events");
      expect(sql).toContain("-- Settings: so_events: description");
      // No table statement: the only statement is the Builder entity's
      // registry row, which is how its settings reach a deployed database.
      const statements = upStatements(sql, dialect);
      expect(
        statements.filter(s => /^\s*(CREATE|ALTER|DROP)\b/i.test(s))
      ).toEqual([]);
      expect(statements).toHaveLength(1);

      await migrate(builderOnly);
      expect(await applied(instance!, dialect, file)).toBe(true);
      const table = loadedDialect(dialect).tables.dynamicCollections;
      const db = (instance!.adapter as unknown as DrizzleAdapter).getDrizzle<{
        select: () => {
          from: (
            t: unknown
          ) => Promise<{ slug: string; description: string | null }[]>;
        };
      }>();
      const rows = await db.select().from(table);
      expect(rows.find(r => r.slug === "so_events")?.description).toBe(
        "Upcoming events"
      );

      // And it rolls back like the code-first one: nothing about it is
      // irreversible, since it changed no table.
      const { context, said } = command();
      const code = await exiting(() => runMigrateDown({ cwd: dir }, context));
      expect(code, said.join("\n")).toBeUndefined();
      expect(await applied(instance!, dialect, file)).toBe(false);
    });
  }
);
