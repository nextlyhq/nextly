/**
 * `nextly migrate` adds the permissions and the declared roles and sets the
 * preset roles' grants, on every configured dialect, so a database set up by
 * the command alone has an admin role holding every permission its preset
 * grants before any start has run.
 *
 * The database starts empty: a scratch database on PostgreSQL and MySQL, a new
 * file on SQLite. Nothing boots against it; the commands are driven
 * themselves (`runMigrateCreate`, `runMigrate`), and only the config file is
 * not read from disk: the loader is handed the config, with the plugin's
 * contributions folded in by the loader's own fold.
 *
 * - After one `nextly migrate`, the admin role holds exactly what its preset
 *   resolves to over the permissions the run left: core's, the collection's
 *   and the Single's, the app's own and the plugin's. The plugin's role exists
 *   with the grants it declares.
 * - A second `nextly migrate` sends no write to the permission, role or grant
 *   tables. Every statement both runs send is recorded at the driver, and the
 *   first run's writes to the same tables are the control that the recorder
 *   sees them.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { recordStatements } from "../../../__tests__/helpers/record-statements";
import { ROLE_PRESETS, resolvePreset } from "../../../auth/role-presets";
import {
  defineCollection,
  defineConfig,
  defineSingle,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
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
import { runMigrateCreate } from "../migrate-create";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/** The config the commands load, set before each run. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));

/**
 * The config as the loader returns it: the plugin's contributions folded in
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

/** A plugin that declares a permission of its own and a role bundling it. */
const PLUGIN = definePlugin({
  name: "@test/msp",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    permissions: [
      { action: "sync", resource: "msp-feeds", label: "Sync feeds" },
    ],
    roles: [
      {
        slug: "msp-syncer",
        name: "Feed syncer",
        permissionSlugs: ["sync-msp-feeds", "read-msp-posts"],
        level: 20,
      },
    ],
  },
});

const CONFIG = defineConfig({
  collections: [
    defineCollection({ slug: "msp-posts", fields: [text({ name: "title" })] }),
  ],
  singles: [
    defineSingle({ slug: "msp-site", fields: [text({ name: "name" })] }),
  ],
  // The app's own permission, beside the collection's built-in ones.
  permissions: [{ action: "export", resource: "msp-posts" }],
  plugins: [PLUGIN],
  db: { migrationsDir: "./migrations" },
});

/** A write to the permission, role or grant tables, in any dialect's quoting. */
const ACCESS_WRITE =
  /^\s*(insert\s+into|update|delete\s+from|replace\s+into)\s+[`"]?(permissions|roles|role_permissions|role_inherits)[`"]?[\s(]/i;

describe.each(getConfiguredTestDialects())(
  "nextly migrate adds permissions, roles and preset grants (%s)",
  (dialect: TestDialect) => {
    let dir: string;
    let url: string;
    let drop: () => Promise<void>;
    let clock = 0;
    const q = dialect === "mysql" ? "`" : '"';

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), "nextly-migrate-seeds-"));
      mkdirSync(join(dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(dir, "empty.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(
          dialect,
          "nextly_migrate_seeds"
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
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 11, 12, 0, 0, 0)));
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
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 11, 12, 0, clock, 0)));
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

    /** `nextly migrate:create --name=initial --non-interactive`, which must succeed. */
    async function migrateCreate(): Promise<void> {
      loaded.config = CONFIG;
      tick();
      const { context, said } = command();
      setNonInteractive(true);
      const code = await exiting(() =>
        runMigrateCreate("initial", { cwd: dir }, context)
      ).finally(() => setNonInteractive(false));
      expect(code, said.join("\n")).toBeUndefined();
    }

    /** `nextly migrate`, which must succeed. */
    async function migrate(): Promise<void> {
      loaded.config = CONFIG;
      tick();
      const { context, said } = command();
      const code = await exiting(() => runMigrate({ cwd: dir }, context));
      expect(code, said.join("\n")).toBeUndefined();
    }

    /** A connection of the test's own to the database the commands set up. */
    async function open(): Promise<DrizzleAdapter> {
      return (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
    }

    interface StoredPermission {
      id: string;
      slug: string;
      action: string;
      resource: string;
      owner: string | null;
      group: string | null;
    }

    /** Every permission not marked orphaned, as stored. */
    async function permissions(
      adapter: DrizzleAdapter
    ): Promise<StoredPermission[]> {
      const rows = await adapter.executeQuery<Record<string, unknown>>(
        `SELECT ${q}id${q} AS id, ${q}slug${q} AS slug, ${q}action${q} AS action, ${q}resource${q} AS resource, ${q}owner${q} AS owner, ${q}permission_group${q} AS grp FROM ${q}permissions${q} WHERE ${q}orphaned_at${q} IS NULL`
      );
      return rows.map(row => ({
        id: String(row.id),
        slug: String(row.slug),
        action: String(row.action),
        resource: String(row.resource),
        owner: row.owner == null ? null : String(row.owner),
        group: row.grp == null ? null : String(row.grp),
      }));
    }

    /** The slugs of the permissions the role `slug` holds, sorted. */
    async function grantsOf(
      adapter: DrizzleAdapter,
      slug: string
    ): Promise<string[]> {
      const rows = await adapter.executeQuery<{ slug: unknown }>(
        `SELECT p.${q}slug${q} AS slug FROM ${q}role_permissions${q} rp JOIN ${q}roles${q} r ON r.${q}id${q} = rp.${q}role_id${q} JOIN ${q}permissions${q} p ON p.${q}id${q} = rp.${q}permission_id${q} WHERE r.${q}slug${q} = '${slug}'`
      );
      return rows.map(row => String(row.slug)).sort();
    }

    it("leaves the admin role holding every permission its preset grants, the plugin's included", async () => {
      await migrateCreate();
      await migrate();

      const adapter = await open();
      try {
        const stored = await permissions(adapter);
        const slugs = stored.map(p => p.slug);
        // What the run had to add: core's, the collection's, the Single's,
        // the app's own and the plugin's.
        expect(slugs).toEqual(
          expect.arrayContaining([
            "read-users",
            "create-users",
            "create-msp-posts",
            "read-msp-posts",
            "update-msp-site",
            "export-msp-posts",
            "sync-msp-feeds",
          ])
        );

        // The admin preset's set, resolved by its own rule over what is
        // stored, and named outright for the cases that decide it.
        const admin = ROLE_PRESETS.find(preset => preset.slug === "admin");
        const expected = resolvePreset(admin!, stored)
          .map(p => p.slug)
          .sort();
        const held = await grantsOf(adapter, "admin");
        expect(held).toEqual(expected);
        expect(held).toEqual(
          expect.arrayContaining([
            "sync-msp-feeds",
            "export-msp-posts",
            "create-msp-posts",
            "update-msp-site",
            "read-users",
          ])
        );
        expect(held).not.toContain("create-users");

        // The plugin's role, with the grants it declares.
        expect(await grantsOf(adapter, "msp-syncer")).toEqual([
          "read-msp-posts",
          "sync-msp-feeds",
        ]);
      } finally {
        await adapter.disconnect();
      }
    }, 180_000);

    it("writes nothing to the permissions, roles or grants on a second run", async () => {
      await migrateCreate();
      const adapter = await open();
      // Installed on the driver, so the commands' own connections are
      // recorded too.
      const first = await recordStatements(adapter, dialect);
      let firstWrites: string[];
      try {
        await migrate();
        firstWrites = first.statements.filter(s => ACCESS_WRITE.test(s));
      } finally {
        first.uninstall();
      }
      const second = await recordStatements(adapter, dialect);
      let secondWrites: string[];
      try {
        await migrate();
        secondWrites = second.statements.filter(s => ACCESS_WRITE.test(s));
      } finally {
        second.uninstall();
        await adapter.disconnect();
      }

      // The control: the first run's writes are seen.
      expect(firstWrites.length).toBeGreaterThan(0);
      expect(secondWrites).toEqual([]);
    }, 180_000);
  }
);
