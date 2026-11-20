/**
 * The upgrade: a database an earlier version left holding pairs of sibling fields.
 *
 * Seeded through the production DDL and registry helpers, as the earlier version left it:
 * - a Builder collection `articles` whose registry row holds two top-level fields named `summary`
 *   (one column, `summary`, in its table) and a group `seo` holding two fields named `headline`
 *   (one key of its value): two pairs that each share one stored value;
 * - a code-first collection `guides` whose group `seo` holds `fooBar` and `foo_bar`: two keys of
 *   its value, a pair that shares none.
 *
 * Two fields sharing one stored value are refused however long they have: `migrate:check` refuses
 * `articles`, naming each pair and the column or key it shares, while `guides` keeps working with
 * a warning, and the upgraded start is refused with the same two pairs. Once `articles`' row holds
 * one field of each pair, the start goes on, each entity is written and read, and `migrate:check`
 * passes with only `guides`' warning.
 *
 * The way out the guide documents is walked too, with the commands themselves: a Builder
 * collection made in development, left holding two pairs, refuses the start; one field of each is
 * renamed in the Builder's definition file, `nextly migrate:create` writes the migration and
 * `nextly migrate` applies it, and the start goes on, the renamed fields written and read.
 *
 * Each case owns its database: a throwaway database on PostgreSQL and MySQL, a temporary file on
 * SQLite.
 */
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runMigrate } from "../../../cli/commands/migrate";
import { runChecks } from "../../../cli/commands/migrate-check";
import { runMigrateCreate } from "../../../cli/commands/migrate-create";
import type { CommandContext } from "../../../cli/program";
import { createLogger } from "../../../cli/utils/logger";
import { defineCollection, defineConfig, group, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { clearServices } from "../../../di/register";
import { seedBuilderCollection } from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import type { ServiceContainer } from "../../../services";
import { _resetEnvCache } from "../../../shared/lib/env";
import { consoleLogger } from "../../../shared/types";
import { DynamicCollectionRegistryService } from "../../dynamic-collections/services/dynamic-collection-registry-service";
import { setNonInteractive } from "../migrate/can-prompt";
import { writeSnapshot } from "../migrate-create/snapshot-io";

/** The configuration the commands load. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

interface CaseDatabase {
  adapter: DrizzleAdapter;
  /** Connect again: a refused start disconnects the adapter it was given. */
  reopen(): Promise<void>;
  close(): Promise<void>;
}

async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const dir = await mkdtemp(join(tmpdir(), "nextly-sibling-upgrade-"));
    // The commands reach the case's database through `DATABASE_URL`, as an app's do.
    const fileUrl = `file:${join(dir, "test.db")}`;
    vi.stubEnv("DATABASE_URL", fileUrl);
    _resetEnvCache();
    const connect = async () =>
      (await createAdapter({
        type: "sqlite",
        url: fileUrl,
      } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    const database: CaseDatabase = {
      adapter: await connect(),
      async reopen() {
        database.adapter = await connect();
      },
      async close() {
        await database.adapter.disconnect().catch(() => {});
        await rm(dir, { recursive: true, force: true });
      },
    };
    return database;
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_sib_${randomBytes(8).toString("hex")}`;
  vi.stubEnv("DATABASE_URL", serverUrl);
  vi.stubEnv("DB_DIALECT", dialect);
  _resetEnvCache();
  const server = await createAdapter({ type: dialect, url: serverUrl });
  await server.executeQuery(createDatabaseStatement(dialect, name));
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  vi.stubEnv("DATABASE_URL", url.toString());
  _resetEnvCache();
  const connect = async () =>
    (await createAdapter({
      type: dialect,
      url: url.toString(),
    })) as unknown as DrizzleAdapter;
  const database: CaseDatabase = {
    adapter: await connect(),
    async reopen() {
      await database.adapter.disconnect().catch(() => {});
      database.adapter = await connect();
    },
    async close() {
      await database.adapter.disconnect().catch(() => {});
      await server.executeQuery(dropDatabaseStatement(dialect, name));
      await server.disconnect();
    },
  };
  return database;
}

/** The Builder collection's fields as the earlier version left its registry row. */
const ARTICLES_FIELDS = [
  { name: "summary", type: "text", source: "ui" },
  { name: "summary", type: "text", source: "ui" },
  {
    name: "seo",
    type: "group",
    source: "ui",
    fields: [
      { name: "headline", type: "text" },
      { name: "headline", type: "text" },
    ],
  },
];

/** The code-first collection, with a pair `defineCollection` accepts. */
const guides = defineCollection({
  slug: "guides",
  fields: [
    group({
      name: "seo",
      fields: [text({ name: "fooBar" }), text({ name: "foo_bar" })],
    }),
  ],
});

/** `articles` with one field of each pair gone, as a rename leaves its row: its table is as it was. */
const ARTICLES_RENAMED = [
  { name: "summary", type: "text", source: "ui" },
  {
    name: "seo",
    type: "group",
    source: "ui",
    fields: [{ name: "headline", type: "text" }],
  },
];

/** The refusal of `articles`' pairs, each naming the stored value it shares. */
const ARTICLES_REFUSALS = [
  "Collection 'articles': fields 'summary' and 'summary' at the top level share the column 'summary'. Rename one of them so each has its own column.",
  "Collection 'articles': fields 'headline' and 'headline' in group 'seo' share the key 'headline'. Rename one of them so each has its own key.",
];

/** The warning for `guides`' pair, which shares no stored value and keeps working. */
const GUIDES_WARNING =
  "Collection 'guides': fields 'fooBar' and 'foo_bar' in group 'seo' would both become the column 'foo_bar'. They keep working; rename one of them.";

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    header: vi.fn(),
    newline: vi.fn(),
    divider: vi.fn(),
    keyValue: vi.fn(),
    item: vi.fn(),
    table: vi.fn(),
    getOptions: () => ({}),
  };
}

let projectRoot: string;

for (const dialect of getConfiguredTestDialects()) {
  describe(`sibling fields after the upgrade — ${dialect}`, () => {
    let database: CaseDatabase;
    let current: TestNextly | undefined;

    async function boot(
      config: Parameters<typeof createTestNextly>[0] = {}
    ): Promise<TestNextly> {
      clearServices();
      current = await createTestNextly({
        ...config,
        adapter: database.adapter as never,
      });
      return current;
    }

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-sibling-app-"));
      vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
      database = await openDatabase(dialect);
    });

    afterEach(async () => {
      setNonInteractive(false);
      await current?.destroy().catch(() => {});
      clearServices();
      current = undefined;
      await database.close();
      vi.restoreAllMocks();
      await rm(projectRoot, { recursive: true, force: true });
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    /**
     * `migrate:check` over a migrations folder whose latest snapshot predates the record of
     * entities, as an upgraded project's does: both tables are in it, so each entity exists, and
     * each is judged with the fields its registry row holds.
     */
    let checks = 0;
    async function check() {
      // A folder of its own for each check, so a second one starts from the same snapshot.
      checks += 1;
      const migrationsDir = join(projectRoot, `migrations-${String(checks)}`);
      await mkdir(join(migrationsDir, "meta"), { recursive: true });
      const tables = {
        tables: ["dc_articles", "dc_guides"].map(name => ({
          name,
          columns: [{ name: "id", type: "text", nullable: false }],
        })),
      };
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        "-- placeholder",
        "utf-8"
      );
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_initial",
        tables,
        "-- placeholder"
      );
      const registry = new DynamicCollectionRegistryService(
        database.adapter,
        consoleLogger
      );
      const fieldsOf = async (slug: string) =>
        ((await registry.getCollection(slug)) as { fields: unknown[] }).fields;
      const exit = vi
        .spyOn(process, "exit")
        .mockImplementation((() => undefined) as never);
      const printed = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: tables,
        entities: {
          collections: [
            {
              slug: "articles",
              tableName: "dc_articles",
              fields: (await fieldsOf("articles")) as never,
            },
            {
              slug: "guides",
              tableName: "dc_guides",
              fields: (await fieldsOf("guides")) as never,
            },
          ],
          singles: [],
          components: [],
        },
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });
      const outcome = {
        errors: logger.error.mock.calls.map(([line]) => String(line)),
        warnings: logger.warn.mock.calls.map(([line]) => String(line)),
        exited: exit.mock.calls.length > 0,
        passed: logger.success.mock.calls.some(([line]) =>
          String(line).includes("migrate:check OK")
        ),
      };
      exit.mockRestore();
      printed.mockRestore();
      return outcome;
    }

    /** The refusal a start or a save gives for `articles`' two pairs. */
    const refusedWithArticlesPairs = {
      code: "VALIDATION_ERROR",
      publicData: {
        errors: ARTICLES_REFUSALS.map(message => ({
          path: "fields",
          code: "FIELD_NAME_DUPLICATE",
          message,
        })),
      },
    };

    it("refuses an entity holding two fields that share a column or a key, at migrate:check and at the start, until one of each is renamed", async () => {
      // The database as an earlier version left it. The tables come from the production DDL, which
      // makes one column per name, and the registry rows hold the pairs, as the earlier version's
      // saves left them.
      await boot();
      const registry = new DynamicCollectionRegistryService(
        database.adapter,
        consoleLogger
      );
      await seedBuilderCollection(database.adapter, {
        slug: "articles",
        fields: [
          { name: "summary", type: "text" },
          {
            name: "seo",
            type: "group",
            fields: [{ name: "headline", type: "text" }],
          },
        ],
      });
      await registry.updateCollectionMetadata("articles", {
        fields: ARTICLES_FIELDS as never,
      });
      await seedBuilderCollection(database.adapter, {
        slug: "guides",
        fields: [{ name: "seo", type: "group", fields: [] }],
      });
      await registry.updateCollectionMetadata("guides", {
        fields: guides.fields as never,
      });

      // `migrate:check` refuses `articles`' two pairs, naming each, and warns about `guides`.
      expect(await check()).toEqual({
        errors: ARTICLES_REFUSALS,
        warnings: [GUIDES_WARNING],
        exited: true,
        passed: false,
      });

      // The upgraded start is refused, naming the same two pairs.
      await expect(boot({ collections: [guides] })).rejects.toMatchObject(
        refusedWithArticlesPairs
      );

      // One field of each pair renamed, as the migration that renames them leaves the row: the
      // start goes on.
      await database.reopen();
      await new DynamicCollectionRegistryService(
        database.adapter,
        consoleLogger
      ).updateCollectionMetadata("articles", {
        fields: ARTICLES_RENAMED as never,
      });
      const t = await boot({ collections: [guides] });

      // Each entity is written and read.
      const article = await t.nextly.create({
        collection: "articles",
        data: { title: "Kept", summary: "short", seo: { headline: "h" } },
      });
      const articleRead = (await t.nextly.findByID({
        collection: "articles",
        id: (article.item as { id: string }).id,
      })) as { summary?: string; seo?: { headline?: string } } | null;
      expect(articleRead?.summary).toBe("short");
      expect(articleRead?.seo?.headline).toBe("h");

      const guide = await t.nextly.create({
        collection: "guides",
        data: { title: "Kept", seo: { fooBar: "a", foo_bar: "b" } },
      });
      const guideRead = (await t.nextly.findByID({
        collection: "guides",
        id: (guide.item as { id: string }).id,
      })) as { seo?: { fooBar?: string; foo_bar?: string } } | null;
      expect(guideRead?.seo).toMatchObject({ fooBar: "a", foo_bar: "b" });

      // `migrate:check` passes, warning only about `guides`.
      expect(await check()).toEqual({
        errors: [],
        warnings: [GUIDES_WARNING],
        exited: false,
        passed: true,
      });
    });

    /** A command's context, its logger's lines kept. */
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
          cwd: projectRoot,
        } as CommandContext,
        said,
      };
    }

    /** Run `fn`, turning `process.exit` into a thrown `exit <code>`. */
    async function exiting(
      fn: () => Promise<void>
    ): Promise<number | undefined> {
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

    it("starts again once one field of each pair is renamed in the definition file, then migrate:create and migrate are run", async () => {
      const db = {
        migrationsDir: "./migrations",
        uiSchemaFile: "./ui-schema.json",
      };
      const definitionFile = join(projectRoot, "ui-schema.json");

      // In development `articles` is made in the Builder, which leaves its definition file, its
      // migration and its registry row.
      vi.stubEnv("NODE_ENV", "development");
      _resetEnvCache();
      await boot({ basePath: projectRoot, collections: [], db } as never);
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: "articles",
          label: "Articles",
          fields: [
            { name: "summary", type: "text" },
            {
              name: "seo",
              type: "group",
              fields: [{ name: "headline", type: "text" }],
            },
          ],
        }
      );
      await current?.destroy();
      current = undefined;
      vi.stubEnv("NODE_ENV", "test");
      _resetEnvCache();

      // An earlier version's save left the definition file and the registry row holding a second
      // `summary` and a second `seo.headline`: one column and one key, each shared.
      type Manifest = {
        collections: Array<{ slug: string; fields: unknown[] }>;
      };
      const manifest = JSON.parse(
        await readFile(definitionFile, "utf-8")
      ) as Manifest;
      const articles = manifest.collections.find(c => c.slug === "articles");
      if (articles === undefined) throw new Error("articles is not defined");
      articles.fields = ARTICLES_FIELDS;
      await writeFile(definitionFile, JSON.stringify(manifest, null, 2));
      await database.reopen();
      await new DynamicCollectionRegistryService(
        database.adapter,
        consoleLogger
      ).updateCollectionMetadata("articles", {
        fields: ARTICLES_FIELDS as never,
      });

      // The start is refused, naming both pairs.
      await expect(boot()).rejects.toMatchObject(refusedWithArticlesPairs);
      await database.reopen();

      // The way out: one field of each pair renamed in the definition file, then
      // `nextly migrate:create` and `nextly migrate`.
      articles.fields = [
        { name: "summary", type: "text" },
        { name: "teaser", type: "text" },
        {
          name: "seo",
          type: "group",
          fields: [
            { name: "headline", type: "text" },
            { name: "subhead", type: "text" },
          ],
        },
      ];
      await writeFile(definitionFile, JSON.stringify(manifest, null, 2));
      loaded.config = defineConfig({ collections: [], db } as never);
      setNonInteractive(true);
      const created = command();
      expect(
        await exiting(() =>
          runMigrateCreate("rename", { cwd: projectRoot }, created.context)
        ).finally(() => setNonInteractive(false)),
        created.said.join("\n")
      ).toBeUndefined();
      const applied = command();
      expect(
        await exiting(() => runMigrate({ cwd: projectRoot }, applied.context)),
        applied.said.join("\n")
      ).toBeUndefined();

      // The start goes on, and the renamed fields are written and read.
      const t = await boot();
      const article = await t.nextly.create({
        collection: "articles",
        data: {
          title: "Renamed",
          summary: "short",
          teaser: "longer",
          seo: { headline: "h", subhead: "s" },
        },
      });
      const read = (await t.nextly.findByID({
        collection: "articles",
        id: (article.item as { id: string }).id,
      })) as {
        summary?: string;
        teaser?: string;
        seo?: { headline?: string; subhead?: string };
      } | null;
      expect(read).toMatchObject({
        summary: "short",
        teaser: "longer",
        seo: { headline: "h", subhead: "s" },
      });
    });
  });
}
