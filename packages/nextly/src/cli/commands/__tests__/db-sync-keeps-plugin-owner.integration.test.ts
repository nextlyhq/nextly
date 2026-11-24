/**
 * `nextly db:sync` records a plugin's collection as the plugin's (`plugin:<name>`), as a start and
 * a reload do: on its first run, on every later one, and on each re-sync of its watch.
 *
 * A row recorded as the app's own (`code`) instead reads, once the plugin leaves the configuration,
 * as a collection the app removed from its code, so `--remove-orphaned` deletes its table. The
 * cases run that deletion on a real table, with consent given, beside a collection the app itself
 * removed, which must still go.
 *
 * A row already recorded as `code` is the plugin's again after one run that declares the plugin.
 * One whose plugin has left the configuration cannot be told from the app's own, so it is listed
 * as an orphan until the plugin is configured again.
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
import { defineCollection, defineConfig, text } from "../../../config";
import { CollectionRegistryService } from "../../../domains/collections/services/collection-registry-service";
import {
  CollectionSyncService,
  toCodeFirstCollectionConfig,
} from "../../../domains/collections/services/collection-sync-service";
import { DEMOTED_FROM_CODE } from "../../../domains/schema/pipeline/demoted-from-code";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../init/schema-snapshot-cache";
import { getConfiguredTestDialects } from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { CLIDatabaseAdapter } from "../../utils/adapter";
import type { LoadConfigResult } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runDbSync } from "../db-sync";
import { openCollectionRegistry } from "../db-sync-registry";
import { collectOrphanDeletions } from "../dev-build";
import { createDebouncedSync } from "../dev-watcher";

const PLUGIN = "@test/dkp";
const PLUGIN_SOURCE = `plugin:${PLUGIN}` as const;

/** The collection the plugin contributes, as the loader's configuration holds it. */
const EVENTS = defineCollection({
  slug: "dkp_events",
  fields: [text({ name: "venue" })],
});
const EVENTS_TABLE = "dc_dkp_events";

/** The app's own collection, kept throughout. */
const NOTES = defineCollection({
  slug: "dkp_notes",
  fields: [text({ name: "body" })],
});

/** The app's own collection, removed from its code by some cases. */
const DRAFTS = defineCollection({
  slug: "dkp_drafts",
  fields: [text({ name: "body" })],
});
const DRAFTS_TABLE = "dc_dkp_drafts";

type Declared = ReturnType<typeof defineCollection>;

/** The configuration with the plugin: its collection folded in beside the app's own. */
function withPlugin(...own: Declared[]) {
  return defineConfig({
    collections: [...own, EVENTS],
    plugins: [
      {
        name: PLUGIN,
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { collections: [{ slug: EVENTS.slug }] },
      },
    ] as never,
  });
}

/** The configuration once the plugin is gone. */
function withoutPlugin(...own: Declared[]) {
  return defineConfig({ collections: own });
}

const quiet = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
};

for (const dialect of getConfiguredTestDialects()) {
  describe(`db:sync and a plugin's collection, ${dialect}`, () => {
    let dir: string;
    let drop: () => Promise<void>;
    let adapter: DrizzleAdapter;

    function context(): CommandContext {
      return {
        logger: createLogger({ quiet: true }),
        options: {},
        cwd: dir,
      } as CommandContext;
    }

    const registry = () =>
      new CollectionRegistryService(adapter, quiet as never);

    const record = (slug: string) => registry().getCollectionBySlug(slug);

    /** `nextly db:sync` of `config`; a run that exits fails the case. */
    async function dbSync(
      config: unknown,
      options: Record<string, unknown> = {}
    ): Promise<void> {
      loaded.config = config;
      // The command runs in a process of its own, so nothing cached about the tables as an
      // earlier run left them may reach it.
      clearCachedSnapshot();
      clearLiveSnapshots();
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`db:sync exited ${String(code)}`);
      });
      try {
        await runDbSync(
          { cwd: dir, autoSync: true, ...options } as Parameters<
            typeof runDbSync
          >[0],
          context()
        );
      } finally {
        exit.mockRestore();
      }
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
      await done;
      // The schema lock is released after the seeding returns.
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(errors).toEqual([]);
    }

    /** The plugin's collection as a start records it. */
    async function recordedByAStart(): Promise<void> {
      await registry().syncCodeFirstCollections([
        toCodeFirstCollectionConfig(EVENTS as never, PLUGIN_SOURCE),
      ]);
      expect((await record(EVENTS.slug))?.source).toBe(PLUGIN_SOURCE);
    }

    /** The row as a sync that declared the collection the app's own left it. */
    async function recordedAsTheApps(): Promise<void> {
      await adapter.update(
        "dynamic_collections",
        { source: "code", locked: true },
        { and: [{ column: "slug", op: "=", value: EVENTS.slug }] }
      );
      expect((await record(EVENTS.slug))?.source).toBe("code");
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

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), "nextly-dbsync-plugin-owner-"));
      let url = `file:${join(dir, "test.db")}`;
      drop = async () => {};
      if (dialect !== "sqlite") {
        const scratch = await createScratchDatabase(dialect, "nextly_dkp");
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
    }, 60_000);

    afterEach(async () => {
      vi.restoreAllMocks();
      await adapter.disconnect().catch(() => {});
      await drop();
      vi.unstubAllEnvs();
      _resetEnvCache();
      rmSync(dir, { recursive: true, force: true });
    }, 60_000);

    it("records the collection as the plugin's on its first run, and the app's own as the app's", async () => {
      await dbSync(withPlugin(NOTES));

      expect(await record(EVENTS.slug)).toMatchObject({
        source: PLUGIN_SOURCE,
        locked: true,
      });
      expect(await record(NOTES.slug)).toMatchObject({
        source: "code",
        locked: true,
      });
    }, 120_000);

    it("keeps the owner a start recorded", async () => {
      await dbSync(withPlugin(NOTES));
      await recordedByAStart();

      await dbSync(withPlugin(NOTES));

      expect(await record(EVENTS.slug)).toMatchObject({
        source: PLUGIN_SOURCE,
        locked: true,
      });
    }, 120_000);

    it("keeps it on a re-sync of its watch", async () => {
      await dbSync(withPlugin(NOTES));
      await recordedByAStart();

      await watchedResync(withPlugin(NOTES));

      expect((await record(EVENTS.slug))?.source).toBe(PLUGIN_SOURCE);
    }, 120_000);

    it("plans no change in a dry run to the row a start recorded", async () => {
      await dbSync(withPlugin(NOTES));
      await recordedByAStart();

      const { sync } = await new CollectionSyncService(
        adapter,
        quiet as never
      ).planSync(withPlugin(NOTES) as never);

      expect(sync.updated).toEqual([]);
      expect(sync.created).toEqual([]);
      expect(sync.unchanged).toEqual(
        expect.arrayContaining([EVENTS.slug, NOTES.slug])
      );
    }, 120_000);

    it("keeps the table and row of a plugin that left the configuration from --remove-orphaned, and removes the app's own removed collection", async () => {
      await dbSync(withPlugin(NOTES, DRAFTS));
      await recordedByAStart();
      // The sync a site runs while the plugin is still configured.
      await dbSync(withPlugin(NOTES, DRAFTS));
      expect(await adapter.tableExists(EVENTS_TABLE)).toBe(true);
      expect(await adapter.tableExists(DRAFTS_TABLE)).toBe(true);

      // Then the plugin and one of the app's own collections leave the configuration.
      // Soft, so the run below still shows what the deletion does where the listing is wrong.
      expect
        .soft(await orphanTables(withoutPlugin(NOTES)))
        .toEqual([DRAFTS_TABLE]);
      await dbSync(withoutPlugin(NOTES), {
        removeOrphaned: true,
        acceptDataLoss: true,
      });

      expect(await adapter.tableExists(EVENTS_TABLE)).toBe(true);
      expect((await record(EVENTS.slug))?.source).toBe(PLUGIN_SOURCE);
      expect(await adapter.tableExists(DRAFTS_TABLE)).toBe(false);
      expect(await record(DRAFTS.slug)).toBeNull();
    }, 180_000);

    it("makes a row recorded as the app's own the plugin's again", async () => {
      await dbSync(withPlugin(NOTES));
      await recordedAsTheApps();

      await dbSync(withPlugin(NOTES));

      expect(await record(EVENTS.slug)).toMatchObject({
        source: PLUGIN_SOURCE,
        locked: true,
      });
    }, 120_000);

    it("lists such a row as an orphan once its plugin is gone, until the plugin is configured again", async () => {
      await dbSync(withPlugin(NOTES));
      await recordedAsTheApps();

      // Nothing in the configuration says whose it is, so it reads as the app's removed collection.
      // Without `--remove-orphaned` a sync only names it: its table and row stay.
      await dbSync(withoutPlugin(NOTES));
      expect(await orphanTables(withoutPlugin(NOTES))).toEqual([EVENTS_TABLE]);
      expect(await adapter.tableExists(EVENTS_TABLE)).toBe(true);
      expect((await record(EVENTS.slug))?.source).toBe("code");

      // The plugin back, one sync makes the row its own, and its leaving lists nothing again.
      await dbSync(withPlugin(NOTES));
      expect((await record(EVENTS.slug))?.source).toBe(PLUGIN_SOURCE);
      expect(await orphanTables(withoutPlugin(NOTES))).toEqual([]);
    }, 180_000);

    it("takes the row of a collection handed to the Schema Builder for a plugin that declares its address, as a start does", async () => {
      await dbSync(withoutPlugin(NOTES, EVENTS));
      await registry().updateCollection(
        EVENTS.slug,
        { source: "ui", locked: false },
        { handOver: "builder" }
      );
      expect(await record(EVENTS.slug)).toMatchObject({
        source: "ui",
        configPath: DEMOTED_FROM_CODE,
      });

      await dbSync(withPlugin(NOTES));

      const taken = await record(EVENTS.slug);
      expect(taken).toMatchObject({ source: PLUGIN_SOURCE, locked: true });
      expect(taken?.configPath ?? null).toBeNull();
    }, 120_000);
  });
}
