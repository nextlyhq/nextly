/**
 * A plugin's Singles and field groups, and the collections under its legacy top-level `collections`
 * key, are recorded as the plugin's (`plugin:<name>`) on every road that writes a registry row: a
 * start, a configuration reload, `nextly db:sync` with its watch, and `nextly migrate`.
 *
 * A row recorded as the app's own (`code`) instead reads, once the plugin leaves the configuration,
 * as an entity the app removed from its code, so `db:sync --remove-orphaned` deletes its table. The
 * cases run that deletion on real tables, with consent given, beside entities the app itself
 * removed, which must still go.
 *
 * A row already recorded as `code` is the plugin's again after one run that declares the plugin;
 * one made in the Schema Builder never moves. One whose plugin has left the configuration cannot be
 * told from the app's own, so it is listed as an orphan until the plugin is configured again.
 *
 * Each case owns its database: a throwaway database on PostgreSQL and MySQL, a temporary file on
 * SQLite.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  defineSingle,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
import { getService } from "../../../di/service-access";
import { CollectionRegistryService } from "../../../domains/collections/services/collection-registry-service";
import { FieldGroupRegistryService } from "../../../domains/field-groups/services/field-group-registry-service";
import {
  siteTypes,
  typesWithoutAddress,
} from "../../../domains/public-addresses/public-address";
import { introspectLiveColumns } from "../../../domains/schema/pipeline/diff/introspect-live";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { SingleRegistryService } from "../../../domains/singles/services/single-registry-service";
import { reloadNextlyConfig } from "../../../init/reload-config";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../init/schema-snapshot-cache";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
} from "../../../plugins/test-nextly";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { _resetEnvCache } from "../../../shared/lib/env";
import { consoleLogger } from "../../../shared/types";
import type { CommandContext } from "../../program";
import type { CLIDatabaseAdapter } from "../../utils/adapter";
import type { LoadConfigResult } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runDbSync } from "../db-sync";
import { openCollectionRegistry } from "../db-sync-registry";
import { collectOrphanDeletions } from "../dev-build";
import { createDebouncedSync } from "../dev-watcher";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

const PLUGIN = "@test/pks";
const PLUGIN_SOURCE = `plugin:${PLUGIN}` as const;

/** The app's own collection, kept throughout. */
const NOTES = defineCollection({
  slug: "pks_notes",
  fields: [text({ name: "body" })],
});
/** What the plugin contributes, as the loader's configuration holds it. */
const EVENTS = defineCollection({
  slug: "pks_events",
  fields: [text({ name: "venue" })],
});
const SETTINGS = defineSingle({
  slug: "pks_settings",
  fields: [text({ name: "brand" })],
});
const HERO = defineFieldGroup({
  slug: "pks_hero",
  fields: [text({ name: "heading" })],
});
/** The app's own Single and field group, removed from its code by some cases. */
const APP_SINGLE = defineSingle({
  slug: "pks_app_single",
  fields: [text({ name: "brand" })],
});
const APP_GROUP = defineFieldGroup({
  slug: "pks_app_group",
  fields: [text({ name: "heading" })],
});

const SETTINGS_TABLE = "single_pks_settings";
const HERO_TABLE = "comp_pks_hero";
const APP_SINGLE_TABLE = "single_pks_app_single";
const APP_GROUP_TABLE = "comp_pks_app_group";
const EVENTS_TABLE = "dc_pks_events";

/** The plugin, as the loader's configuration holds it beside the entities it folded in. */
const THE_PLUGIN = {
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    collections: [{ slug: EVENTS.slug }],
    singles: [{ slug: SETTINGS.slug }],
    fieldGroups: [{ slug: HERO.slug }],
  },
};

/** The configuration with the plugin, its entities folded in beside the app's own. */
function withPlugin(plugin: unknown = THE_PLUGIN) {
  return defineConfig({
    collections: [NOTES, EVENTS],
    singles: [SETTINGS, APP_SINGLE],
    fieldGroups: [HERO, APP_GROUP],
    plugins: [plugin] as never,
  });
}

/** The configuration once the plugin, and the app's own Single and field group, are gone. */
function withoutPlugin() {
  return defineConfig({ collections: [NOTES] });
}

/** What each entity of {@link withPlugin} is recorded as. */
const RECORDED = {
  [NOTES.slug]: "code",
  [EVENTS.slug]: PLUGIN_SOURCE,
  [SETTINGS.slug]: PLUGIN_SOURCE,
  [APP_SINGLE.slug]: "code",
  [HERO.slug]: PLUGIN_SOURCE,
  [APP_GROUP.slug]: "code",
};

const quiet = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
};

for (const dialect of getConfiguredTestDialects()) {
  describe(`a plugin's Singles and field groups keep their owner (${dialect})`, () => {
    let dir: string;
    let drop: () => Promise<void>;
    let adapter: DrizzleAdapter;
    /** Closes the case's connection; nothing to close until one is open. */
    let close: () => Promise<void>;

    function context(): CommandContext {
      return {
        logger: createLogger({ quiet: true }),
        options: {},
        cwd: dir,
      } as CommandContext;
    }

    const singles = () => new SingleRegistryService(adapter, quiet as never);
    const fieldGroups = () =>
      new FieldGroupRegistryService(adapter, quiet as never);

    /** Each registry row's owner by slug; every row code or a plugin owns must be locked. */
    async function owners(): Promise<Record<string, string>> {
      const rows = [
        ...(await new CollectionRegistryService(
          adapter,
          quiet as never
        ).getAllCollections()),
        ...(await singles().getAllSingles()),
        ...(await fieldGroups().getAllComponents()),
      ];
      const unlocked = rows
        .filter(row => row.source !== "ui" && row.locked !== true)
        .map(row => row.slug);
      expect(unlocked).toEqual([]);
      return Object.fromEntries(rows.map(row => [row.slug, row.source ?? ""]));
    }

    /** `nextly db:sync` of `config`, answering what it said; a run that exits fails the case. */
    async function dbSync(
      config: unknown,
      options: Record<string, unknown> = {}
    ): Promise<string> {
      loaded.config = config;
      // The command runs in a process of its own, so nothing cached about the tables as an
      // earlier run left them may reach it.
      clearCachedSnapshot();
      clearLiveSnapshots();
      const said: string[] = [];
      const say = (message: string) => {
        said.push(message);
      };
      const base = context();
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`db:sync exited ${String(code)}`);
      });
      try {
        await runDbSync(
          { cwd: dir, autoSync: true, ...options } as Parameters<
            typeof runDbSync
          >[0],
          {
            ...base,
            logger: { ...base.logger, info: say, warn: say, item: say },
          }
        );
      } finally {
        exit.mockRestore();
      }
      return said.join("\n");
    }

    /** One re-sync of `nextly db:sync --watch` for a saved `config`. */
    async function watchedResync(config: unknown): Promise<void> {
      clearCachedSnapshot();
      clearLiveSnapshots();
      const errors: string[] = [];
      let finished!: () => void;
      const done = new Promise<void>(resolve => {
        finished = resolve;
      });
      const base = context();
      const logger = {
        ...base.logger,
        error: (message: string) => {
          errors.push(message);
          finished();
        },
        // The last step of a re-sync.
        success: (message: string) => {
          if (message.startsWith("Permissions:")) finished();
        },
      };
      createDebouncedSync(
        adapter as unknown as CLIDatabaseAdapter,
        { cwd: dir, autoSync: true } as Parameters<
          typeof createDebouncedSync
        >[1],
        { ...base, logger }
      )({ config, dependencies: [] } as unknown as LoadConfigResult);
      // Bounded, so a re-sync that ends without either line fails naming what is missing.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("the re-sync neither finished nor failed")),
          60_000
        );
      });
      await Promise.race([done, timedOut]).finally(() => clearTimeout(timer));
      // The schema lock is released after the seeding returns.
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(errors).toEqual([]);
    }

    /** The tables `--remove-orphaned` would delete for `config`. */
    async function orphanTables(config: unknown): Promise<string[]> {
      const deletions = await collectOrphanDeletions(
        { config } as unknown as LoadConfigResult,
        adapter as unknown as CLIDatabaseAdapter,
        createLogger({ quiet: true })
      );
      return deletions.flatMap(deletion =>
        deletion.kind === "table" ? [deletion.table] : []
      );
    }

    /** The rows as a sync that declared the plugin's entities the app's own left them. */
    async function recordedAsTheApps(): Promise<void> {
      for (const [registry, slug] of [
        ["dynamic_singles", SETTINGS.slug],
        [STORAGE_FORMAT.registryTable, HERO.slug],
      ]) {
        await adapter.update(
          registry,
          { source: "code", locked: true },
          { and: [{ column: "slug", op: "=", value: slug }] }
        );
      }
      expect(await owners()).toMatchObject({
        [SETTINGS.slug]: "code",
        [HERO.slug]: "code",
      });
    }

    /** A start of an app with `plugins`, on a connection of its own, closed after. */
    async function start(
      plugins: readonly unknown[],
      during: (
        handle: Awaited<ReturnType<typeof createTestNextly>>
      ) => Promise<void> = async () => {},
      own: Record<string, unknown> = {
        singles: [APP_SINGLE],
        fieldGroups: [APP_GROUP],
      }
    ): Promise<void> {
      const connection = (await createAdapter({
        type: dialect,
        url: process.env.DATABASE_URL,
      } as never)) as unknown as DrizzleAdapter;
      clearServices();
      try {
        const handle = await createTestNextly({
          adapter: connection as never,
          collections: [NOTES],
          ...own,
          plugins: plugins as never,
          basePath: dir,
        } as never);
        await during(handle);
      } finally {
        await shutdownServices().catch(() => {});
        clearServices();
        await connection.disconnect().catch(() => {});
      }
    }

    /** A start with no plugin, then a reload of `config`. */
    async function reload(config: unknown): Promise<void> {
      await start([], async () => {
        vi.stubEnv("NODE_ENV", "development");
        loaded.config = config;
        await reloadNextlyConfig({
          resolver: name =>
            name === "logger"
              ? { ...consoleLogger, ...quiet }
              : getService(name as never),
        });
      });
    }

    /** The plugin as an app's code lists it, for a start to fold. */
    const asWritten = () =>
      definePlugin({
        name: PLUGIN,
        version: "1.0.0",
        nextly: "*",
        contributes: {
          collections: [EVENTS],
          singles: [SETTINGS],
          fieldGroups: [HERO],
        },
      } as never);

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), "nextly-plugin-owner-"));
      let url = `file:${join(dir, "test.db")}`;
      drop = async () => {};
      close = async () => {};
      if (dialect !== "sqlite") {
        const scratch = await createScratchDatabase(dialect, "nextly_pks");
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
      close = () => opened.adapter.disconnect();
    }, 60_000);

    afterEach(async () => {
      vi.restoreAllMocks();
      try {
        await close().catch(() => {});
        await drop();
      } finally {
        vi.unstubAllEnvs();
        _resetEnvCache();
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);

    describe("recorded as the plugin's", () => {
      it("by db:sync, on its first run and on a later one", async () => {
        await dbSync(withPlugin());
        expect(await owners()).toEqual(RECORDED);

        await dbSync(withPlugin());
        expect(await owners()).toEqual(RECORDED);
      }, 180_000);

      it("by a re-sync of db:sync's watch", async () => {
        await dbSync(defineConfig({ collections: [NOTES] }));
        await watchedResync(withPlugin());

        expect(await owners()).toEqual(RECORDED);
      }, 180_000);

      it("by a start", async () => {
        await start([asWritten()]);

        expect(await owners()).toEqual(RECORDED);
      }, 180_000);

      it("by a configuration reload", async () => {
        await reload(withPlugin());

        expect(await owners()).toEqual(RECORDED);
      }, 180_000);

      it("by a migration that creates them", async () => {
        mkdirSync(join(dir, "migrations"));
        loaded.config = {
          ...withPlugin(),
          db: { ...withPlugin().db, migrationsDir: "./migrations" },
        };
        setNonInteractive(true);
        try {
          await runMigrateCreate("one", { cwd: dir } as never, context());
          await runMigrate(
            { cwd: dir, throwOnFailure: true } as never,
            context()
          );
        } finally {
          setNonInteractive(false);
        }

        expect(await owners()).toEqual(RECORDED);
      }, 240_000);

      it("by the slug the host renamed each to, and not by the one it vacated", async () => {
        const renamed = {
          ...THE_PLUGIN,
          renameMap: {
            pks_prefs: SETTINGS.slug,
            [APP_GROUP.slug]: HERO.slug,
          },
          contributes: {
            collections: [{ slug: EVENTS.slug }],
            singles: [{ slug: "pks_prefs" }],
            fieldGroups: [{ slug: APP_GROUP.slug }],
          },
        };
        await dbSync(withPlugin(renamed));

        expect(await owners()).toEqual(RECORDED);
      }, 180_000);
    });

    it("keeps them, named as the plugin's, from --remove-orphaned once the plugin leaves, and removes the app's own", async () => {
      await dbSync(withPlugin());
      await adapter.executeQuery(
        `INSERT INTO ${SETTINGS_TABLE} (id, title, slug, brand) VALUES ('pks-1', 'Settings', '${SETTINGS.slug}', 'Kept')`
      );

      // A plain sync deletes nothing, and tells the plugin's from the app's. The app's Single and
      // field group leave in this one edit: on MySQL that is what reaches the transaction escape
      // `transaction-escape-baseline` names this file as the witness of.
      const said = await dbSync(withoutPlugin());
      expect.soft(said).toContain("1 orphaned single(s) in database:");
      expect.soft(said).toContain("1 orphaned component(s) in database:");
      expect.soft(said).toContain(`${SETTINGS.slug} (${PLUGIN})`);
      expect.soft(said).toContain(`${HERO.slug} (${PLUGIN})`);
      expect.soft(said).toContain(`${EVENTS.slug} (${PLUGIN})`);

      // Soft, so the run below still shows what the deletion does where the listing is wrong.
      expect
        .soft((await orphanTables(withoutPlugin())).sort())
        .toEqual([APP_GROUP_TABLE, APP_SINGLE_TABLE].sort());
      await dbSync(withoutPlugin(), {
        removeOrphaned: true,
        acceptDataLoss: true,
      });

      expect(
        await adapter.executeQuery(`SELECT brand FROM ${SETTINGS_TABLE}`)
      ).toEqual([{ brand: "Kept" }]);
      expect(await adapter.tableExists(HERO_TABLE)).toBe(true);
      expect(await adapter.tableExists(EVENTS_TABLE)).toBe(true);
      expect(await adapter.tableExists(APP_SINGLE_TABLE)).toBe(false);
      expect(await adapter.tableExists(APP_GROUP_TABLE)).toBe(false);
      expect(await owners()).toEqual({
        [NOTES.slug]: "code",
        [EVENTS.slug]: PLUGIN_SOURCE,
        [SETTINGS.slug]: PLUGIN_SOURCE,
        [HERO.slug]: PLUGIN_SOURCE,
      });
    }, 240_000);

    it("names the migration that drops them, and never prune, on a site that keeps migration files", async () => {
      const site = (config: ReturnType<typeof defineConfig>) => ({
        ...config,
        db: { ...config.db, migrationsDir: "./migrations" },
      });
      mkdirSync(join(dir, "migrations"));
      // An empty folder is no migration: the site applies its schema directly.
      await dbSync(site(withPlugin()));
      expect(await dbSync(site(withoutPlugin()))).toContain("nextly prune");

      loaded.config = site(withPlugin());
      setNonInteractive(true);
      try {
        await runMigrateCreate("one", { cwd: dir } as never, context());
      } finally {
        setNonInteractive(false);
      }
      const said = await dbSync(site(withoutPlugin()));
      expect(said).toContain("nextly migrate:create");
      expect(said).not.toContain("nextly prune");
      expect(said).toContain(`${SETTINGS.slug} (${PLUGIN})`);
    }, 240_000);

    it("takes writes to a departed plugin's Single, as to its collection, and refuses them to one the app removed", async () => {
      await start([asWritten()]);

      await start(
        [],
        async ({ nextly }) => {
          const write = (slug: string) =>
            nextly.updateSingle({
              slug: slug as never,
              data: { brand: "Changed", _overwrite: true } as never,
            });
          await write(SETTINGS.slug);
          expect(
            await nextly.findSingle({ slug: SETTINGS.slug as never })
          ).toMatchObject({ brand: "Changed" });
          await expect(write(APP_SINGLE.slug)).rejects.toThrow(/code/i);
        },
        { singles: [], fieldGroups: [] }
      );
    }, 180_000);

    it("adds no translated column to a departed plugin's tables on a reload", async () => {
      const localization = { locales: ["en", "fr"], defaultLocale: "en" };
      const fields = [text({ name: "heading" }), text({ name: "tagline" })];
      const translated = definePlugin({
        name: PLUGIN,
        version: "1.0.0",
        nextly: "*",
        contributes: {
          singles: [
            defineSingle({ slug: SETTINGS.slug, localized: true, fields }),
          ],
          fieldGroups: [
            defineFieldGroup({ slug: HERO.slug, localized: true, fields }),
          ],
        },
      } as never);
      /** Each of the plugin's main tables, by the columns it has. */
      const columns = async () =>
        Object.fromEntries(
          (
            await introspectLiveColumns(adapter.getDrizzle(), dialect, [
              SETTINGS_TABLE,
              HERO_TABLE,
            ])
          ).tables.map(table => [
            table.name,
            table.columns.map(column => column.name).sort(),
          ])
        );

      await start(
        [translated],
        async () => {
          const before = await columns();
          expect(Object.values(before).flat()).not.toContain("tagline");
          vi.stubEnv("NODE_ENV", "development");
          // The plugin leaves, and the app's collection changes in the same edit, so the reload
          // has a schema change to apply.
          loaded.config = defineConfig({
            localization,
            collections: [
              defineCollection({
                slug: NOTES.slug,
                fields: [text({ name: "body" }), text({ name: "more" })],
              }),
            ],
          } as never);
          clearCachedSnapshot();
          clearLiveSnapshots();
          await reloadNextlyConfig({
            resolver: name =>
              name === "logger"
                ? { ...consoleLogger, ...quiet }
                : getService(name as never),
          });
          expect(await columns()).toEqual(before);
        },
        { localization }
      );
    }, 180_000);

    it("keeps a plugin's Single among the site's content types, its address with it, and its collection out of them", async () => {
      const landing = defineSingle({
        slug: "pks_landing",
        publicAddress: "/landing",
        fields: [text({ name: "brand" })],
      });
      const plugin = definePlugin({
        name: PLUGIN,
        version: "1.0.0",
        nextly: "*",
        contributes: { collections: [EVENTS], singles: [SETTINGS, landing] },
      } as never);
      await start([plugin], async () => {
        expect(await owners()).toMatchObject({
          [SETTINGS.slug]: PLUGIN_SOURCE,
          [landing.slug]: PLUGIN_SOURCE,
        });
        const listed = (await siteTypes()).map(({ type }) => type.slug);
        expect(listed).toEqual(
          expect.arrayContaining([
            NOTES.slug,
            APP_SINGLE.slug,
            SETTINGS.slug,
            landing.slug,
          ])
        );
        expect(listed).not.toContain(EVENTS.slug);
        // So one with no address of its own is still told from one with it.
        const without = (await typesWithoutAddress()).map(({ slug }) => slug);
        expect(without).toContain(SETTINGS.slug);
        expect(without).not.toContain(landing.slug);
      });
    }, 180_000);

    describe("a row recorded as the app's own", () => {
      it("is the plugin's again after one db:sync", async () => {
        await dbSync(withPlugin());
        await recordedAsTheApps();

        await dbSync(withPlugin());

        expect(await owners()).toEqual(RECORDED);
      }, 180_000);

      it("is the plugin's again after one start", async () => {
        await start([asWritten()]);
        await recordedAsTheApps();

        await start([asWritten()]);

        expect(await owners()).toEqual(RECORDED);
      }, 180_000);

      it("is the plugin's again after one reload", async () => {
        await dbSync(withPlugin());
        await recordedAsTheApps();

        await reload(withPlugin());

        expect(await owners()).toEqual(RECORDED);
      }, 180_000);

      it("is listed as an orphan once its plugin is gone, until the plugin is configured again", async () => {
        await dbSync(withPlugin());
        await recordedAsTheApps();

        // Nothing in the configuration says whose they are, so they read as the app's removed ones.
        expect(await orphanTables(withoutPlugin())).toEqual(
          expect.arrayContaining([SETTINGS_TABLE, HERO_TABLE])
        );
        expect(await adapter.tableExists(SETTINGS_TABLE)).toBe(true);

        // The plugin back, one sync makes the rows its own, and its leaving lists nothing of it.
        await dbSync(withPlugin());
        expect((await orphanTables(withoutPlugin())).sort()).toEqual(
          [APP_GROUP_TABLE, APP_SINGLE_TABLE].sort()
        );
      }, 240_000);
    });

    it("leaves a Single and a field group made in the Schema Builder the Builder's, under a plugin's declaration", async () => {
      await dbSync(withPlugin());
      for (const [registry, slug] of [
        ["dynamic_singles", SETTINGS.slug],
        [STORAGE_FORMAT.registryTable, HERO.slug],
      ]) {
        await adapter.update(
          registry,
          { source: "ui" },
          { and: [{ column: "slug", op: "=", value: slug }] }
        );
      }

      await dbSync(withPlugin());

      expect(await owners()).toMatchObject({
        [SETTINGS.slug]: "ui",
        [HERO.slug]: "ui",
      });
    }, 180_000);

    it("records a collection under a plugin's legacy `collections` key as the plugin's, heals it, and keeps its table from --remove-orphaned", async () => {
      const legacy = {
        name: PLUGIN,
        version: "1.0.0",
        nextly: ">=0.0.0",
        collections: [EVENTS],
      };
      const config = () =>
        defineConfig({
          collections: [NOTES, EVENTS],
          plugins: [legacy] as never,
        });
      await dbSync(config());
      expect.soft((await owners())[EVENTS.slug]).toBe(PLUGIN_SOURCE);

      await adapter.update(
        "dynamic_collections",
        { source: "code", locked: true },
        { and: [{ column: "slug", op: "=", value: EVENTS.slug }] }
      );
      await dbSync(config());
      expect.soft((await owners())[EVENTS.slug]).toBe(PLUGIN_SOURCE);

      await dbSync(withoutPlugin(), {
        removeOrphaned: true,
        acceptDataLoss: true,
      });
      expect(await adapter.tableExists(EVENTS_TABLE)).toBe(true);
    }, 240_000);
  });
}
