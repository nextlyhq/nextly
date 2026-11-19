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
 * a warning. The upgraded start goes on, so the Builder can open, and logs each of `articles`'
 * pairs with what to rename; every save of `articles`' definition is refused until one field of
 * each pair is renamed, and the same save with them renamed goes through. Then each entity is
 * written and read, and `migrate:check` passes with only `guides`' warning.
 *
 * Each case owns its database: a throwaway database on PostgreSQL and MySQL, a temporary file on
 * SQLite.
 */
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runChecks } from "../../../cli/commands/migrate-check";
import { defineCollection, group, text } from "../../../config";
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
import { writeSnapshot } from "../migrate-create/snapshot-io";

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
    const connect = async () =>
      (await createAdapter({
        type: "sqlite",
        url: `file:${join(dir, "test.db")}`,
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

    it("refuses an entity holding two fields that share a column or a key until one of each is renamed, starting so the Builder can rename them", async () => {
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

      // The upgraded start goes on, so the Builder can open, and says what to rename.
      const startLogger = makeLogger();
      const t = await boot({
        collections: [guides],
        logger: startLogger as never,
      });
      const logged = startLogger.error.mock.calls.map(([line]) => String(line));
      for (const pair of [
        "fields 'summary' and 'summary' at the top level share the column 'summary'",
        "fields 'headline' and 'headline' in group 'seo' share the key 'headline'",
      ]) {
        expect(logged).toContainEqual(
          expect.stringContaining(
            `${pair}. Rename one field in the Builder (or your configuration) and save`
          )
        );
      }

      // Every save of its definition is refused until one of each pair is renamed, an unrelated
      // edit included; the same edit with them renamed goes through.
      const save = async (fields: unknown[]) => {
        const { schemaVersion } = (await new DynamicCollectionRegistryService(
          t.adapter as never,
          consoleLogger
        ).getCollection("articles")) as { schemaVersion?: number };
        const nodeEnv = process.env.NODE_ENV;
        vi.stubEnv("NODE_ENV", "development");
        try {
          return await dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: "articles" },
            { fields, confirmed: true, schemaVersion: schemaVersion ?? 1 }
          );
        } finally {
          vi.stubEnv("NODE_ENV", nodeEnv);
        }
      };
      const subtitle = { name: "subtitle", type: "text" };
      await expect(save([...ARTICLES_FIELDS, subtitle])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: ARTICLES_REFUSALS.map(message => ({
            path: "fields",
            code: "FIELD_NAME_DUPLICATE",
            message,
          })),
        },
      });
      await expect(
        save([...ARTICLES_RENAMED, subtitle])
      ).resolves.toBeDefined();

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
  });
}
