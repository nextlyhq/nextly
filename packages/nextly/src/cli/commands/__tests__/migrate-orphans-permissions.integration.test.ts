/**
 * `nextly migrate` marks a permission orphaned when it applies the recorded
 * migration whose snapshot no longer declares it, for each owner that
 * snapshot speaks for, keeping every grant; and clears the mark when a later
 * recorded migration declares it again. On every configured dialect.
 *
 * The database starts empty: a scratch database on PostgreSQL and MySQL, a new
 * file on SQLite. Nothing boots against it; the commands are driven
 * themselves (`runMigrateCreate`, `runMigrate`), and only the config file is
 * not read from disk: the loader is handed the config, with the plugins'
 * contributions folded in by the loader's own fold.
 *
 * - An app permission and a plugin permission removed through a recorded
 *   migration are orphaned as it applies, with the admin preset's grants of
 *   them kept and the change logged; declared again by a later migration,
 *   each mark is cleared as that migration applies, with the grants as they
 *   were.
 * - A plugin whose permissions no snapshot declared (added by a run with no
 *   migration of its release, as an install adds them) is spoken for once a
 *   migration records it: its next release's migration orphans the permission
 *   that release dropped, grants kept.
 * - A migration written before a plugin joined the build, applied after its
 *   install, leaves the plugin's permissions as they were.
 * - The first migration after a registry baseline leaves every core
 *   permission, and every permission of a plugin installed before it that
 *   its snapshot still declares, unorphaned; a plugin the baseline held and
 *   the snapshot no longer records is spoken for through the baseline.
 * - An older build's `nextly migrate`, whose folder lacks a migration the
 *   database records applied, stops before writing and changes no orphan mark.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { loadDialectTables } from "../../../database/dialect-tables";
import { PermissionSeedService } from "../../../domains/auth/services/permission-seed-service";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { collectCustomPermissions } from "../../../plugins/permissions/collect-permissions";
import {
  definePlugin,
  type PluginDefinition,
} from "../../../plugins/plugin-context";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../utils/config-loader";
import { withCommandServicesLent } from "../../utils/lend-command-services";
import { createLogger } from "../../utils/logger";
import { installRegistryResolver } from "../../utils/registry-resolver";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/** The config the commands load, set before each run. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));

/**
 * The config as the loader returns it: the plugins' contributions folded in
 * by the loader's own fold, as they reach the commands from a config file.
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
        dependencies: [],
      };
    },
  };
});

const POSTS = defineCollection({
  slug: "mop-posts",
  fields: [text({ name: "title" })],
});
const NOTES = defineCollection({
  slug: "mop-notes",
  fields: [text({ name: "body" })],
});

/** A plugin `name` declaring `permissions`, each `[action, resource]`. */
function plugin(
  name: string,
  ...permissions: [action: string, resource: string][]
): PluginDefinition {
  return definePlugin({
    name,
    version: "1.0.0",
    nextly: "*",
    contributes: {
      permissions: permissions.map(([action, resource]) => ({
        action,
        resource,
      })),
    },
  });
}

/** A config of `collections`, the app's `permissions` and `plugins`. */
function config(parts: {
  collections?: ReturnType<typeof defineCollection>[];
  permissions?: [action: string, resource: string][];
  plugins?: PluginDefinition[];
}) {
  return defineConfig({
    collections: parts.collections ?? [POSTS],
    permissions: (parts.permissions ?? []).map(([action, resource]) => ({
      action,
      resource,
    })),
    plugins: parts.plugins ?? [],
    db: { migrationsDir: "./migrations" },
  });
}

describe.each(getConfiguredTestDialects())(
  "nextly migrate orphans what a recorded migration no longer declares (%s)",
  (dialect: TestDialect) => {
    let dir: string;
    let url: string;
    let drop: () => Promise<void>;
    let clock = 0;
    const q = dialect === "mysql" ? "`" : '"';

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), "nextly-migrate-orphans-"));
      mkdirSync(join(dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(dir, "empty.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(
          dialect,
          "nextly_migrate_orphans"
        );
        url = scratch.url;
        drop = scratch.drop;
      }
      // The commands open the database the environment names.
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
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 12, 12, 0, 0, 0)));
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
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 12, 12, 0, clock, 0)));
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

    /** `nextly migrate:create --non-interactive` with `loadedConfig`, which must succeed. */
    async function migrateCreate(loadedConfig: unknown): Promise<void> {
      loaded.config = loadedConfig;
      tick();
      const { context, said } = command();
      setNonInteractive(true);
      const code = await exiting(() =>
        runMigrateCreate(`step${clock}`, { cwd: dir }, context)
      ).finally(() => setNonInteractive(false));
      expect(code, said.join("\n")).toBeUndefined();
    }

    /** `nextly migrate` with `loadedConfig`: its exit code, if any, and what it said. */
    async function migrateRun(
      loadedConfig: unknown
    ): Promise<{ code: number | undefined; said: string[] }> {
      loaded.config = loadedConfig;
      tick();
      const { context, said } = command();
      const code = await exiting(() => runMigrate({ cwd: dir }, context));
      return { code, said };
    }

    /** `nextly migrate` with `loadedConfig`, which must succeed; what it said. */
    async function migrate(loadedConfig: unknown): Promise<string[]> {
      const { code, said } = await migrateRun(loadedConfig);
      expect(code, said.join("\n")).toBeUndefined();
      return said;
    }

    /** A connection of the test's own to the database the commands set up. */
    async function open(): Promise<DrizzleAdapter> {
      return (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
    }

    /** Run `fn` on a connection of the test's own, closed after. */
    async function on<T>(fn: (adapter: DrizzleAdapter) => Promise<T>) {
      const adapter = await open();
      try {
        return await fn(adapter);
      } finally {
        await adapter.disconnect();
      }
    }

    /** Every permission's slug, by whether it is marked orphaned. */
    async function marks(): Promise<Record<string, boolean>> {
      return on(async adapter => {
        const rows = await adapter.executeQuery<Record<string, unknown>>(
          `SELECT ${q}slug${q} AS slug, ${q}orphaned_at${q} AS orphaned FROM ${q}permissions${q}`
        );
        return Object.fromEntries(
          rows.map(row => [String(row.slug), row.orphaned != null])
        );
      });
    }

    /** The slugs of the permissions marked orphaned, sorted. */
    async function orphaned(): Promise<string[]> {
      return Object.entries(await marks())
        .filter(([, marked]) => marked)
        .map(([slug]) => slug)
        .sort();
    }

    /** The slugs of the permissions the role `slug` holds, sorted. */
    async function grantsOf(slug: string): Promise<string[]> {
      return on(async adapter => {
        const rows = await adapter.executeQuery<{ slug: unknown }>(
          `SELECT p.${q}slug${q} AS slug FROM ${q}role_permissions${q} rp JOIN ${q}roles${q} r ON r.${q}id${q} = rp.${q}role_id${q} JOIN ${q}permissions${q} p ON p.${q}id${q} = rp.${q}permission_id${q} WHERE r.${q}slug${q} = '${slug}'`
        );
        return rows.map(row => String(row.slug)).sort();
      });
    }

    /** Every grant, as `role:permission`, sorted. */
    async function grants(): Promise<string[]> {
      return on(async adapter => {
        const rows = await adapter.executeQuery<Record<string, unknown>>(
          `SELECT r.${q}slug${q} AS role, p.${q}slug${q} AS permission FROM ${q}role_permissions${q} rp JOIN ${q}roles${q} r ON r.${q}id${q} = rp.${q}role_id${q} JOIN ${q}permissions${q} p ON p.${q}id${q} = rp.${q}permission_id${q}`
        );
        return rows
          .map(row => `${String(row.role)}:${String(row.permission)}`)
          .sort();
      });
    }

    /** The lines that say a permission's orphan mark changed. */
    const markLines = (said: readonly string[]) =>
      said.filter(line => /orphan mark cleared|marked orphaned/.test(line));

    it("orphans an app and a plugin permission removed through a recorded migration, keeping their grants, and clears both when declared again", async () => {
      const forms = (...permissions: [action: string, resource: string][]) =>
        plugin("@test/mop-forms", ...permissions);
      const declaring = config({
        permissions: [["export", "mop-posts"]],
        plugins: [
          forms(["export", "mop-submissions"], ["archive", "mop-submissions"]),
        ],
      });
      await migrateCreate(declaring);
      await migrate(declaring);
      const before = await grantsOf("admin");
      // The fixture is what it claims: both are live and the admin holds them.
      expect(before).toEqual(
        expect.arrayContaining(["export-mop-posts", "export-mop-submissions"])
      );
      expect(await orphaned()).toEqual([]);

      // The app stops declaring its permission and the plugin's next release
      // drops one: a permission-only migration records both.
      const dropping = config({
        plugins: [forms(["archive", "mop-submissions"])],
      });
      await migrateCreate(dropping);
      const said = await migrate(dropping);

      expect(await orphaned()).toEqual([
        "export-mop-posts",
        "export-mop-submissions",
      ]);
      expect(await grantsOf("admin")).toEqual(before);
      const lines = markLines(said);
      expect(lines).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^Permission "export-mop-posts" is no longer declared by app: marked orphaned\. Its grants are kept \(.*\badmin\b.*\)\.$/
          ),
          expect.stringMatching(
            /^Permission "export-mop-submissions" is no longer declared by @test\/mop-forms: marked orphaned\. Its grants are kept \(.*\badmin\b.*\)\.$/
          ),
        ])
      );

      // Declared again by a later recorded migration: the marks are cleared as
      // that migration applies, before the run's later phases, and every grant
      // is as it was.
      await migrateCreate(declaring);
      const again = await migrate(declaring);

      expect(await orphaned()).toEqual([]);
      expect(await grantsOf("admin")).toEqual(before);
      const cleared = again.findIndex(line =>
        /^Permission "export-mop-submissions" is declared again by @test\/mop-forms: orphan mark cleared\./.test(
          line
        )
      );
      const phase3 = again.findIndex(line => line.startsWith("Phase 3:"));
      expect(cleared, again.join("\n")).toBeGreaterThanOrEqual(0);
      expect(cleared).toBeLessThan(phase3);
    }, 240_000);

    it("orphans, with its grants, a permission a plugin added outside any snapshot once the migration recording its next release drops it", async () => {
      const feeds = (...permissions: [action: string, resource: string][]) =>
        plugin("@test/mop-feeds", ...permissions);
      await migrateCreate(config({}));
      await migrate(config({}));

      // The plugin joins after the newest snapshot: a run with no migration
      // of it adds its permissions, as its install adds them, and the presets
      // grant them. No snapshot declares them.
      const installed = config({
        plugins: [feeds(["sync", "mop-feeds"], ["purge", "mop-feeds"])],
      });
      await migrate(installed);
      expect(await grantsOf("admin")).toEqual(
        expect.arrayContaining(["purge-mop-feeds", "sync-mop-feeds"])
      );
      const before = await grantsOf("admin");

      // Its next release drops one, and the migration recording that release
      // speaks for it.
      const next = config({ plugins: [feeds(["sync", "mop-feeds"])] });
      await migrateCreate(next);
      await migrate(next);

      expect(await orphaned()).toEqual(["purge-mop-feeds"]);
      expect(await grantsOf("admin")).toEqual(before);
    }, 240_000);

    it("leaves the permissions of a plugin a migration was written without, applied after the plugin's install", async () => {
      const logs = plugin("@test/mop-logs", ["export", "mop-logs"]);
      await migrateCreate(config({}));
      await migrate(config({}));

      // A migration is written before the plugin joins the build.
      await migrateCreate(config({ collections: [POSTS, NOTES] }));
      // The plugin is installed: its permissions are written, as an install
      // writes them, before that migration applies.
      await on(adapter => {
        // Its table names resolved, as a command's connection has them.
        installRegistryResolver(adapter);
        return withCommandServicesLent(adapter, silent, () =>
          new PermissionSeedService(adapter, silent).seedCustomPermissions(
            collectCustomPermissions({}, [logs])
          )
        );
      });
      expect(await marks()).toMatchObject({ "export-mop-logs": false });

      const said = await migrate(
        config({ collections: [POSTS, NOTES], plugins: [logs] })
      );

      expect(await orphaned()).toEqual([]);
      // Never marked, rather than marked and cleared again by the run's later
      // phases: no line says the permission's mark changed.
      expect(
        markLines(said).filter(line => line.includes("export-mop-logs"))
      ).toEqual([]);
    }, 240_000);

    it("leaves every core permission, and a plugin's its snapshot still declares, unorphaned at the first migration after a registry baseline", async () => {
      const kept = plugin("@test/mop-kept", ["sync", "mop-entries"]);
      const gone = plugin("@test/mop-gone", ["export", "mop-archive"]);
      // A new site's first run, with no app migration: the registry record is
      // taken at the point before any, with the live permissions as its
      // baseline, both plugins' included.
      const first = config({
        collections: [],
        permissions: [["audit", "mop-reports"]],
        plugins: [kept, gone],
      });
      await migrate(first);
      expect(await orphaned()).toEqual([]);

      // The first migration after it: a collection is added, and one plugin
      // has left the build, so the snapshot does not record it.
      const next = config({
        collections: [NOTES],
        permissions: [["audit", "mop-reports"]],
        plugins: [kept],
      });
      await migrateCreate(next);
      await migrate(next);

      // The plugin the baseline held is spoken for through it; everything
      // else, core's own permissions among them, is untouched.
      expect(await orphaned()).toEqual(["export-mop-archive"]);
      const now = await marks();
      expect(now).toMatchObject({
        "read-users": false,
        "create-roles": false,
        "sync-mop-entries": false,
        "audit-mop-reports": false,
        "read-mop-notes": false,
      });
    }, 240_000);

    it("changes no orphan mark and no grant when an older build's nextly migrate finds a migration its folder lacks", async () => {
      const older = config({
        permissions: [["export", "mop-posts"]],
        plugins: [plugin("@test/mop-forms", ["export", "mop-submissions"])],
      });
      await migrateCreate(older);
      await migrate(older);
      const folder = new Set(readdirSync(join(dir, "migrations")));

      // A newer build drops both permissions through a recorded migration.
      const newer = config({});
      await migrateCreate(newer);
      await migrate(newer);
      const migrated = await marks();
      expect(
        Object.entries(migrated)
          .filter(([, marked]) => marked)
          .map(([slug]) => slug)
          .sort()
      ).toEqual(["export-mop-posts", "export-mop-submissions"]);
      const granted = await grants();

      // The older build's folder: the newer migration and its snapshot gone.
      const aside = join(dir, "aside");
      mkdirSync(aside);
      for (const name of readdirSync(join(dir, "migrations"))) {
        if (!name.endsWith(".sql") || folder.has(name)) continue;
        renameSync(join(dir, "migrations", name), join(aside, name));
      }
      for (const name of readdirSync(join(dir, "migrations", "meta"))) {
        if (folder.has(name)) continue;
        if (readdirSync(aside).some(sql => name.startsWith(sql.slice(0, -4)))) {
          renameSync(join(dir, "migrations", "meta", name), join(aside, name));
        }
      }
      expect(readdirSync(aside).length).toBeGreaterThan(0);

      // Its configuration still declares both, which its run would add back.
      const { code, said } = await migrateRun(older);

      expect(code, said.join("\n")).toBe(3);
      expect(await marks()).toEqual(migrated);
      // Every grant of every role as it was, the dropped permissions' included.
      expect(await grants()).toEqual(granted);

      // The control that the comparison sees a run that writes: with the
      // newer build's files back, the same configuration's run goes ahead,
      // and its permission phase adds back what it declares.
      for (const name of readdirSync(aside)) {
        renameSync(
          join(aside, name),
          name.endsWith(".sql")
            ? join(dir, "migrations", name)
            : join(dir, "migrations", "meta", name)
        );
      }
      await migrate(older);
      expect(await marks()).not.toEqual(migrated);
    }, 240_000);
  }
);

/** A logger that says nothing, for the test's own writes. */
const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// The dialect tables the test's own seeding reads, outside a booted instance.
await Promise.all(
  getConfiguredTestDialects().map(dialect => loadDialectTables(dialect))
);
