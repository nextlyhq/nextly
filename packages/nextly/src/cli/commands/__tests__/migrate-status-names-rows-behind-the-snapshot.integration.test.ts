/**
 * `nextly migrate:status` names every registry row that differs from the
 * newest applied migration's record of it, on every configured dialect, and
 * says to run `nextly migrate`, which brings each back.
 *
 * Such a row is what a production start of an earlier release leaves behind
 * during a deploy: that release wrote every row from its own configuration at
 * each start, so a start of the previous deployment, still serving while the
 * new one built, rewrote the rows the new deployment's `nextly migrate` had
 * just written. Here a plugin adds a group to a collection and a Single
 * through `extend`, the project is migrated, and then, behind the registry's
 * back, the collection's row is written without the group (a row that partly
 * matches: every other field is as recorded) and the Single's row is
 * removed. A third collection is left as migrated, the negative control.
 *
 * A production start of this release, which writes no row, names the
 * collection's row too, from the rows it reads anyway, with the same command.
 *
 * The commands are driven themselves (`runMigrateCreate`, `runMigrate`,
 * `runPluginInstallAll`, `runMigrateStatus`) against a project folder and a
 * database of the test's own; only the config file is not read from disk.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import {
  defineCollection,
  defineConfig,
  defineSingle,
  group,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { shutdownServices } from "../../../di/register";
import { CollectionRegistryService } from "../../../domains/collections/services/collection-registry-service";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { getNextly, shutdownNextly, startSettled } from "../../../init";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { sanitizeConfig } from "../../../shared/types/config";
import type { CommandContext } from "../../program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { installRegistryResolver } from "../../utils/registry-resolver";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";
import { runMigrateStatus } from "../migrate-status";
import { runPluginInstallAll } from "../plugin-lifecycle-runner";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/** The config the commands load, and the folder they run in. */
const state = vi.hoisted(() => ({ config: undefined as unknown, dir: "" }));

// As the real loader leaves it: the plugins folded into the config.
vi.mock("../../utils/config-loader", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../utils/config-loader")>();
  return {
    ...original,
    loadConfig: async () => {
      const config = state.config as LoadedConfig;
      return {
        config: original.mergeSetupResultIntoConfig(
          config,
          config,
          config.plugins ?? []
        ),
        appConfig: config,
        pluginConsent: undefined,
        projectRoot: state.dir,
        dependencies: [],
      };
    },
  };
});

/** Its row rewritten without the plugin's group. */
const POSTS = defineCollection({
  slug: "rbs_posts",
  fields: [text({ name: "title" }), text({ name: "summary" })],
});
/** Left as migrated: named by nothing. */
const NOTES = defineCollection({
  slug: "rbs_notes",
  fields: [text({ name: "title" })],
});
/** Its row removed. */
const HOME = defineSingle({
  slug: "rbs_home",
  fields: [text({ name: "headline" })],
});

/** A plugin adding a group to the collection and the Single. */
const EXTENDING = definePlugin({
  name: "@test/rbs-extend",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    extend: [
      {
        target: ["rbs_posts", "rbs_home"],
        fields: [
          group({ name: "rbs_meta", fields: [text({ name: "headline" })] }),
        ],
      },
    ],
  },
});

const siteConfig = () =>
  defineConfig({
    collections: [POSTS, NOTES],
    singles: [HOME],
    plugins: [EXTENDING],
    db: { migrationsDir: "./migrations" },
  });

describe.each(getConfiguredTestDialects())(
  "migrate:status names the registry rows behind the newest applied migration (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;
    let clock = 0;

    beforeEach(async () => {
      state.dir = mkdtempSync(join(tmpdir(), "nextly-rbs-"));
      mkdirSync(join(state.dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(state.dir, "site.db")}`;
        drop = async () => undefined;
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_rbs");
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      // Which a production start requires before it opens the database.
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv(
        "NEXTLY_SECRET",
        process.env.NEXTLY_SECRET ??
          "test-secret-must-be-at-least-32-characters-long!!"
      );
      _resetEnvCache();
      // Each migration file is named by the clock.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 14, 12, 0, 0, 0)));
    }, 120_000);

    afterEach(async () => {
      await shutdownNextly();
      await shutdownServices();
      vi.useRealTimers();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
      rmSync(state.dir, { recursive: true, force: true });
    }, 60_000);

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
          cwd: state.dir,
        } as CommandContext,
        said,
      };
    }

    /** `nextly migrate:create`, which must succeed. */
    async function migrateCreate(name: string): Promise<void> {
      state.config = siteConfig();
      tick();
      const { context, said } = command();
      setNonInteractive(true);
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}\n${said.join("\n")}`);
      });
      try {
        await runMigrateCreate(name, { cwd: state.dir }, context);
      } finally {
        exit.mockRestore();
        setNonInteractive(false);
      }
    }

    /** `nextly migrate`, which must succeed; what it said. */
    async function migrate(): Promise<string[]> {
      state.config = siteConfig();
      tick();
      const { context, said } = command();
      await runMigrate({ cwd: state.dir, throwOnFailure: true }, context).catch(
        (error: unknown) => {
          throw new Error(`${(error as Error).message}\n${said.join("\n")}`, {
            cause: error,
          });
        }
      );
      return said;
    }

    /** `nextly plugins install --all`, which must succeed. */
    async function installAll(): Promise<void> {
      state.config = siteConfig();
      tick();
      const { context, said } = command();
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}\n${said.join("\n")}`);
      });
      try {
        await runPluginInstallAll({ cwd: state.dir }, context);
      } finally {
        exit.mockRestore();
      }
    }

    /** What a production start warned, once it and the work it left have settled. */
    async function productionStartWarnings(): Promise<string[]> {
      const warned: string[] = [];
      const warn = vi.spyOn(console, "warn").mockImplementation((...args) => {
        warned.push(args.map(String).join(" "));
      });
      vi.stubEnv("NODE_ENV", "production");
      _resetEnvCache();
      try {
        await getNextly({
          config: sanitizeConfig(siteConfig() as never) as never,
        });
        await startSettled();
      } finally {
        warn.mockRestore();
        await shutdownNextly();
        await shutdownServices();
        vi.stubEnv("NODE_ENV", "test");
        _resetEnvCache();
      }
      return warned;
    }

    /** What `nextly migrate:status` said. */
    async function status(): Promise<string[]> {
      state.config = siteConfig();
      const { context, said } = command();
      await runMigrateStatus({ cwd: state.dir }, context);
      return said;
    }

    /** `nextly migrate:status --json`'s registry report. */
    async function statusJson(): Promise<Record<string, unknown>> {
      state.config = siteConfig();
      const printed: string[] = [];
      const log = vi.spyOn(console, "log").mockImplementation(value => {
        printed.push(String(value));
      });
      try {
        await runMigrateStatus(
          { cwd: state.dir, json: true },
          command().context
        );
      } finally {
        log.mockRestore();
      }
      return (
        JSON.parse(printed.join("\n")) as { registry: Record<string, unknown> }
      ).registry;
    }

    /** A connection of the test's own, resolving the registry tables by name. */
    async function open(): Promise<DrizzleAdapter> {
      const adapter = (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
      installRegistryResolver(adapter);
      return adapter;
    }

    /**
     * What a start of an earlier release left: the collection's row without
     * the plugin's group, and the Single's row gone.
     */
    async function leaveRowsBehind(): Promise<void> {
      const adapter = await open();
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      try {
        const registry = new CollectionRegistryService(adapter, {
          debug: () => undefined,
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        });
        const row = await registry.getCollectionBySlug("rbs_posts");
        if (row === null) throw new Error("rbs_posts has no registry row");
        await registry.updateCollection(
          "rbs_posts",
          {
            fields: row.fields.filter(
              field => (field as { name?: string }).name !== "rbs_meta"
            ),
          },
          { source: "code" }
        );
        await adapter.executeQuery(
          `DELETE FROM ${q("dynamic_singles")} WHERE ${q("slug")} = 'rbs_home'`
        );
      } finally {
        await adapter.disconnect().catch(() => undefined);
      }
    }

    const naming = (said: readonly string[], needle: string) =>
      said.filter(line => line.includes(needle));

    it("names a partly matching row and a missing one, says to run nextly migrate, and names nothing once it has run", async () => {
      await migrateCreate("init");
      await migrate();
      await installAll();
      // The control: a database the migrations wrote names nothing.
      expect(naming(await status(), "rbs_")).toEqual([]);

      await leaveRowsBehind();

      const said = await status();
      expect(naming(said, '"rbs_posts"')).toEqual([
        expect.stringMatching(
          /^collection "rbs_posts": its registry row differs from the newest applied migration's record of it \(missing field "rbs_meta"\)\. Run `nextly migrate`/
        ),
      ]);
      expect(naming(said, '"rbs_home"')).toEqual([
        expect.stringMatching(
          /^single "rbs_home": it has no registry row, though the newest applied migration records it\. Run `nextly migrate`/
        ),
      ]);
      expect(naming(said, "rbs_notes")).toEqual([]);

      const registry = await statusJson();
      expect(registry.behindSnapshot).toEqual([
        {
          kind: "collection",
          slug: "rbs_posts",
          row: "differs",
          missingFields: ["rbs_meta"],
          extraFields: [],
        },
        {
          kind: "single",
          slug: "rbs_home",
          row: "missing",
          missingFields: [],
          extraFields: [],
        },
      ]);
      // Named once: the Single is not also named as unregistered.
      expect(registry.unregistered).toEqual([]);

      await migrate();
      expect(naming(await status(), "rbs_")).toEqual([]);
    }, 240_000);

    it("a production start names a row lacking a field the build declares, and nothing once nextly migrate has run", async () => {
      await migrateCreate("init");
      await migrate();
      await installAll();
      // The control: a start against the rows the migrations wrote.
      expect(naming(await productionStartWarnings(), "rbs_")).toEqual([]);

      await leaveRowsBehind();

      const warned = await productionStartWarnings();
      expect(naming(warned, '"rbs_posts"')).toEqual([
        expect.stringContaining(
          'collection "rbs_posts": the build declares field "rbs_meta", which its registry row lacks. Run `nextly migrate` to bring the row up to date.'
        ),
      ]);
      expect(naming(warned, '"rbs_home"')).toEqual([
        expect.stringContaining(
          'single "rbs_home": the build declares it, but it has no registry row. Run `nextly migrate` to write it.'
        ),
      ]);
      expect(naming(warned, "rbs_notes")).toEqual([]);

      await migrate();
      expect(naming(await productionStartWarnings(), "rbs_")).toEqual([]);
    }, 240_000);
  }
);
