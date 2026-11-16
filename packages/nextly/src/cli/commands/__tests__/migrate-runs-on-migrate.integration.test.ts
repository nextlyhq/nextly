/**
 * `nextly migrate` runs an installed plugin's `onMigrate` once the run has
 * left nothing pending, after its schema and access steps, on every
 * configured dialect, and runs it nowhere else.
 *
 * The plugin's hook records what it finds when it runs: whether the table of
 * a collection the same run's migration made exists, and whether the
 * permission the same run's access step added is stored. Both being there is
 * the order. It runs for a plugin installed on the database (a lifecycle
 * event recorded as an install records it), and not before: a first deploy's
 * migrate meets the plugin before `nextly plugins install`. A dry run, a
 * `--step` run leaving files pending, `migrate:create`, `migrate:status` and
 * `migrate:check` run it not at all.
 *
 * The database starts empty, and nothing boots against it but the hook's own
 * boot; the commands are driven themselves, with the config handed to the
 * loader rather than read from disk.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { recordPluginLifecycle } from "../../../domains/schema/ownership/plugin-lifecycle-state";
import { NO_PLUGIN_CONSENT } from "../../../plugins/plugin-consent";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCheck } from "../migrate-check";
import { runMigrateCreate } from "../migrate-create";
import { runMigrateStatus } from "../migrate-status";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/** The config the commands load, set before each run, and where it lives. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
  root: "",
}));

/**
 * The config as the loader returns it: the plugins' contributions folded in
 * by the loader's own fold, and the config as written beside it, which the
 * hook's boot starts from.
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
        appConfig: config,
        pluginConsent: NO_PLUGIN_CONSENT,
        projectRoot: loaded.root,
        dependencies: [],
      };
    },
  };
});

/** What the hook saw each time it ran. */
interface Observed {
  applied: number;
  /** Whether the newest collection's table existed. */
  table: boolean;
  /** Whether its read permission was stored. */
  permission: boolean;
}

describe.each(getConfiguredTestDialects())(
  "nextly migrate runs onMigrate (%s)",
  (dialect: TestDialect) => {
    let dir: string;
    let url: string;
    let drop: () => Promise<void>;
    let clock = 0;
    const q = dialect === "mysql" ? "`" : '"';
    const observed: Observed[] = [];
    /** The collection whose table and permission the hook looks for. */
    let newest = "omg_a";

    /** A connection of the test's own to the database the commands set up. */
    async function open(): Promise<DrizzleAdapter> {
      return (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
    }

    const PLUGIN = definePlugin({
      name: "@test/omg",
      version: "1.0.0",
      nextly: "*",
      async onMigrate(_ctx, run) {
        const adapter = await open();
        try {
          const rows = await adapter.executeQuery<{ slug: unknown }>(
            `SELECT ${q}slug${q} AS slug FROM ${q}permissions${q} WHERE ${q}slug${q} = 'read-${newest.replace(/_/g, "-")}'`
          );
          observed.push({
            applied: run.applied,
            table: await adapter.tableExists(`dc_${newest}`),
            permission: rows.length === 1,
          });
        } finally {
          await adapter.disconnect();
        }
      },
    });

    /** The app with the collections named, and the plugin. */
    const configWith = (...slugs: string[]) =>
      defineConfig({
        collections: slugs.map(slug =>
          defineCollection({
            slug: slug.replace(/_/g, "-"),
            dbName: `dc_${slug}`,
            fields: [text({ name: "title" })],
          })
        ),
        plugins: [PLUGIN],
        db: { migrationsDir: "./migrations" },
      });

    beforeEach(async () => {
      observed.length = 0;
      newest = "omg_a";
      dir = mkdtempSync(join(tmpdir(), "nextly-on-migrate-"));
      loaded.root = dir;
      mkdirSync(join(dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(dir, "empty.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(
          dialect,
          "nextly_on_migrate"
        );
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv(
        "NEXTLY_SECRET",
        process.env.NEXTLY_SECRET ??
          "test-secret-must-be-at-least-32-characters-long!!"
      );
      _resetEnvCache();
      // Each migration file is named by the clock.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 14, 12, 0, 0, 0)));
    }, 60_000);

    afterEach(async () => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
      rmSync(dir, { recursive: true, force: true });
    });

    function tick(): void {
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 14, 12, 0, clock, 0)));
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

    async function migrateCreate(name: string, config: unknown): Promise<void> {
      loaded.config = config;
      tick();
      const { context, said } = command();
      setNonInteractive(true);
      const code = await exiting(() =>
        runMigrateCreate(name, { cwd: dir }, context)
      ).finally(() => setNonInteractive(false));
      expect(code, said.join("\n")).toBeUndefined();
    }

    async function migrate(
      config: unknown,
      options: { dryRun?: boolean; step?: number } = {}
    ): Promise<string[]> {
      loaded.config = config;
      tick();
      const { context, said } = command();
      const code = await exiting(() =>
        runMigrate({ cwd: dir, ...options }, context)
      );
      expect(code, said.join("\n")).toBeUndefined();
      return said;
    }

    /** Record the plugin installed on the database, as an install does. */
    async function recordInstalled(): Promise<void> {
      const adapter = await open();
      try {
        await recordPluginLifecycle(
          new SchemaEventsRepository(adapter.getDrizzle(), dialect),
          "@test/omg",
          { state: "installed" }
        );
      } finally {
        await adapter.disconnect();
      }
    }

    it("runs after the run's schema and access steps, for a plugin installed, and not before it is", async () => {
      const first = configWith("omg_a");
      await migrateCreate("first", first);
      // CONTROL: migrate:create made the file and ran no hook.
      expect(observed).toEqual([]);
      const said = await migrate(first);
      // Not installed yet, as on a first deploy before `plugins install`.
      expect(observed).toEqual([]);
      expect(said.join("\n")).toContain(
        "@test/omg: onMigrate not run, as it is not installed on this database"
      );

      await recordInstalled();
      newest = "omg_b";
      const second = configWith("omg_a", "omg_b");
      await migrateCreate("second", second);
      await migrate(second);
      // The run's own migration made omg_b's table, and its access step its
      // permission, before the hook ran.
      expect(observed).toEqual([{ applied: 1, table: true, permission: true }]);

      // Again with nothing to apply: the hook runs, told so.
      await migrate(second);
      expect(observed.at(-1)).toEqual({
        applied: 0,
        table: true,
        permission: true,
      });
    });

    it("runs it in no dry run, no --step run leaving files pending, and no status, check or create", async () => {
      const first = configWith("omg_a");
      await migrateCreate("first", first);
      await migrate(first);
      await recordInstalled();

      const third = configWith("omg_a", "omg_b", "omg_c");
      await migrateCreate("second", configWith("omg_a", "omg_b"));
      await migrateCreate("third", third);
      expect(observed).toEqual([]);

      await migrate(third, { dryRun: true });
      expect(observed).toEqual([]);

      // One of the two pending files: one is left, so no hook.
      await migrate(third, { step: 1 });
      expect(observed).toEqual([]);

      loaded.config = third;
      const { context } = command();
      await exiting(() => runMigrateStatus({ cwd: dir }, context));
      await exiting(() => runMigrateCheck({ cwd: dir }, context));
      expect(observed).toEqual([]);

      // CONTROL: the run that applies the last file runs it.
      newest = "omg_c";
      await migrate(third);
      expect(observed).toEqual([{ applied: 1, table: true, permission: true }]);
    });
  }
);
