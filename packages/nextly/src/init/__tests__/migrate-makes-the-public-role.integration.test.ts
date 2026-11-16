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
 * - Another plugin's install, which declares no public grant, leaves that
 *   grant with the Public role, and a visitor still reads the collection.
 * - The languages stored in Settings, with none in the configuration, are the
 *   ones a rule is told where the seeding runs inside a transaction: the
 *   first `nextly migrate` run on this release of a database an earlier one
 *   migrated, which writes its bookkeeping in one commit, and a plugin's
 *   install, which writes it in the transaction recording the install.
 * - Migrations at start (`db.runMigrationsOnBoot`) add the permissions and
 *   make the Public role and its grants as `nextly migrate` does: on a new
 *   database, and for a collection added later, its rules asked in the
 *   languages stored in Settings before the start has read them itself.
 * - Migrations at start provision the user fields as `nextly migrate` does: a
 *   newly declared field gets its definition and its `user_ext` column, and
 *   the start serves it.
 * - Migrations at start make a translated collection's translations table as
 *   `nextly migrate` does, on a new database, so the start writes its entries.
 */

// Set before anything reads it (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import { getService } from "../../di/service-access";
import { _resetPerLanguageStorage } from "../../domains/i18n/per-language-storage";
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
      const merged = original.mergeSetupResultIntoConfig(
        config,
        config,
        config.plugins ?? []
      );
      // As the real loader does, so the command keeps values per language as the site does.
      const { adoptPerLanguageStorage } = await import(
        "../../domains/i18n/per-language-storage"
      );
      adoptPerLanguageStorage(merged.perLanguageStorage);
      return {
        config: merged,
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

/**
 * Read by anyone only in French, on a site whose languages are stored in
 * Settings alone: kept per language under the setting, so its content differs
 * by language with no `localization` in the configuration.
 */
const STORED_FRENCH = defineCollection({
  slug: "mpr-french",
  access: { read: ({ locale }) => locale === "fr" },
  fields: [text({ name: "title" })],
});

/** `STORED_FRENCH` on a site keeping its content per language, its languages stored. */
function storedLanguagesConfig() {
  return defineConfig({
    collections: [STORED_FRENCH],
    experimental: { perLanguageStorage: true },
    db: { migrationsDir: "./migrations" },
  });
}

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

/** A plugin declaring a permission of its own and no public grant. */
const DIGEST = definePlugin({
  name: "@test/mpr-digest",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    permissions: [{ action: "send", resource: "mpr-digest", label: "Send" }],
  },
});

/** Added after the site was set up, and read by anyone. */
const ADDED = defineCollection({
  slug: "mpr-added",
  access: { read: () => true },
  fields: [text({ name: "title" })],
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
      _resetPerLanguageStorage();
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

    /** The slugs of every stored permission, sorted. */
    async function permissionSlugs(): Promise<string[]> {
      const adapter = await open();
      try {
        const rows = await adapter.executeQuery<{ slug: unknown }>(
          `SELECT ${q}slug${q} AS slug FROM ${q}permissions${q}`
        );
        return rows.map(row => String(row.slug)).sort();
      } finally {
        await adapter.disconnect().catch(() => undefined);
      }
    }

    /** The names of the user fields defined in `user_field_definitions`, sorted. */
    async function definedUserFields(): Promise<string[]> {
      const adapter = await open();
      try {
        const rows = await adapter.executeQuery<{ name: unknown }>(
          `SELECT ${q}name${q} AS name FROM ${q}user_field_definitions${q}`
        );
        return rows.map(row => String(row.name)).sort();
      } finally {
        await adapter.disconnect().catch(() => undefined);
      }
    }

    /** Whether `user_ext` has the column `column`: a read of it that succeeds. */
    async function userExtHas(column: string): Promise<boolean> {
      const adapter = await open();
      try {
        await adapter.executeQuery(
          `SELECT ${q}${column}${q} FROM ${q}user_ext${q} WHERE 1 = 0`
        );
        return true;
      } catch {
        return false;
      } finally {
        await adapter.disconnect().catch(() => undefined);
      }
    }

    /** Whether the translations table of the collection `slug` exists. */
    async function translationsTableExists(slug: string): Promise<boolean> {
      const adapter = await open();
      try {
        const [row] = await adapter.executeQuery<{ table_name: unknown }>(
          `SELECT ${q}table_name${q} AS table_name FROM ${q}dynamic_collections${q} WHERE ${q}slug${q} = '${slug}'`
        );
        if (row === undefined) return false;
        return await adapter.tableExists(`${String(row.table_name)}_locales`);
      } finally {
        await adapter.disconnect().catch(() => undefined);
      }
    }

    /** English, the default, and French, stored in Settings as it writes them. */
    async function storeLanguages(): Promise<void> {
      const adapter = await open();
      const flag = (value: boolean) =>
        dialect === "postgresql" ? String(value) : value ? "1" : "0";
      const now = dialect === "sqlite" ? "1700000000" : "CURRENT_TIMESTAMP";
      const columns = [
        "code",
        "label",
        "direction",
        "fallback",
        "position",
        "is_default",
        "active",
        "revision",
        "created_at",
        "updated_at",
      ]
        .map(column => `${q}${column}${q}`)
        .join(", ");
      try {
        for (const [position, code] of ["en", "fr"].entries()) {
          await adapter.executeQuery(
            `INSERT INTO ${q}nextly_languages${q} (${columns}) VALUES ('${code}', '${code}', 'ltr', '[]', ${position}, ${flag(position === 0)}, ${flag(true)}, 1, ${now}, ${now})`
          );
        }
      } finally {
        await adapter.disconnect().catch(() => undefined);
      }
    }

    /**
     * The migrations as an earlier release's `nextly migrate:create` wrote
     * them: snapshots without the registry metadata, so a first run on this
     * release writes the rows from the configuration in its one commit.
     */
    function asEarlierRelease(): void {
      const meta = join(state.dir, "migrations", "meta");
      for (const file of readdirSync(meta)) {
        if (!file.endsWith(".snapshot.json")) continue;
        const path = join(meta, file);
        const snapshot = JSON.parse(readFileSync(path, "utf-8")) as Record<
          string,
          unknown
        >;
        delete snapshot.entities;
        delete snapshot.permissions;
        writeFileSync(path, JSON.stringify(snapshot, null, 2));
      }
    }

    /** What an earlier release leaves: the database without the registry record. */
    async function deleteRegistryRecord(): Promise<void> {
      const adapter = await open();
      try {
        await adapter.executeQuery(
          `DELETE FROM ${q}nextly_meta${q} WHERE ${q}key${q} = 'registry_record'`
        );
      } finally {
        await adapter.disconnect().catch(() => undefined);
      }
    }

    /** `collections`, migrated at start from the test's migrations folder. */
    function migratedAtStart(...collections: (typeof OPEN)[]) {
      return withMigrationsAtStart({ collections });
    }

    /** `config`, migrated at start from the test's migrations folder. */
    function withMigrationsAtStart(config: Parameters<typeof defineConfig>[0]) {
      return defineConfig({
        ...config,
        db: {
          migrationsDir: join(state.dir, "migrations"),
          runMigrationsOnBoot: true,
        },
      });
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
      return atProductionStart(config, async (nextly, sanitized) => {
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
      });
    }

    /** What `read` finds once a production start of `config` has settled. */
    async function atProductionStart<T>(
      config: unknown,
      read: (
        nextly: Awaited<ReturnType<typeof getNextly>>,
        sanitized: never
      ) => Promise<T>
    ): Promise<T> {
      vi.stubEnv("NODE_ENV", "production");
      _resetEnvCache();
      try {
        const sanitized = sanitizeConfig(config as never) as never;
        const nextly = await getNextly({ config: sanitized });
        await startSettled();
        return await read(nextly, sanitized);
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

    it("asks a read rule in the stored languages in the first run's one commit", async () => {
      const config = storedLanguagesConfig();
      await migrateCreate("initial", config);
      asEarlierRelease();
      await migrate(config);
      // The control: with no language stored, the rule never answers `true`.
      expect(await publicHolds()).not.toContain("read-mpr-french");

      // A database an earlier release migrated, with languages stored in
      // Settings: the first run on this release writes its rows, permissions
      // and grants in one commit, and nothing after it.
      await storeLanguages();
      await deleteRegistryRecord();
      await migrate(config);

      expect(await publicHolds()).toContain("read-mpr-french");
    }, 240_000);

    it("asks a read rule in the stored languages at a plugin's install", async () => {
      const without = storedLanguagesConfig();
      await migrateCreate("initial", without);
      await migrate(without);
      const adapter = await open();
      await recordPluginLifecycle(
        new SchemaEventsRepository(adapter.getDrizzle(), dialect),
        FORMS.name,
        { state: "uninstalled" }
      );
      await adapter.disconnect().catch(() => undefined);
      const withPlugin = { ...without, plugins: [FORMS] };
      await migrateCreate("forms", withPlugin);
      await migrate(withPlugin);
      expect(await publicHolds()).not.toContain("read-mpr-french");

      await storeLanguages();
      state.config = withPlugin;
      tick();
      await runPluginInstall(FORMS.name, {}, command().context);

      expect(await publicHolds()).toContain("read-mpr-french");
    }, 240_000);

    it("makes the Public role and the permissions when migrations run at start", async () => {
      const before = migratedAtStart(OPEN, CLOSED);
      await migrateCreate("initial", before);

      expect(await asVisitor(before, ["mpr-posts", "mpr-notes"])).toEqual({
        statuses: { "mpr-posts": 200, "mpr-notes": 401 },
        media: "read",
      });
      expect(await publicHolds()).toEqual(
        expect.arrayContaining(["read-media", "read-mpr-posts"])
      );

      const after = migratedAtStart(OPEN, CLOSED, ADDED);
      await migrateCreate("added", after);

      expect((await asVisitor(after, ["mpr-added"])).statuses).toEqual({
        "mpr-added": 200,
      });
      expect(await permissionSlugs()).toEqual(
        expect.arrayContaining([
          "create-mpr-added",
          "read-mpr-added",
          "update-mpr-added",
          "delete-mpr-added",
        ])
      );
      expect(await publicHolds()).toContain("read-mpr-added");
    }, 240_000);

    it("asks a read rule in the stored languages when migrations run at start", async () => {
      const site = {
        experimental: { perLanguageStorage: true },
      } as const;
      const before = withMigrationsAtStart({ ...site, collections: [OPEN] });
      await migrateCreate("initial", before);
      await asVisitor(before, []);
      await storeLanguages();

      const after = withMigrationsAtStart({
        ...site,
        collections: [OPEN, STORED_FRENCH],
      });
      await migrateCreate("french", after);
      await asVisitor(after, []);

      expect(await publicHolds()).toContain("read-mpr-french");
    }, 240_000);

    it("provisions a newly declared user field when migrations run at start", async () => {
      const before = migratedAtStart(OPEN);
      await migrateCreate("initial", before);
      await asVisitor(before, []);
      expect(await definedUserFields()).not.toContain("nickname");

      const after = withMigrationsAtStart({
        collections: [OPEN],
        users: { fields: [text({ name: "nickname" })] },
      });
      const served = await atProductionStart(after, async () =>
        getService("userExtSchemaService")
          .getMergedFieldConfigs()
          .map(field => ("name" in field ? field.name : undefined))
      );

      expect(served).toContain("nickname");
      expect(await definedUserFields()).toContain("nickname");
      expect(await userExtHas("nickname")).toBe(true);
    }, 240_000);

    it("makes a translated collection's translations table when migrations run at start", async () => {
      const config = withMigrationsAtStart({
        collections: [FRENCH],
        localization: { locales: ["en", "fr"], defaultLocale: "en" },
      });
      await migrateCreate("initial", config);

      const written = await atProductionStart(config, nextly =>
        nextly
          .create({ collection: "mpr-french", data: { title: "Bonjour" } })
          .then(
            () => "written",
            (error: unknown) =>
              `refused: ${(error as { code?: string }).code ?? String(error)}`
          )
      );

      expect(await translationsTableExists("mpr-french")).toBe(true);
      expect(written).toBe("written");
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

    it("keeps a plugin's public grant when another plugin is installed after it", async () => {
      const without = configOf(OPEN);
      await migrateCreate("initial", without);
      await migrate(without);

      // Both join the configuration having been uninstalled before, so each
      // is declared by its own install, as `nextly plugins install --all` does.
      const adapter = await open();
      for (const plugin of [FORMS, DIGEST]) {
        await recordPluginLifecycle(
          new SchemaEventsRepository(adapter.getDrizzle(), dialect),
          plugin.name,
          { state: "uninstalled" }
        );
      }
      await adapter.disconnect().catch(() => undefined);
      const withPlugins = { ...configOf(OPEN), plugins: [FORMS, DIGEST] };
      await migrateCreate("plugins", withPlugins);
      await migrate(withPlugins);

      state.config = withPlugins;
      tick();
      await runPluginInstall(FORMS.name, {}, command().context);
      expect(await publicHolds()).toContain("read-mpr-entries");

      tick();
      await runPluginInstall(DIGEST.name, {}, command().context);

      expect(await publicHolds()).toContain("read-mpr-entries");
      expect((await asVisitor(withPlugins, ["mpr-entries"])).statuses).toEqual({
        "mpr-entries": 200,
      });
    }, 240_000);
  }
);
