/**
 * What a collection `nextly db:sync --demote` hands to the Schema Builder keeps:
 *
 * - **Its unique indexes.** The Builder's record holds no index declared in `indexes`, so a demote
 *   that would lose a unique one is refused: nothing is written, and the live index goes on
 *   refusing a duplicate. Taken out of `indexes` first, the demote goes ahead.
 * - **The app's schema hooks on its table**, while its entry is still in the configuration. A hook
 *   is compiled against the Builder's record, not the ignored entry: one on a field the Builder
 *   added is applied, and one on a field the Builder removed is refused, naming it, with nothing
 *   changed. So on `nextly db:sync`, its dry run and a reload. A development start does the first
 *   too, and over the second warns and goes on as the code entry has it, so a Builder save cannot
 *   leave the admin unreachable.
 *
 * Each case owns its database: a throwaway database on PostgreSQL and MySQL, a temporary file on
 * SQLite.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the config file says now: what `loadConfig` returns for it. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
}));

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { defineCollection, defineConfig, number, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
import { getService } from "../../../di/service-access";
import { CollectionRegistryService } from "../../../domains/collections/services/collection-registry-service";
import {
  activeExtensionSchema,
  clearActiveExtensionSchema,
} from "../../../domains/schema/extension/active-schema";
import type { SchemaHook } from "../../../domains/schema/extension/draft";
import { DEMOTED_FROM_CODE } from "../../../domains/schema/pipeline/demoted-from-code";
import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";
import { calculateSchemaHash } from "../../../domains/schema/services/schema-hash";
import { reloadNextlyConfig } from "../../../init/reload-config";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../init/schema-snapshot-cache";
import {
  createTestNextly,
  getConfiguredTestDialects,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { consoleLogger } from "../../../shared/types";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import type { CLIDatabaseAdapter } from "../../utils/adapter";
import type { LoadConfigResult } from "../../utils/config-loader";
import { runDbSync } from "../db-sync";
import { demoteCollection } from "../db-sync-demote";
import { planDbSync } from "../db-sync-dry-run";
import { openCollectionRegistry } from "../db-sync-registry";

const TABLE = "dc_hoi_posts";

/** Two fields an index can stand on wherever it runs: short, and on the collection's own row. */
const FIELDS = [
  text({ name: "tenant", localized: false, validation: { maxLength: 60 } }),
  number({ name: "code", localized: false }),
];

/** The collection as code declares it, with `indexes`. */
function posts(indexes?: { fields: string[]; unique?: boolean }[]) {
  return defineCollection({
    slug: "hoi_posts",
    fields: FIELDS,
    ...(indexes === undefined ? {} : { indexes }),
  });
}

const UNIQUE = [{ fields: ["tenant", "code"], unique: true }];

/** The app's hook: an index on each of `columns` of the collection's table. */
function indexing(...columns: string[]): SchemaHook {
  return ({ schema }) => {
    schema.extendTable(TABLE, {
      indexes: columns.map(column => ({ columns: [column] })),
    });
  };
}

const quiet = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
};

for (const dialect of getConfiguredTestDialects()) {
  describe(`a collection handed to the Schema Builder, ${dialect}`, () => {
    let dir: string;
    let url: string;
    let drop: () => Promise<void>;
    let adapter: DrizzleAdapter;
    const connections: DrizzleAdapter[] = [];

    function context(): CommandContext {
      return {
        logger: createLogger({ quiet: true }),
        options: {},
        cwd: dir,
      } as CommandContext;
    }

    function configOf(
      collection: ReturnType<typeof defineCollection>,
      hook?: SchemaHook
    ) {
      return defineConfig({
        collections: [collection],
        ...(hook === undefined ? {} : { db: { schema: { extend: [hook] } } }),
      });
    }

    function freshProcess(): void {
      clearCachedSnapshot();
      clearLiveSnapshots();
      clearActiveExtensionSchema();
    }

    /** `nextly db:sync` of `config`; a run that exits rejects. */
    async function dbSync(config: unknown): Promise<void> {
      loaded.config = config;
      freshProcess();
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`db:sync exited ${String(code)}`);
      });
      try {
        await runDbSync(
          { cwd: dir, autoSync: true } as Parameters<typeof runDbSync>[0],
          context()
        );
      } finally {
        exit.mockRestore();
      }
    }

    const registry = () =>
      new CollectionRegistryService(adapter, quiet as never);

    const record = () => registry().getCollectionBySlug("hoi_posts");

    async function demote(
      collection: ReturnType<typeof defineCollection>
    ): Promise<string> {
      return demoteCollection({
        collection: collection as never,
        logger: createLogger({ quiet: true }),
        registry: registry(),
        adapter,
        confirm: async () => true,
      });
    }

    /** A Schema Builder save of the collection's fields, as it writes the record. */
    async function builderSaves(
      change: (fields: { name?: string }[]) => unknown[]
    ): Promise<void> {
      const held = await record();
      const fields = change(
        (held?.fields ?? []) as { name?: string }[]
      ) as never;
      await registry().updateCollection("hoi_posts", {
        fields,
        schemaHash: calculateSchemaHash(fields),
      });
    }

    /** The Builder adds `rank`. */
    const addsRank = () =>
      builderSaves(fields => [...fields, { name: "rank", type: "number" }]);

    async function live() {
      const found = await introspectLiveSnapshot(
        adapter.getDrizzle(),
        dialect,
        [TABLE]
      );
      return found.tables[0];
    }

    /** The columns of each index the live table has. */
    async function liveIndexes(): Promise<string[]> {
      return ((await live())?.indexes ?? []).map(index =>
        index.columns.join(",")
      );
    }

    async function insert(id: string, slug: string): Promise<void> {
      const table =
        adapter.getCapabilities().dialect === "mysql"
          ? `\`${TABLE}\``
          : `"${TABLE}"`;
      await adapter.executeQuery(
        `INSERT INTO ${table} (id, title, slug, tenant, code) VALUES ('${id}', 'T', '${slug}', 'acme', 1)`
      );
    }

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), "nextly-handed-over-"));
      url = `file:${join(dir, "test.db")}`;
      drop = async () => {};
      if (dialect !== "sqlite") {
        const scratch = await createScratchDatabase(dialect, "nextly_hoi");
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      vi.spyOn(process, "cwd").mockReturnValue(dir);
      const opened = await openCollectionRegistry(
        createLogger({ quiet: true })
      );
      if (opened === undefined) throw new Error("the database is not there");
      adapter = opened.adapter;
      connections.push(adapter);
      clearServices();
    }, 60_000);

    afterEach(async () => {
      vi.restoreAllMocks();
      try {
        await shutdownServices().catch(() => {});
        clearServices();
        clearActiveExtensionSchema();
        for (const open of connections.splice(0)) {
          await open.disconnect().catch(() => {});
        }
        await drop();
      } finally {
        vi.unstubAllEnvs();
        _resetEnvCache();
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);

    describe("with a unique index declared in `indexes`", () => {
      it("is not demoted, and the index goes on refusing a duplicate", async () => {
        await dbSync(configOf(posts(UNIQUE)));
        expect(await liveIndexes()).toContain("tenant,code");

        await expect(demote(posts(UNIQUE))).rejects.toMatchObject({
          code: "DEMOTE_LOSES_UNIQUE_INDEX",
        });

        expect(await record()).toMatchObject({ source: "code", locked: true });
        await dbSync(configOf(posts(UNIQUE)));
        expect(await liveIndexes()).toContain("tenant,code");
        await insert("1", "one");
        await expect(insert("2", "two")).rejects.toThrow();
      }, 180_000);

      it("is demoted once the index is taken out of `indexes`", async () => {
        await dbSync(configOf(posts(UNIQUE)));
        expect(await demote(posts())).toBe("demoted");
        expect(await record()).toMatchObject({
          source: "ui",
          configPath: DEMOTED_FROM_CODE,
        });
      }, 120_000);
    });

    describe("with a schema hook of the app's on its table", () => {
      beforeEach(async () => {
        await dbSync(configOf(posts()));
        expect(await demote(posts())).toBe("demoted");
      }, 120_000);

      it("applies a hook on a field the Builder added (db:sync)", async () => {
        await addsRank();

        await dbSync(configOf(posts(), indexing("rank")));

        expect(await liveIndexes()).toContain("rank");
      }, 120_000);

      it("plans it in a dry run, refusing nothing", async () => {
        await addsRank();
        loaded.config = configOf(posts(), indexing("rank"));
        freshProcess();

        const plan = await planDbSync(
          {
            config: loaded.config,
            dependencies: [],
          } as unknown as LoadConfigResult,
          adapter as unknown as CLIDatabaseAdapter,
          { cwd: dir, autoSync: true } as Parameters<typeof planDbSync>[2],
          context()
        );

        expect(plan.refusals ?? []).toEqual([]);
        expect(JSON.stringify(plan.changes)).toContain("rank");
      }, 120_000);

      it("refuses a hook on a field the Builder removed, naming it, with nothing changed (db:sync)", async () => {
        await builderSaves(fields =>
          fields.filter(field => field.name !== "code")
        );
        const before = (await live())?.columns.map(column => column.name);

        const refused = await dbSync(configOf(posts(), indexing("code"))).then(
          () => undefined,
          (error: unknown) => error
        );

        // Compiled and pushed, the run would end without a refusal.
        expect(refused).toBeDefined();
        expect(
          JSON.stringify((refused as { publicData?: unknown })?.publicData)
        ).toContain('names the column \\"code\\"');
        expect((await live())?.columns.map(column => column.name)).toEqual(
          before
        );
      }, 120_000);

      it("starts with a hook on a field the Builder added", async () => {
        await addsRank();
        const own = (await createAdapter({
          type: dialect,
          url,
        } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
        connections.push(own);
        freshProcess();

        await createTestNextly({
          adapter: own as never,
          collections: [posts()],
          db: {
            migrationsDir: "./migrations",
            uiSchemaFile: "./ui-schema.json",
            schema: { extend: [indexing("rank")] },
          },
          basePath: dir,
        });

        expect(
          activeExtensionSchema()
            ?.entityIndexes.get(TABLE)
            ?.map(index => index.columns)
        ).toEqual([["rank"]]);
      }, 120_000);

      it("starts with a warning over a hook on a field the Builder removed", async () => {
        await builderSaves(fields =>
          fields.filter(field => field.name !== "code")
        );
        const own = (await createAdapter({
          type: dialect,
          url,
        } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
        connections.push(own);
        freshProcess();
        const warnings: string[] = [];

        await createTestNextly({
          adapter: own as never,
          collections: [posts()],
          db: {
            migrationsDir: "./migrations",
            uiSchemaFile: "./ui-schema.json",
            schema: { extend: [indexing("code")] },
          },
          basePath: dir,
          logger: {
            ...quiet,
            warn: (message: string) => warnings.push(message),
          } as never,
        });

        const warned = warnings.filter(line => line.includes("schema hook"));
        expect(warned).toHaveLength(1);
        expect(warned[0]).toContain("hoi_posts");
        expect(warned[0]).toContain('names the column "code"');
      }, 120_000);

      it("starts with a warning where hooks name a field the Builder added and one it removed", async () => {
        // Neither the record nor the code entry has both fields.
        await addsRank();
        await builderSaves(fields =>
          fields.filter(field => field.name !== "code")
        );
        const own = (await createAdapter({
          type: dialect,
          url,
        } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
        connections.push(own);
        freshProcess();
        const warnings: string[] = [];

        await createTestNextly({
          adapter: own as never,
          collections: [posts()],
          db: {
            migrationsDir: "./migrations",
            uiSchemaFile: "./ui-schema.json",
            schema: { extend: [indexing("rank", "code")] },
          },
          basePath: dir,
          logger: {
            ...quiet,
            warn: (message: string) => warnings.push(message),
          } as never,
        });

        expect(
          warnings.filter(
            line =>
              line.includes("schema hook") &&
              line.includes('names the column "code"')
          )
        ).toHaveLength(1);
        expect(
          activeExtensionSchema()
            ?.entityIndexes.get(TABLE)
            ?.map(index => index.columns)
        ).toEqual([["rank"], ["code"]]);
      }, 120_000);

      it("still refuses to start over a hook on a field neither has", async () => {
        const own = (await createAdapter({
          type: dialect,
          url,
        } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
        connections.push(own);
        freshProcess();

        await expect(
          createTestNextly({
            adapter: own as never,
            collections: [posts()],
            db: {
              migrationsDir: "./migrations",
              uiSchemaFile: "./ui-schema.json",
              schema: { extend: [indexing("nowhere")] },
            },
            basePath: dir,
          })
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      }, 120_000);

      it("reloads with a hook added on a field the Builder added", async () => {
        await addsRank();
        await dbSync(configOf(posts()));
        const own = (await createAdapter({
          type: dialect,
          url,
        } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
        connections.push(own);
        freshProcess();
        loaded.config = configOf(posts());
        await createTestNextly({
          adapter: own as never,
          collections: [posts()],
          basePath: dir,
        });
        const errors: string[] = [];
        vi.stubEnv("NODE_ENV", "development");
        loaded.config = configOf(posts(), indexing("rank"));

        await reloadNextlyConfig({
          resolver: name =>
            name === "logger"
              ? {
                  ...consoleLogger,
                  ...quiet,
                  error: (message: string) => errors.push(message),
                }
              : getService(name as Parameters<typeof getService>[0]),
        });

        expect(errors).toEqual([]);
        expect(
          activeExtensionSchema()
            ?.entityIndexes.get(TABLE)
            ?.map(index => index.columns)
        ).toEqual([["rank"]]);
      }, 120_000);
    });
  });
}
