/**
 * The upgrade: a database an earlier version left holding pairs of sibling fields the rule now
 * refuses as new keeps working after it starts with the rule.
 *
 * Seeded through the production DDL and registry helpers, as the earlier version left it:
 * - a Builder collection `articles` whose registry row holds two top-level fields named `summary`
 *   (one column, `summary`, in its table) and a group `seo` holding two fields named `headline`;
 * - a code-first collection `guides` whose group `seo` holds `fooBar` and `foo_bar`, a pair
 *   `defineCollection` accepted before the rule and still accepts.
 *
 * After the upgraded start, each entity is written and read, `articles` is saved in the Builder
 * after an unrelated edit (a new field, then a new label), and `migrate:check` passes with exactly
 * one warning per pair. Nothing is refused.
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
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { seedBuilderCollection } from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
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
  close(): Promise<void>;
}

async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const dir = await mkdtemp(join(tmpdir(), "nextly-sibling-upgrade-"));
    const adapter = (await createAdapter({
      type: "sqlite",
      url: `file:${join(dir, "test.db")}`,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    return {
      adapter,
      async close() {
        await adapter.disconnect().catch(() => {});
        await rm(dir, { recursive: true, force: true });
      },
    };
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
  const adapter = (await createAdapter({
    type: dialect,
    url: url.toString(),
  })) as unknown as DrizzleAdapter;
  return {
    adapter,
    async close() {
      await adapter.disconnect().catch(() => {});
      await server.executeQuery(dropDatabaseStatement(dialect, name));
      await server.disconnect();
    },
  };
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

/** One warning per pair, as `migrate:check` words it. */
const EXPECTED_WARNINGS = [
  "Collection 'articles': fields 'summary' and 'summary' at the top level already share the column 'summary'. They keep working; rename one of them so each keeps its own value.",
  "Collection 'articles': fields 'headline' and 'headline' in group 'seo' already share the key 'headline'. They keep working; rename one of them so each keeps its own value.",
  "Collection 'guides': fields 'fooBar' and 'foo_bar' in group 'seo' would both become the column 'foo_bar'. They keep working; rename one of them.",
];

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

    it("keeps every entity holding a pair read, written, saved and checked, refusing nothing", async () => {
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

      // The upgraded start: both rows hold their pairs, so nothing is new and nothing is refused.
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

      // Saved in the Builder after an unrelated edit: a new field, applied as the Builder's save
      // applies it, in development, where a save runs its migration, then a new label.
      const { schemaVersion } = (await new DynamicCollectionRegistryService(
        t.adapter as never,
        consoleLogger
      ).getCollection("articles")) as { schemaVersion?: number };
      const nodeEnv = process.env.NODE_ENV;
      vi.stubEnv("NODE_ENV", "development");
      try {
        await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "articles" },
          {
            fields: [...ARTICLES_FIELDS, { name: "subtitle", type: "text" }],
            confirmed: true,
            schemaVersion: schemaVersion ?? 1,
          }
        );
      } finally {
        vi.stubEnv("NODE_ENV", nodeEnv);
      }
      const edited = await t.nextly.create({
        collection: "articles",
        data: { title: "Edited", summary: "s", subtitle: "sub" },
      });
      expect(
        edited.item as { summary?: string; subtitle?: string }
      ).toMatchObject({ summary: "s", subtitle: "sub" });
      await dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: "articles" },
        { labels: { singular: "Story", plural: "Stories" } }
      );
      const relabelled = (await new DynamicCollectionRegistryService(
        t.adapter as never,
        consoleLogger
      ).getCollection("articles")) as {
        labels?: { singular?: string };
        fields: unknown[];
      };
      expect(relabelled.labels?.singular).toBe("Story");
      // The row still holds both pairs and the new field.
      expect(
        (relabelled.fields as { name: string }[]).map(f => f.name)
      ).toEqual(["summary", "summary", "seo", "subtitle"]);

      // `migrate:check` over a migrations folder whose latest snapshot predates the record of
      // entities, as an upgraded project's does: both tables are in it, so each entity exists and
      // each pair is warned about once.
      const migrationsDir = join(projectRoot, "migrations");
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
      const fieldsOf = async (slug: string) =>
        (
          (await new DynamicCollectionRegistryService(
            t.adapter as never,
            consoleLogger
          ).getCollection(slug)) as { fields: unknown[] }
        ).fields;
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
      const warnings = logger.warn.mock.calls.map(([line]) => String(line));
      expect([...warnings].sort()).toEqual([...EXPECTED_WARNINGS].sort());
      expect(logger.error).not.toHaveBeenCalled();
      expect(printed).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining("migrate:check OK")
      );
    });
  });
}
