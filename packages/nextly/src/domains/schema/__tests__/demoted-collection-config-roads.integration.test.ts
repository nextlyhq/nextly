/**
 * A collection `nextly db:sync --demote` handed to the Schema Builder whose entry is still in
 * `nextly.config.ts`, on the roads that apply configuration in code: a configuration reload under
 * `next dev` (on every configured dialect) and `nextly db:sync` (on SQLite, through the prepared
 * file the command's other integration tests use).
 *
 * The Builder's definition decides the table on each road; the configuration's entry, edited
 * since the demote to add a field `extra`, decides nothing. Before, the code entry won the merge.
 *
 * - A reload applies only what changed in code, and leaves a Builder collection's table to the
 *   Builder's own save. So: an edit to the entry adds no column (before, it added `extra`), and a
 *   field the Builder added, `subtitle`, keeps its column (a guard: the reload kept it before too).
 * - `db:sync` applies the whole desired schema, so it builds the Builder's field and not the
 *   entry's: `subtitle`'s column, held by the Builder's record alone, is added, and `extra`'s is
 *   not (before, the reverse).
 *
 * The Builder's field is written to its record directly (and, for the reload, its column added),
 * standing in for a Schema Builder save: what is under test is which definition the road applies
 * afterwards.
 *
 * The passes that read the configuration's entities themselves ignore the entry too:
 * - the translations-table pass (a reload, and `db:sync`, whose pass `nextly migrate` and a
 *   production start run as well) makes no translations table for the entry's `localized`
 *   (before, it made one beside the Builder's collection);
 * - a start judges the configuration's pairs of fields against the registry without it (before, a
 *   pair added to the entry stopped the start).
 *
 * And around it: a reload records a plugin's collection as the plugin's, as a start does (before,
 * as the app's own, so a plugin's declaration over a handed-over address was skipped); a demote
 * registers a collection with the registry's own hash of its fields (before, the Builder's first
 * save of the same fields read as a schema change).
 *
 * Each case owns its database: a throwaway database on PostgreSQL and MySQL, a temporary file on
 * SQLite.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the config file says now: what `loadConfig` returns for it. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
}));

import { demoteCollection } from "../../../cli/commands/db-sync-demote";
import { runDbSync } from "../../../cli/commands/db-sync";
import {
  openSqliteSyncTarget,
  type SqliteSyncTarget,
} from "../../../cli/commands/__tests__/helpers/sqlite-sync-target";
import { createLogger } from "../../../cli/utils/logger";
import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { clearServices } from "../../../di/register";
import { getService } from "../../../di/service-access";
import {
  reloadNextlyConfig,
  type ReloadOutcome,
} from "../../../init/reload-config";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../init/schema-snapshot-cache";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { consoleLogger } from "../../../shared/types";
import { CollectionRegistryService } from "../../collections/services/collection-registry-service";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import { calculateSchemaHash } from "../services/schema-hash";

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

/** The collection as code declared it when it was demoted. */
const POSTS = defineCollection({
  slug: "dcr_posts",
  fields: [text({ name: "headline" })],
});

/** Its entry, still in the configuration, edited since the demote. */
const POSTS_EDITED = defineCollection({
  slug: "dcr_posts",
  fields: [text({ name: "headline" }), text({ name: "extra" })],
});

const TABLE = "dc_dcr_posts";

/** The site's languages, for the edits below that make a collection translatable. */
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

/** Its entry, edited since the demote to make it translatable. */
const POSTS_TRANSLATED = defineCollection({
  slug: "dcr_posts",
  localized: true,
  fields: [text({ name: "headline", localized: true })],
});

/** A collection code still owns, made translatable in the same edit: the control. */
const NOTES_TRANSLATED = defineCollection({
  slug: "dcr_notes",
  localized: true,
  fields: [text({ name: "body", localized: true })],
});

/**
 * Its entry, edited since the demote to add two fields that become one column, written as a plain
 * object. A `define*` entry with such a pair is refused by the configuration's own rules
 * (`configurationProblems`) on every road, whoever owns the collection; a plain object is only
 * warned about at a start, which then judges the pair against the registry.
 */
const POSTS_CLASHING = {
  slug: "dcr_posts",
  fields: [
    { name: "headline", type: "text" },
    { name: "fooBar", type: "text" },
    { name: "foo_bar", type: "text" },
  ],
};

/** The same pair on a collection code still owns: the control. */
const NOTES_CLASHING = {
  slug: "dcr_notes",
  fields: [
    { name: "fooBar", type: "text" },
    { name: "foo_bar", type: "text" },
  ],
};

/** A collection a plugin contributes. */
const EVENTS = defineCollection({
  slug: "dcr_events",
  fields: [text({ name: "title" })],
});

/** A plugin contributing the collections `slugs`, as the loader's configuration carries it. */
function contributing(...slugs: string[]) {
  return {
    name: "@test/dcr",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: { collections: slugs.map(slug => ({ slug })) },
  };
}

/** Whether `table` exists. */
async function hasTable(
  adapter: DrizzleAdapter,
  table: string
): Promise<boolean> {
  return adapter.tableExists(table);
}

/** The registry record of `slug`. */
async function recordOf(adapter: DrizzleAdapter, slug: string) {
  return new CollectionRegistryService(
    adapter,
    quiet as never
  ).getCollectionBySlug(slug);
}

const quiet = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
};

/** The table's columns, sorted. */
async function columnsOf(
  adapter: DrizzleAdapter,
  dialect: TestDialect
): Promise<string[]> {
  const live = await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
    TABLE,
  ]);
  return (live.tables[0]?.columns ?? []).map(c => c.name).sort();
}

/** The field names the registry record holds. */
async function recordFields(adapter: DrizzleAdapter): Promise<string[]> {
  const record = await new CollectionRegistryService(
    adapter,
    quiet as never
  ).getCollectionBySlug(POSTS.slug);
  // A group with no name has none of its own: listed as such, not dropped.
  return (record?.fields ?? []).map(
    field => field.name ?? "<group with no name>"
  );
}

/** `nextly db:sync --demote`, answered yes. */
async function demote(adapter: DrizzleAdapter): Promise<void> {
  expect(
    await demoteCollection({
      collection: POSTS as never,
      logger: createLogger({ quiet: true }),
      registry: new CollectionRegistryService(adapter, quiet as never),
      adapter,
      confirm: async () => true,
    })
  ).toBe("demoted");
}

/** A field `subtitle` added to the Builder's record, as a Schema Builder save writes it. */
async function addBuilderField(adapter: DrizzleAdapter): Promise<void> {
  const registry = new CollectionRegistryService(adapter, quiet as never);
  const record = await registry.getCollectionBySlug(POSTS.slug);
  expect(record).toMatchObject({ source: "ui", locked: false });
  const fields = [
    ...(record?.fields ?? []),
    { name: "subtitle", type: "text" },
  ] as never;
  await registry.updateCollection(POSTS.slug, {
    fields,
    schemaHash: calculateSchemaHash(fields),
  });
}

interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const dir = await mkdtemp(join(tmpdir(), "nextly-demoted-roads-"));
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
  const name = `nextly_dcr_${randomBytes(8).toString("hex")}`;
  vi.stubEnv("DATABASE_URL", serverUrl);
  vi.stubEnv("DB_DIALECT", dialect);
  _resetEnvCache();
  const server = await createAdapter({ type: dialect, url: serverUrl });
  await server.executeQuery(createDatabaseStatement(dialect, name));
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  // The reload reads the MySQL database name from here, as an app's does.
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

for (const dialect of getConfiguredTestDialects()) {
  describe(`a demoted collection still declared in code — configuration reload, ${dialect}`, () => {
    let database: CaseDatabase;
    let projectRoot: string;
    let app: Awaited<ReturnType<typeof createTestNextly>>;

    /** A reload of `config`, as a saved edit triggers it; how it ended. */
    async function reloadConfig(config: unknown): Promise<ReloadOutcome> {
      vi.stubEnv("NODE_ENV", "development");
      loaded.config = config;
      return reloadNextlyConfig({
        resolver: name =>
          name === "logger"
            ? { ...consoleLogger, ...quiet }
            : getService(name as Parameters<typeof getService>[0]),
      });
    }

    /** A reload of `collection`, as a saved edit triggers it. */
    async function reload(
      collection: ReturnType<typeof defineCollection>
    ): Promise<void> {
      expect(
        await reloadConfig(defineConfig({ collections: [collection] }))
      ).toBe("finished");
    }

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-demoted-roads-app-"));
      vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
      database = await openDatabase(dialect);
      clearServices();
      loaded.config = defineConfig({ collections: [POSTS] });
      app = await createTestNextly({
        adapter: database.adapter as never,
        collections: [POSTS],
      });
      await demote(database.adapter);
    });

    afterEach(async () => {
      clearServices();
      await database.close();
      vi.restoreAllMocks();
      await rm(projectRoot, { recursive: true, force: true });
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    it("adds no column for an edit to the code entry", async () => {
      const before = await columnsOf(database.adapter, dialect);

      await reload(POSTS_EDITED);

      expect(await columnsOf(database.adapter, dialect)).toEqual(before);
      expect(await recordFields(database.adapter)).not.toContain("extra");
    });

    it("keeps a field the Builder added", async () => {
      await addBuilderField(database.adapter);
      // Its column, as the Builder's save adds it.
      await database.adapter.executeQuery(
        `ALTER TABLE ${TABLE} ADD COLUMN subtitle ${dialect === "mysql" ? "varchar(255)" : "text"}`
      );

      await reload(POSTS_EDITED);

      const columns = await columnsOf(database.adapter, dialect);
      expect(columns).toContain("subtitle");
      expect(columns).not.toContain("extra");
      expect(await recordFields(database.adapter)).toContain("subtitle");

      // Entries are read and written through the Builder's definition too: the runtime table the
      // reload registers is the record's, with its column, not the entry's.
      const { item: created } = await app.nextly.create({
        collection: POSTS.slug as never,
        data: { headline: "Kept", subtitle: "From the Builder" } as never,
      });
      const read = (await app.nextly.findByID({
        collection: POSTS.slug as never,
        id: String((created as { id: unknown }).id),
      })) as Record<string, unknown>;
      expect(read.subtitle).toBe("From the Builder");
    });

    it("provisions no translations table for the code entry's translation setting", async () => {
      // The Builder's record is not translatable: the entry's `localized` decides nothing, so no
      // translations table is made beside the Builder's collection. Code's own collection, made
      // translatable in the same edit, gets its table, so the pass did run.
      expect(
        await reloadConfig(
          defineConfig({
            localization: LOCALIZATION,
            collections: [POSTS_TRANSLATED, NOTES_TRANSLATED],
          })
        )
      ).toBe("finished");

      expect(await hasTable(database.adapter, "dc_dcr_notes_locales")).toBe(
        true
      );
      expect(await hasTable(database.adapter, `${TABLE}_locales`)).toBe(false);
      expect((await recordOf(database.adapter, POSTS.slug))?.localized).toBe(
        false
      );
    });

    it("starts with a pair of fields added to the code entry that become one column", async () => {
      // A start judges the configuration's pairs against the registry: the ignored entry's pair is
      // never made, so it stops nothing. The same pair on code's own collection still stops it.
      clearServices();
      await expect(
        createTestNextly({
          adapter: database.adapter as never,
          collections: [POSTS_CLASHING as never],
        })
      ).resolves.toBeDefined();

      clearServices();
      await expect(
        createTestNextly({
          adapter: database.adapter as never,
          collections: [POSTS as never, NOTES_CLASHING as never],
        })
      ).rejects.toMatchObject({
        logContext: { reason: "sibling-fields" },
      });
    });

    it("records a collection a plugin adds under next dev as the plugin's", async () => {
      // The origin a start gives it (`plugin:<name>`), not the app's own: a record keeps the origin
      // it is created with.
      expect(
        await reloadConfig(
          defineConfig({
            collections: [POSTS, EVENTS],
            plugins: [contributing(EVENTS.slug)] as never,
          })
        )
      ).toBe("finished");
      expect((await recordOf(database.adapter, EVENTS.slug))?.source).toBe(
        "plugin:@test/dcr"
      );
    });

    it("writes a plugin's collection under a handed-over address, as a start does", async () => {
      // A plugin registers its own collection at every start, whoever holds the address: the
      // reload writes its declaration too, rather than taking it for the app's ignored entry.
      expect(
        await reloadConfig(
          defineConfig({
            collections: [POSTS_EDITED],
            plugins: [contributing(POSTS.slug)] as never,
          })
        )
      ).toBe("finished");
      expect(await recordFields(database.adapter)).toContain("extra");
      // And the row is the plugin's from then on, locked, no longer marked as handed over.
      expect(await recordOf(database.adapter, POSTS.slug)).toMatchObject({
        source: "plugin:@test/dcr",
        locked: true,
      });
    });

    it("is registered with the hash the registry compares fields by, so the Builder's first save of the same fields changes nothing", async () => {
      // A collection the registry does not hold yet: the demote registers it.
      const fresh = defineCollection({
        slug: "dcr_fresh",
        fields: [text({ name: "headline" })],
      });
      const registry = new CollectionRegistryService(
        database.adapter,
        quiet as never
      );
      expect(
        await demoteCollection({
          collection: fresh as never,
          logger: createLogger({ quiet: true }),
          registry,
          adapter: database.adapter,
          confirm: async () => true,
        })
      ).toBe("demoted");
      const registered = await registry.getCollectionBySlug(fresh.slug);
      expect(registered).toMatchObject({ source: "ui" });

      // A Schema Builder save that keeps every field as it is.
      await registry.updateCollection(fresh.slug, {
        fields: registered!.fields,
        schemaHash: calculateSchemaHash(registered!.fields as never),
      });

      const saved = await registry.getCollectionBySlug(fresh.slug);
      expect(saved?.schemaVersion).toBe(registered!.schemaVersion);
      expect(saved?.migrationStatus).toBe(registered!.migrationStatus);
    });
  });
}

describe("a demoted collection still declared in code — db:sync (sqlite)", () => {
  let dir: string;
  let target: SqliteSyncTarget | undefined;

  const adapterOf = () => target!.adapter as unknown as DrizzleAdapter;

  /** `nextly db:sync` over `collection`, or over a whole configuration; what it threw, if anything. */
  async function dbSync(
    collection: ReturnType<typeof defineCollection> | { config: unknown }
  ): Promise<unknown> {
    loaded.config =
      "config" in collection
        ? collection.config
        : defineConfig({ collections: [collection] });
    // The command runs in a process of its own, so nothing cached about another database's
    // tables may reach it.
    clearCachedSnapshot();
    clearLiveSnapshots();
    let thrown: unknown;
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    try {
      await runDbSync(
        { cwd: dir, autoSync: true } as Parameters<typeof runDbSync>[0],
        target!.context
      ).catch((err: unknown) => {
        thrown = err;
      });
    } finally {
      exit.mockRestore();
    }
    return thrown;
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "nextly-dbsync-demoted-"));
    vi.stubEnv("DB_DIALECT", "sqlite");
    // The validated environment is cached from its first read, so the command would otherwise
    // connect to whatever database an earlier test configured.
    vi.stubEnv("DATABASE_URL", `file:${join(dir, "test.db")}`);
    _resetEnvCache();
    clearCachedSnapshot();
    target = await openSqliteSyncTarget(dir);
    expect(await dbSync(POSTS)).toBeUndefined();
    await demote(adapterOf());
    await addBuilderField(adapterOf());
  });

  afterEach(async () => {
    await target?.adapter.disconnect();
    target = undefined;
    vi.unstubAllEnvs();
    _resetEnvCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it("builds the table from the Builder's record, and the code entry's edit changes nothing", async () => {
    expect(await dbSync(POSTS_EDITED)).toBeUndefined();

    const columns = await columnsOf(adapterOf(), "sqlite");
    expect(columns).toContain("subtitle");
    expect(columns).not.toContain("extra");
    expect(await recordFields(adapterOf())).toContain("subtitle");
    expect(await recordFields(adapterOf())).not.toContain("extra");
  });

  it("provisions no translations table for the code entry's translation setting", async () => {
    // The translations-table pass `nextly migrate` and a production start run too: the entry's
    // `localized` decides nothing for the Builder's collection. Code's own collection, made
    // translatable in the same edit, gets its table, so the pass did run.
    expect(
      await dbSync({
        config: defineConfig({
          localization: LOCALIZATION,
          collections: [POSTS_TRANSLATED, NOTES_TRANSLATED],
        }),
      })
    ).toBeUndefined();

    expect(await hasTable(adapterOf(), "dc_dcr_notes_locales")).toBe(true);
    expect(await hasTable(adapterOf(), `${TABLE}_locales`)).toBe(false);
  });
});
