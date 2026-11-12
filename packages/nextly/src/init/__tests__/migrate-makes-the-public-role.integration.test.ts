/**
 * `nextly migrate` and a plugin's install make the Public role and give it
 * what visitors read, on every configured dialect, so a site set up by the
 * commands alone serves its visitors from a production start, which writes no
 * role or grant.
 *
 * The database starts empty: a scratch database on PostgreSQL and MySQL, a new
 * file on SQLite. It is set up by the commands themselves (`runMigrateCreate`,
 * `runMigrate`, `runPluginInstall`); only the config file is not read from
 * disk. Each start is a production start through `getNextly()`, and a visitor
 * is a request with no session through the route handlers, or a Direct API
 * read with `overrideAccess: false` and no user.
 *
 * - After `nextly migrate`, a visitor reads a collection whose read rule
 *   answers `true`, and the media library; a collection with no read rule is
 *   refused, the control that the read is judged at all.
 * - A collection given a read rule answering `true` after the site was set up
 *   is refused by a production start alone, and read once `nextly migrate`
 *   has run again.
 * - A translated collection whose read rule answers `true` in one of the
 *   site's languages is granted its read: the rules are told the languages a
 *   start of the configuration would tell them.
 * - A plugin declaring a public grant on the collection it contributes: the
 *   `nextly migrate` that adds the collection, with the plugin recorded
 *   uninstalled, grants nothing for it; the plugin's install grants it.
 */

// Set before anything reads it (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import type { CommandContext } from "../../cli/program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../cli/utils/config-loader";
import { createLogger } from "../../cli/utils/logger";
import { runMigrate } from "../../cli/commands/migrate";
import { runMigrateCreate } from "../../cli/commands/migrate-create";
import { runPluginInstall } from "../../cli/commands/plugin-lifecycle-runner";
import { defineCollection, defineConfig, text } from "../../config";
import { createAdapter } from "../../database/factory";
import { shutdownServices } from "../../di/register";
import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { setNonInteractive } from "../../domains/schema/migrate/can-prompt";
import { recordPluginLifecycle } from "../../domains/schema/ownership/plugin-lifecycle-state";
import { getNextly, shutdownNextly, startSettled } from "../../init";
import { definePlugin } from "../../plugins/plugin-context";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { resetDispatcherForTests } from "../../route-handler/auth-handler";
import { createDynamicHandlers } from "../../routeHandler";
import { _resetEnvCache } from "../../shared/lib/env";
import { sanitizeConfig } from "../../shared/types/config";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/** The config the commands load, and the folder they run in. */
const state = vi.hoisted(() => ({ config: undefined as unknown, dir: "" }));

vi.mock("../../cli/utils/config-loader", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../cli/utils/config-loader")>();
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

/** Read by anyone. */
const OPEN = defineCollection({
  slug: "mpr-posts",
  access: { read: () => true },
  fields: [text({ name: "title" })],
});

/** No read rule: a visitor needs a grant nobody gives. */
const CLOSED = defineCollection({
  slug: "mpr-notes",
  fields: [text({ name: "title" })],
});

/** The same collection, now read by anyone. */
const OPENED = defineCollection({
  slug: "mpr-notes",
  access: { read: () => true },
  fields: [text({ name: "title" })],
});

/**
 * Translated, and read by anyone only in French: a rule told the site's
 * languages answers `true` for a French read, and one told none never does.
 */
const FRENCH = defineCollection({
  slug: "mpr-french",
  localized: true,
  access: { read: ({ locale }) => locale === "fr" },
  fields: [text({ name: "title" })],
});

/** A plugin contributing a collection with no read rule, and a public read of it. */
const FORMS = definePlugin({
  name: "@test/mpr-forms",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    collections: [
      defineCollection({
        slug: "mpr-entries",
        fields: [text({ name: "title" })],
      }),
    ],
    publicGrants: [{ collection: "mpr-entries", action: "read" }],
  },
});

function configOf(...collections: (typeof OPEN)[]) {
  return defineConfig({
    collections,
    db: { migrationsDir: "./migrations" },
  });
}

describe.each(getConfiguredTestDialects())(
  "nextly migrate and a plugin's install make the Public role (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;
    let clock = 0;
    const q = dialect === "mysql" ? "`" : '"';

    beforeEach(async () => {
      state.dir = mkdtempSync(join(tmpdir(), "nextly-migrate-public-"));
      mkdirSync(join(state.dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(state.dir, "empty.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(
          dialect,
          "nextly_migrate_public"
        );
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      // Which a production start requires before it opens the database.
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv("NODE_ENV", "test");
      _resetEnvCache();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 12, 12, 0, 0, 0)));
    }, 60_000);

    afterEach(async () => {
      await shutdownNextly();
      await shutdownServices();
      resetDispatcherForTests();
      vi.useRealTimers();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
      rmSync(state.dir, { recursive: true, force: true });
    }, 60_000);

    function tick(): void {
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 12, 12, 0, clock, 0)));
    }

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

    /** `nextly migrate:create`, which must succeed. */
    async function migrateCreate(name: string, config: unknown): Promise<void> {
      state.config = config;
      tick();
      const { context, said } = command();
      setNonInteractive(true);
      const code = await exiting(() =>
        runMigrateCreate(name, { cwd: state.dir }, context)
      ).finally(() => setNonInteractive(false));
      expect(code, said.join("\n")).toBeUndefined();
    }

    /** `nextly migrate`, which must succeed. */
    async function migrate(config: unknown): Promise<void> {
      state.config = config;
      tick();
      const { context, said } = command();
      const code = await exiting(() => runMigrate({ cwd: state.dir }, context));
      expect(code, said.join("\n")).toBeUndefined();
    }

    /** A connection of the test's own to the database the commands set up. */
    async function open(): Promise<DrizzleAdapter> {
      return (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
    }

    /** The slugs of the permissions the Public role holds, sorted. */
    async function publicHolds(): Promise<string[]> {
      const adapter = await open();
      try {
        const rows = await adapter.executeQuery<{ slug: unknown }>(
          `SELECT p.${q}slug${q} AS slug FROM ${q}role_permissions${q} rp JOIN ${q}roles${q} r ON r.${q}id${q} = rp.${q}role_id${q} JOIN ${q}permissions${q} p ON p.${q}id${q} = rp.${q}permission_id${q} WHERE r.${q}slug${q} = 'public'`
        );
        return rows.map(row => String(row.slug)).sort();
      } finally {
        await adapter.disconnect().catch(() => undefined);
      }
    }

    /**
     * A production start of `config`, then what a visitor is answered: the
     * status of a request with no session for each collection's entries, and
     * whether a Direct API read of the media library with no user succeeds.
     */
    async function asVisitor(
      config: unknown,
      collections: readonly string[]
    ): Promise<{ statuses: Record<string, number>; media: string }> {
      vi.stubEnv("NODE_ENV", "production");
      _resetEnvCache();
      try {
        const sanitized = sanitizeConfig(config as never) as never;
        const nextly = await getNextly({ config: sanitized });
        await startSettled();
        const handlers = createDynamicHandlers({ config: sanitized });
        const statuses: Record<string, number> = {};
        for (const slug of collections) {
          const path = ["collections", slug, "entries"];
          const response = await handlers.GET(
            new Request(`http://localhost/api/${path.join("/")}`),
            { params: Promise.resolve({ params: path }) }
          );
          statuses[slug] = response.status;
        }
        const media = await nextly.media.find({ overrideAccess: false }).then(
          () => "read",
          (error: unknown) =>
            `refused: ${(error as { code?: string }).code ?? String(error)}`
        );
        return { statuses, media };
      } finally {
        await shutdownNextly();
        await shutdownServices();
        resetDispatcherForTests();
        vi.stubEnv("NODE_ENV", "test");
        _resetEnvCache();
      }
    }

    it("serves a visitor a site set up by nextly migrate alone", async () => {
      const config = configOf(OPEN, CLOSED);
      await migrateCreate("initial", config);
      await migrate(config);

      expect(await publicHolds()).toEqual(
        expect.arrayContaining(["read-media", "read-mpr-posts"])
      );
      expect(await asVisitor(config, ["mpr-posts", "mpr-notes"])).toEqual({
        statuses: { "mpr-posts": 200, "mpr-notes": 401 },
        media: "read",
      });
    }, 240_000);

    it("reads a collection newly opened to visitors once nextly migrate has run", async () => {
      const before = configOf(OPEN, CLOSED);
      await migrateCreate("initial", before);
      await migrate(before);

      const after = configOf(OPEN, OPENED);
      // A production start alone grants nothing.
      expect((await asVisitor(after, ["mpr-notes"])).statuses).toEqual({
        "mpr-notes": 401,
      });

      await migrate(after);

      expect(await publicHolds()).toContain("read-mpr-notes");
      expect((await asVisitor(after, ["mpr-notes"])).statuses).toEqual({
        "mpr-notes": 200,
      });
    }, 240_000);

    it("asks a read rule in the languages a start would tell it", async () => {
      const config = defineConfig({
        collections: [FRENCH],
        localization: { locales: ["en", "fr"], defaultLocale: "en" },
        db: { migrationsDir: "./migrations" },
      });
      await migrateCreate("initial", config);
      await migrate(config);

      expect(await publicHolds()).toContain("read-mpr-french");
    }, 240_000);

    it("gives the Public role a plugin's public grant at its install", async () => {
      const without = configOf(OPEN);
      await migrateCreate("initial", without);
      await migrate(without);

      // The plugin joins the configuration having been uninstalled before, so
      // the migrate that adds its collection declares nothing for it.
      const adapter = await open();
      await recordPluginLifecycle(
        new SchemaEventsRepository(adapter.getDrizzle(), dialect),
        FORMS.name,
        { state: "uninstalled" }
      );
      await adapter.disconnect().catch(() => undefined);
      const withPlugin = { ...configOf(OPEN), plugins: [FORMS] };
      await migrateCreate("forms", withPlugin);
      await migrate(withPlugin);
      expect(await publicHolds()).not.toContain("read-mpr-entries");

      state.config = withPlugin;
      tick();
      await runPluginInstall(FORMS.name, {}, command().context);

      expect(await publicHolds()).toContain("read-mpr-entries");
      expect((await asVisitor(withPlugin, ["mpr-entries"])).statuses).toEqual({
        "mpr-entries": 200,
      });
    }, 240_000);
  }
);
