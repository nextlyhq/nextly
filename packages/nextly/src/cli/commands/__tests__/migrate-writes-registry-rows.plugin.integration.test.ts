/**
 * A plugin's migration module, applied by `nextly migrate` after the app's
 * newest migration, leaves every registry row as the app's newest applied
 * snapshot records it, the plugin's own contributed collection included, on
 * every configured dialect.
 *
 * A plugin's modules carry tables only; its contributed collection is
 * recorded in the app's snapshot like any other entity. So a run that applies
 * a plugin module and no app migration still brings each row to the app's
 * snapshot, and a row edited by hand is restored to it on that run.
 *
 * The plugin's modules are written by `nextly migrate:create --plugin` and
 * loaded back through their barrel by esbuild, as the CLI's bundler compiles
 * them, so each carries the checksum the generator sealed it with. The
 * plugin's entry is handed to the command as its definition, as the app's
 * config is handed to the loader: the SDK's `col` and `defineTable` are
 * core's own (`@nextlyhq/plugin-sdk/schema` re-exports them), used here from
 * source.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { loadedDialect } from "../../../database/dialect-tables";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import type { PluginMigration } from "../../../domains/schema/migrate/plugin/plugin-migration";
import {
  definePlugin,
  type PluginDefinition,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { bundleAndRequire as BundleAndRequire } from "../../utils/config-bundler";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/**
 * What the commands load: the app's config, set by each step before it runs
 * them, and the plugin's entry with the definition it exports.
 */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
  entryPath: "",
  entry: undefined as unknown,
}));

/**
 * The config as the loader returns it: the plugins' contributions folded in
 * by the loader's own fold (`mergeSetupResultIntoConfig`), so the plugin's
 * collection reaches the commands as it reaches them from a config file.
 */
vi.mock("../../utils/config-loader", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../utils/config-loader")>();
  return {
    ...original,
    loadConfig: async () => {
      const config = loaded.config as LoadedConfig;
      return {
        config: original.mergeSetupResultIntoConfig(
          config,
          config,
          config.plugins ?? []
        ),
        dependencies: [],
      };
    },
  };
});

/**
 * The CLI's bundler with the test runner's `import()`: esbuild compiles a
 * module or barrel to an ES module beside it, every package import external.
 * The plugin's entry is the definition it exports.
 */
const bundleAndRequire = vi.hoisted(
  () =>
    async function bundle(
      options: Parameters<typeof BundleAndRequire>[0]
    ): ReturnType<typeof BundleAndRequire> {
      if (options.filepath === loaded.entryPath) {
        return { mod: { default: loaded.entry }, dependencies: [] };
      }
      const { build } = await import("esbuild");
      const outfile = `${options.filepath}.${Math.random()
        .toString(36)
        .slice(2)}.mjs`;
      await build({
        entryPoints: [options.filepath],
        bundle: true,
        platform: "node",
        format: "esm",
        packages: "external",
        outfile,
        logLevel: "silent",
      });
      const mod = (await import(
        /* @vite-ignore */ pathToFileURL(outfile).href
      )) as Record<string, unknown>;
      return { mod, dependencies: [] };
    }
);
vi.mock("../../utils/config-bundler", () => ({ bundleAndRequire }));

const PLUGIN = "@test/rrp";

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-registry-rows-plugin-"));
  mkdirSync(join(dir, "migrations"));
  mkdirSync(join(dir, "plugin", "src"), { recursive: true });
  loaded.entryPath = join(dir, "plugin", "src", "index.ts");
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  // App migration files and plugin modules are named by the clock; two
  // written inside one second would otherwise share a name.
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
 * A booted instance the commands reach through `DATABASE_URL`. SQLite runs on
 * a file in the test's directory, since an in-memory database is
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

/** Run `fn`, turning `process.exit` into the code it was called with. */
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

/** Moves the clock on, so each migration file and module gets a name of its own. */
function tick(): void {
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 10, 12, 0, clock, 0)));
}

/**
 * The plugin at `schemaVersion`: its table, its contributed collection, and
 * the modules it ships. Version 2 adds a column to its own table only.
 */
function plugin(
  schemaVersion: 1 | 2,
  migrations: PluginMigration[]
): PluginDefinition {
  return definePlugin({
    name: PLUGIN,
    version: `1.${String(schemaVersion)}.0`,
    nextly: "*",
    schemaVersion,
    contributes: {
      schema: {
        prefix: "rrp",
        tables: [
          defineTable("items", {
            id: col.id(),
            label: col.shortText(),
            ...(schemaVersion === 2
              ? { note: col.text({ nullable: true }) }
              : {}),
          }),
        ],
        migrations,
      },
      collections: [
        defineCollection({
          slug: "rrp_notes",
          description: "Notes the plugin keeps",
          fields: [text({ name: "body" })],
        }),
      ],
    },
  });
}

/** The app's config: its own collection beside the plugin. */
function app(installed: PluginDefinition) {
  return defineConfig({
    collections: [
      defineCollection({
        slug: "rrp_posts",
        description: "Posts the app keeps",
        fields: [text({ name: "title" })],
      }),
    ],
    plugins: [installed],
    db: { migrationsDir: "./migrations" },
  });
}

/** The plugin's shipped modules, loaded through its barrel. */
async function shipped(): Promise<PluginMigration[]> {
  const { mod } = await bundleAndRequire({
    filepath: join(dir, "plugin", "src", "migrations", "index.ts"),
    cwd: join(dir, "plugin", "src", "migrations"),
  });
  return (mod as { migrations: PluginMigration[] }).migrations;
}

/**
 * `nextly migrate:create --plugin src/index.ts --name=<name>` from the
 * plugin's own project, over the plugin at `schemaVersion` with the modules
 * it already ships; the modules it ships afterwards.
 */
async function pluginModules(
  schemaVersion: 1 | 2,
  name: string
): Promise<PluginMigration[]> {
  const existing =
    schemaVersion === 1 ? [] : (await shipped()).slice(0, schemaVersion - 1);
  loaded.entry = plugin(schemaVersion, existing);
  tick();
  const { context, said } = command();
  const code = await exiting(() =>
    runMigrateCreate(
      undefined,
      { plugin: "src/index.ts", cwd: join(dir, "plugin"), name },
      context
    )
  );
  expect(code, said.join("\n")).toBeUndefined();
  return shipped();
}

/** `nextly migrate:create --name=<name> --non-interactive` over `config`. */
async function migrateCreate(config: unknown, name: string): Promise<void> {
  loaded.config = config;
  tick();
  const { context, said } = command();
  setNonInteractive(true);
  const code = await exiting(() =>
    runMigrateCreate(name, { cwd: dir }, context)
  ).finally(() => setNonInteractive(false));
  expect(code, said.join("\n")).toBeUndefined();
}

/** `nextly migrate` over `config`, which must succeed. */
async function migrated(config: unknown): Promise<void> {
  loaded.config = config;
  tick();
  const { context, said } = command();
  const code = await exiting(() => runMigrate({ cwd: dir }, context));
  expect(code, said.join("\n")).toBeUndefined();
}

type Row = Record<string, unknown>;
interface Selecting {
  select: () => { from: (table: unknown) => Promise<Row[]> };
  update: (table: unknown) => {
    set: (values: Row) => { where: (condition: unknown) => Promise<unknown> };
  };
}

/** Every collection registry row, as stored. */
async function collectionRows(
  t: TestNextly,
  dialect: TestDialect
): Promise<Row[]> {
  const db = (t.adapter as unknown as DrizzleAdapter).getDrizzle<Selecting>();
  return db.select().from(loadedDialect(dialect).tables.dynamicCollections);
}

/** Columns that are each writer's own rather than the declaration's. */
const OWN_COLUMNS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "createdBy",
  "source",
  "locked",
  "configPath",
  "migrationStatus",
  "schemaVersion",
  "lastMigrationId",
]);

/** A stored value, a JSON column read as its value. */
function stored(value: unknown): unknown {
  return typeof value === "string" && /^[[{]/.test(value)
    ? JSON.parse(value)
    : value;
}

/** The columns the declaration of `slug` decides, JSON read as values. */
function declaredColumns(rows: Row[], slug: string): Row | undefined {
  const row = rows.find(candidate => candidate.slug === slug);
  if (row === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(row)
      .filter(([column]) => !OWN_COLUMNS.has(column))
      .map(([column, value]) => [column, stored(value)])
  );
}

/** The field names a list of fields holds, in order. */
function namesOf(fields: unknown): string[] {
  return ((stored(fields) as { name: string }[] | undefined) ?? []).map(
    field => field.name
  );
}

/** The app's snapshot files, oldest first. */
function appSnapshots(): string[] {
  return readdirSync(join(dir, "migrations", "meta"))
    .filter(file => file.endsWith(".snapshot.json"))
    .sort();
}

/** The collection declarations the app's newest snapshot records. */
async function snapshotCollections(): Promise<
  Record<string, { settings: { description?: string; fields: unknown } }>
> {
  const newest = appSnapshots().at(-1);
  expect(newest, "no app snapshot").toBeDefined();
  const snapshot = JSON.parse(
    await readFile(join(dir, "migrations", "meta", newest!), "utf-8")
  ) as {
    entities?: {
      collections: Record<
        string,
        { settings: { description?: string; fields: unknown } }
      >;
    };
  };
  expect(snapshot.entities, "the snapshot records no entities").toBeDefined();
  return snapshot.entities!.collections;
}

/** Each slug's row holds the description and fields its snapshot records. */
async function expectRowsAsSnapshot(
  rows: Row[],
  slugs: readonly string[]
): Promise<void> {
  const recorded = await snapshotCollections();
  for (const slug of slugs) {
    const row = rows.find(candidate => candidate.slug === slug);
    expect(recorded[slug], `the snapshot records ${slug}`).toBeDefined();
    expect(row, `the registry holds ${slug}`).toBeDefined();
    expect(row?.description, `${slug} description`).toBe(
      recorded[slug].settings.description
    );
    expect(namesOf(row?.fields), `${slug} fields`).toEqual(
      namesOf(recorded[slug].settings.fields)
    );
  }
}

describe.each(getConfiguredTestDialects())(
  "nextly migrate writes the registry rows across a plugin module (%s)",
  dialect => {
    beforeEach(async () => {
      instance = await boot(dialect);
    });

    it("leaves every row, the plugin's collection's included, as the app's newest snapshot holds it", async () => {
      const slugs = ["rrp_posts", "rrp_notes"] as const;

      // The plugin's first module, then the app's migration over the plugin
      // at that version, both applied by one run.
      const first = await pluginModules(1, "create_items");
      expect(first).toHaveLength(1);
      const v1 = app(plugin(1, first));
      await migrateCreate(v1, "create_app");
      await migrated(v1);
      expect(appSnapshots()).toHaveLength(1);
      const recorded = await snapshotCollections();
      expect(recorded.rrp_notes?.settings.description).toBe(
        "Notes the plugin keeps"
      );
      const afterApp = await collectionRows(instance!, dialect);
      await expectRowsAsSnapshot(afterApp, slugs);
      // A row the run creates says who contributed it, as a start says it:
      // the plugin's collection is the plugin's, the app's own is the app's.
      // A start never rewrites a row's origin, so this is the row's for good.
      expect(afterApp.find(row => row.slug === "rrp_notes")?.source).toBe(
        `plugin:${PLUGIN}`
      );
      expect(afterApp.find(row => row.slug === "rrp_posts")?.source).toBe(
        "code"
      );

      // The plugin's second module changes its own table, and no app
      // migration is written for it.
      const both = await pluginModules(2, "add_note");
      expect(both).toHaveLength(2);
      expect(both[0].name).toBe(first[0].name);

      // A hand edit the run has to undo: only a writer working from the app's
      // snapshot during the plugin module's run restores it.
      const db = (
        instance!.adapter as unknown as DrizzleAdapter
      ).getDrizzle<Selecting>();
      const { tables } = loadedDialect(dialect);
      const { eq } = await import("drizzle-orm");
      await db
        .update(tables.dynamicCollections)
        .set({ description: "edited by hand" })
        .where(eq(tables.dynamicCollections.slug, "rrp_notes"));

      await migrated(app(plugin(2, both)));

      // The run applied the plugin's module and no app migration.
      const applies = await new SchemaEventsRepository(
        instance!.adapter.getDrizzle(),
        dialect
      ).findFileApplies(`plugin:${PLUGIN}/${both[1].name}`);
      expect(applies.map(row => row.status)).toEqual(["applied"]);
      expect(appSnapshots()).toHaveLength(1);

      const afterPlugin = await collectionRows(instance!, dialect);
      await expectRowsAsSnapshot(afterPlugin, slugs);
      expect(
        afterPlugin.find(row => row.slug === "rrp_notes")?.description
      ).toBe("Notes the plugin keeps");
      for (const slug of slugs) {
        expect(declaredColumns(afterPlugin, slug), slug).toEqual(
          declaredColumns(afterApp, slug)
        );
      }
      // A row that already matched is not written to at all.
      expect(afterPlugin.find(row => row.slug === "rrp_posts")).toEqual(
        afterApp.find(row => row.slug === "rrp_posts")
      );
    });
  }
);
