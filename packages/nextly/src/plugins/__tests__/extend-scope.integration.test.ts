/**
 * A plugin adds a field to every content type the site defines, without
 * naming one, on each dialect.
 *
 * The site has types in code and one made in the Schema Builder, and another
 * plugin brings a collection of its own. The scope must reach the site's types
 * of both origins, and leave the excepted one and the other plugin's alone,
 * in the tables themselves and in what the runtime reads and writes.
 *
 * Each case owns its database, because the second boot has to find the
 * tables the first one left: the harness's own provisioning drops its
 * database when the next boot starts.
 *
 * @module plugins/__tests__/extend-scope.integration.test
 */
import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineConfig,
  defineSingle,
  text,
} from "../../config";
import { createAdapter } from "../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../database/test-database-ddl";
import { clearServices, type NextlyServiceConfig } from "../../di/register";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import { reloadNextlyConfig } from "../../init/reload-config";
import { _resetEnvCache } from "../../shared/lib/env";
import type { PluginDefinition } from "../plugin-context";
import { applyPluginSchemaContributionsDeferred } from "../schema/apply-contributions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

import { seedBuilderCollection } from "./seed-builder-entity";

/** What the config file says now, folded as `loadConfig` folds it. */
const loaded = vi.hoisted(() => ({ result: undefined as unknown }));
vi.mock("../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../cli/utils/config-loader")>()),
  loadConfig: async () => loaded.result,
}));

/**
 * The site's configuration with its plugins, as `loadConfig` returns it: the
 * plugins' schema folded in by the same function the CLI and the boot use.
 */
function configWith(
  declared: Pick<NextlyServiceConfig, "collections" | "singles">,
  plugins: PluginDefinition[]
): void {
  const base = defineConfig({
    collections: declared.collections,
    singles: declared.singles,
    plugins,
  });
  const folded = applyPluginSchemaContributionsDeferred(
    base as unknown as NextlyServiceConfig,
    plugins
  );
  loaded.result = {
    config: {
      ...base,
      collections: folded.config.collections,
      singles: folded.config.singles,
    },
    deferredExtends: folded.deferredExtends,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  };
}

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

/** A database every boot of one case connects to, dropped when it closes. */
async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const adapter = (await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    return { adapter, close: () => adapter.disconnect() };
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_es_${randomBytes(8).toString("hex")}`;
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

const posts = defineCollection({
  slug: "es_posts",
  fields: [text({ name: "title" })],
});
const pages = defineCollection({
  slug: "es_pages",
  fields: [text({ name: "title" })],
});
const homepage = defineSingle({
  slug: "es_homepage",
  fields: [text({ name: "headline" })],
});

/** Another plugin, whose own collection the scope must never reach. */
const formsPlugin: PluginDefinition = {
  name: "@t/forms",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    collections: [
      defineCollection({
        slug: "es_submissions",
        fields: [text({ name: "data" })],
      }),
    ],
  },
};

/** Adds `seo_title` to every collection and Single except `es_pages`. */
const seoPlugin: PluginDefinition = {
  name: "@t/seo",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    extend: [
      {
        target: { every: ["collection", "single"], except: ["es_pages"] },
        fields: [text({ name: "seo_title" })],
      },
    ],
  },
};

async function columnsOf(t: TestNextly, table: string): Promise<string[]> {
  const snapshot = await introspectLiveSnapshot(
    t.adapter.getDrizzle(),
    t.adapter.dialect as Parameters<typeof introspectLiveSnapshot>[1],
    [table]
  );
  return (
    snapshot.tables
      .find(spec => spec.name === table)
      ?.columns.map(column => column.name) ?? []
  );
}

let database: CaseDatabase | undefined;
let current: TestNextly | undefined;
afterEach(async () => {
  clearServices();
  current = undefined;
  await database?.close();
  database = undefined;
  vi.unstubAllEnvs();
  _resetEnvCache();
});

describe.each(getConfiguredTestDialects())(
  "a plugin extending every content type (%s)",
  dialect => {
    it("adds the field to the site's code and Builder types, and to no other", async () => {
      database = await openDatabase(dialect);
      const adapter = database.adapter;

      // The site as it stood before the plugin: its code types, and a
      // collection made in the Schema Builder.
      await createTestNextly({
        adapter: adapter as never,
        collections: [posts, pages],
        singles: [homepage],
      });
      await seedBuilderCollection(adapter as never, {
        slug: "es_cases",
        fields: [{ name: "summary", type: "text" }],
      });

      // The plugins are installed and the site starts again in development,
      // where the existing code tables take the change from the config reload
      // a saved edit triggers.
      clearServices();
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        adapter: adapter as never,
        collections: [posts, pages],
        singles: [homepage],
        plugins: [formsPlugin, seoPlugin],
      });
      configWith({ collections: [posts, pages], singles: [homepage] }, [
        formsPlugin,
        seoPlugin,
      ]);
      await reloadNextlyConfig();

      const reached = {
        dc_es_posts: await columnsOf(current, "dc_es_posts"),
        single_es_homepage: await columnsOf(current, "single_es_homepage"),
        dc_es_cases: await columnsOf(current, "dc_es_cases"),
      };
      expect(reached).toEqual({
        dc_es_posts: expect.arrayContaining(["seo_title"]),
        single_es_homepage: expect.arrayContaining(["seo_title"]),
        dc_es_cases: expect.arrayContaining(["seo_title"]),
      });
      expect(await columnsOf(current, "dc_es_pages")).toContain("title");
      expect(await columnsOf(current, "dc_es_pages")).not.toContain(
        "seo_title"
      );
      expect(await columnsOf(current, "dc_es_submissions")).toContain("data");
      expect(await columnsOf(current, "dc_es_submissions")).not.toContain(
        "seo_title"
      );

      // The runtime reads and writes the field on a code type and on the
      // Builder's, as any other field.
      for (const collection of ["es_posts", "es_cases"]) {
        const created = await current.nextly.create({
          collection: collection as never,
          data: { title: "T", seo_title: `On ${collection}` } as never,
        });
        const id = (created.item as { id: string }).id;
        const read = (await current.nextly.findByID({
          collection: collection as never,
          id,
        } as never)) as { seo_title?: string } | null;
        expect({ [collection]: read?.seo_title }).toEqual({
          [collection]: `On ${collection}`,
        });
      }
    }, 240_000);
  }
);
