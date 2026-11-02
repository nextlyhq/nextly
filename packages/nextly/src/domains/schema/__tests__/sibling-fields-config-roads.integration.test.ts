/**
 * The sibling-field rule on the roads that read configuration in code against a real database: a
 * start, a configuration reload under `next dev`, and `nextly db:sync` (and its `--watch` mode).
 *
 * Each judges the configuration against the entity's registry row, the definition it last had.
 * The collection `posts` has a row holding group `seo` with `fooBar` alone. A configuration that
 * adds `foo_bar` beside it (a new pair; both become the column `foo_bar`) and, with it, an
 * unrelated field `subtitle` is refused on each road, and the registry row and the table are as
 * they were. The control on each road is the same configuration without `foo_bar`, which does
 * reach the row (it gains `subtitle`), so an unchanged row is the refusal's doing.
 *
 * The same pair already in the registry row (as an earlier version's save left it) is existing:
 * the same configuration is then accepted on each road.
 *
 * `define*` accepts this pair (a nested `fooBar`/`foo_bar` is judged at start, not at import), so
 * every configuration here goes through `defineCollection`.
 *
 * The start and the reload run on every configured dialect; `db:sync` on SQLite, through the
 * same prepared file the command's other integration tests use
 * (`cli/commands/__tests__/db-sync-address-rule.integration.test.ts`).
 *
 * Each case owns its database: a throwaway database on PostgreSQL and MySQL, a temporary file on
 * SQLite, so a refused start can be inspected afterwards.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
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

import { runDbSync } from "../../../cli/commands/db-sync";
import { createDebouncedSync } from "../../../cli/commands/dev-watcher";
import {
  openSqliteSyncTarget,
  type SqliteSyncTarget,
} from "../../../cli/commands/__tests__/helpers/sqlite-sync-target";
import type { LoadConfigResult } from "../../../cli/utils/config-loader";
import { defineCollection, defineConfig, group, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { clearServices } from "../../../di/register";
import { getService } from "../../../di/service-access";
import { describeError } from "../../../errors";
import { reloadNextlyConfig } from "../../../init/reload-config";
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
import { DynamicCollectionRegistryService } from "../../dynamic-collections/services/dynamic-collection-registry-service";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

/** `posts` with group `seo` holding `seo`; `extra` adds unrelated top-level fields. */
const posts = (seo: string[], extra: string[] = []) =>
  defineCollection({
    slug: "posts",
    fields: [
      text({ name: "headline" }),
      ...extra.map(name => text({ name })),
      group({ name: "seo", fields: seo.map(name => text({ name })) }),
    ],
  });

/** The row as it is: `seo` holds `fooBar` alone. */
const BEFORE = posts(["fooBar"]);
/** A new pair, with an unrelated field the refusal must also keep out. */
const WITH_PAIR = posts(["fooBar", "foo_bar"], ["subtitle"]);
/** The control: the same change without the pair. */
const WITHOUT_PAIR = posts(["fooBar"], ["subtitle"]);

/** The refusal each road gives for the new pair. */
const REFUSAL =
  "Collection 'posts': fields 'fooBar' and 'foo_bar' in group 'seo' would both become the column 'foo_bar'. Rename one of them.";

/** The registry row's fields, parsed whatever the driver hands back. */
async function rowFields(adapter: DrizzleAdapter): Promise<unknown> {
  const rows = await adapter.executeQuery<{ fields: unknown }>(
    "SELECT fields FROM dynamic_collections WHERE slug = 'posts'"
  );
  const fields = rows[0]?.fields;
  return typeof fields === "string" ? JSON.parse(fields) : fields;
}

/** The system fields a code-first row holds beside the declared ones. */
const SYSTEM = new Set(["title", "slug"]);

/** The declared top-level names a registry row holds, for a readable comparison. */
async function rowNames(adapter: DrizzleAdapter): Promise<string[]> {
  return ((await rowFields(adapter)) as { name: string }[])
    .map(f => f.name)
    .filter(name => !SYSTEM.has(name));
}

/** What a refusal must leave as it was: the registry row and the table's columns. */
async function stateOf(
  adapter: DrizzleAdapter,
  dialect: TestDialect
): Promise<{ fields: unknown; columns: string[] }> {
  const live = await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
    "dc_posts",
  ]);
  return {
    fields: await rowFields(adapter),
    columns: (live.tables[0]?.columns ?? []).map(c => c.name).sort(),
  };
}

/** Write `fields` into the row, as an earlier version's save left it holding the pair. */
async function rowHolds(
  adapter: DrizzleAdapter,
  fields: unknown[]
): Promise<void> {
  await new DynamicCollectionRegistryService(
    adapter,
    consoleLogger
  ).updateCollectionMetadata("posts", { fields: fields as never });
}

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
    const dir = await mkdtemp(join(tmpdir(), "nextly-sibling-roads-"));
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
  const name = `nextly_sr_${randomBytes(8).toString("hex")}`;
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

for (const dialect of getConfiguredTestDialects()) {
  describe(`sibling fields in configuration — ${dialect}`, () => {
    let database: CaseDatabase;
    let projectRoot: string;

    /** A start with `collection` as the configuration's only collection. */
    async function boot(
      collection: ReturnType<typeof defineCollection>
    ): Promise<void> {
      clearServices();
      loaded.config = defineConfig({ collections: [collection] });
      await createTestNextly({
        adapter: database.adapter as never,
        collections: [collection],
      });
    }

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-sibling-roads-app-"));
      vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
      database = await openDatabase(dialect);
      await boot(BEFORE);
    });

    afterEach(async () => {
      clearServices();
      await database.close();
      vi.restoreAllMocks();
      await rm(projectRoot, { recursive: true, force: true });
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    describe("a start", () => {
      it("is refused a new pair, leaving the registry row and the table as they were", async () => {
        const before = await stateOf(database.adapter, dialect);

        let thrown: unknown;
        await boot(WITH_PAIR).catch((error: unknown) => {
          thrown = error;
        });
        expect(thrown).toMatchObject({
          code: "VALIDATION_ERROR",
          publicData: {
            errors: [{ code: "FIELD_NAME_DUPLICATE", message: REFUSAL }],
          },
        });
        clearServices();
        await database.reopen();
        expect(await stateOf(database.adapter, dialect)).toEqual(before);

        // The control: the same change without the pair reaches the row.
        await boot(WITHOUT_PAIR);
        expect(await rowNames(database.adapter)).toEqual([
          "headline",
          "subtitle",
          "seo",
        ]);
      });

      // A declared column-less `Title` takes no column, so `define*` adds its text `title` beside
      // it. The start and the sync that writes the row both judge `define*` output, so the added
      // field stands aside on both and the row takes the new field.
      it("starts a configuration whose column-less field stands beside the system field define* adds", async () => {
        const withColumnlessTitle = defineCollection({
          slug: "posts",
          fields: [
            text({ name: "headline" }),
            { name: "Title", type: "text", virtual: true } as never,
            group({ name: "seo", fields: [text({ name: "fooBar" })] }),
          ],
        });
        expect(
          withColumnlessTitle.fields.map(f => (f as { name: string }).name)
        ).toEqual(["title", "slug", "headline", "Title", "seo"]);

        await boot(withColumnlessTitle);

        expect(await rowNames(database.adapter)).toEqual([
          "headline",
          "Title",
          "seo",
        ]);
      });

      it("accepts the pair the registry row already holds", async () => {
        await rowHolds(database.adapter, posts(["fooBar", "foo_bar"]).fields);

        await boot(WITH_PAIR);

        expect(await rowNames(database.adapter)).toEqual([
          "headline",
          "subtitle",
          "seo",
        ]);
      });
    });

    describe("a configuration reload", () => {
      /** A reload of `collection`, as a saved edit triggers it; answers what it logged as errors. */
      async function reload(
        collection: ReturnType<typeof defineCollection>
      ): Promise<string[]> {
        vi.stubEnv("NODE_ENV", "development");
        loaded.config = defineConfig({ collections: [collection] });
        const error = vi.fn();
        await reloadNextlyConfig({
          resolver: name =>
            name === "logger"
              ? { ...consoleLogger, info: () => {}, warn: () => {}, error }
              : getService(name as Parameters<typeof getService>[0]),
        });
        return error.mock.calls.map(([line]) => String(line));
      }

      it("is refused a new pair, keeping the previous configuration and the row and table as they were", async () => {
        const before = await stateOf(database.adapter, dialect);

        const logged = await reload(WITH_PAIR);

        expect(logged).toContain(
          `[Nextly HMR] FIELD_NAME_DUPLICATE: ${REFUSAL} Keeping the previously-loaded config.`
        );
        expect(await stateOf(database.adapter, dialect)).toEqual(before);

        // The control: the same change without the pair reaches the row.
        expect(await reload(WITHOUT_PAIR)).toEqual([]);
        expect(await rowNames(database.adapter)).toEqual([
          "headline",
          "subtitle",
          "seo",
        ]);
      });

      it("accepts the pair the registry row already holds", async () => {
        await rowHolds(database.adapter, posts(["fooBar", "foo_bar"]).fields);

        expect(await reload(WITH_PAIR)).toEqual([]);
        expect(await rowNames(database.adapter)).toEqual([
          "headline",
          "subtitle",
          "seo",
        ]);
      });
    });
  });
}

describe("sibling fields in configuration — db:sync (sqlite)", () => {
  let dir: string;
  let target: SqliteSyncTarget | undefined;

  const result = (collection: ReturnType<typeof defineCollection>) =>
    ({
      config: defineConfig({ collections: [collection] }),
    }) as unknown as LoadConfigResult;

  const adapterOf = () => target!.adapter as unknown as DrizzleAdapter;

  /** `nextly db:sync` over `collection`; what it threw, if anything. */
  async function dbSync(
    collection: ReturnType<typeof defineCollection>
  ): Promise<unknown> {
    loaded.config = result(collection).config;
    // The command runs in a process of its own, so nothing a start or a reload earlier in this
    // file cached about another database's tables may reach it.
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
    dir = mkdtempSync(join(tmpdir(), "nextly-dbsync-sibling-"));
    vi.stubEnv("DB_DIALECT", "sqlite");
    // The validated environment is cached from its first read, so the command would otherwise
    // connect to whatever database an earlier test configured.
    vi.stubEnv("DATABASE_URL", `file:${join(dir, "test.db")}`);
    _resetEnvCache();
    clearCachedSnapshot();
    target = await openSqliteSyncTarget(dir);
    expect(await dbSync(BEFORE)).toBeUndefined();
    expect(await rowNames(adapterOf())).toEqual(["headline", "seo"]);
  });

  afterEach(async () => {
    await target?.adapter.disconnect();
    target = undefined;
    vi.unstubAllEnvs();
    _resetEnvCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it("is refused a new pair, leaving the registry row and the table as they were", async () => {
    const before = await stateOf(adapterOf(), "sqlite");

    const thrown = await dbSync(WITH_PAIR);

    // The command prints a failure through `describeError`, so that is what the user reads.
    expect(describeError(thrown)).toContain(REFUSAL);
    expect(await stateOf(adapterOf(), "sqlite")).toEqual(before);

    // The control: the same change without the pair reaches the row.
    expect(await dbSync(WITHOUT_PAIR)).toBeUndefined();
    expect(await rowNames(adapterOf())).toEqual([
      "headline",
      "subtitle",
      "seo",
    ]);
  });

  it("--watch is refused a new pair, leaving the registry row and the table as they were", async () => {
    const before = await stateOf(adapterOf(), "sqlite");
    const error = vi.fn();
    const sync = createDebouncedSync(target!.cli, target!.options, {
      ...target!.context,
      logger: { ...target!.context.logger, error },
    });

    sync(result(WITH_PAIR));
    await vi.waitFor(() => expect(error).toHaveBeenCalled(), {
      timeout: 10_000,
    });

    const logged = error.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).toContain(REFUSAL);
    expect(await stateOf(adapterOf(), "sqlite")).toEqual(before);
  });

  it("accepts the pair the registry row already holds", async () => {
    await rowHolds(adapterOf(), posts(["fooBar", "foo_bar"]).fields);

    expect(await dbSync(WITH_PAIR)).toBeUndefined();
    expect(await rowNames(adapterOf())).toEqual([
      "headline",
      "subtitle",
      "seo",
    ]);
  });
});
