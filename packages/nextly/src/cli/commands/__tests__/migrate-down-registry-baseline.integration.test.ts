/**
 * `nextly migrate:down` and the registry record, on every configured dialect.
 *
 * A rollback that leaves the database at the point the record was taken at,
 * where that point has no registry metadata, undoes the rolled-back
 * migrations' own changes to the bookkeeping in the same run: the registry
 * rows go back to the baseline, an entity a rolled-back migration added loses
 * its row and its permissions are orphaned, a permission one of them made
 * live is orphaned with its grants kept, and a mark one of them set is
 * cleared. A plugin's install and uninstall and core's own permissions keep
 * what they wrote. A rollback to any other point with nothing recording the
 * registry there is refused before anything changes.
 *
 * The commands are driven themselves (`runMigrateCreate`, `runMigrate`,
 * `runMigrateDown`, `runPluginInstall`, `runPluginUninstall`, `runMigrateStatus`),
 * on a scratch database (a new file on SQLite); only the config file is not
 * read from disk. An earlier release is stood in for as in the first-run tests:
 * its migration is one written here with the registry metadata and the
 * permission record taken out of its snapshot, and a database it last migrated
 * is one this release migrated with the record then deleted.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { resolveDataLossConsent } from "../../../domains/schema/migrate/data-loss-consent";
import {
  readRegistryRecord,
  storeRegistryRecord,
  type BaselineRow,
} from "../../../domains/schema/migrate/registry-record";
import { NextlyError } from "../../../errors";
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
import { runMigrateDown } from "../migrate-down";
import { runMigrateStatus } from "../migrate-status";
import {
  runPluginInstall,
  runPluginUninstall,
} from "../plugin-lifecycle-runner";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/** The config the commands load, and the project they run in, set before each run. */
const state = vi.hoisted(() => ({
  config: undefined as unknown,
  dir: "",
  /** Whether the next write of the rollback's orphan marks fails. */
  marksFail: false,
}));

/** The rollback's orphan marks, failing once when a test arms it. */
vi.mock(
  "../../../domains/schema/migrate/command-access",
  async importOriginal => {
    const original =
      await importOriginal<
        typeof import("../../../domains/schema/migrate/command-access")
      >();
    return {
      ...original,
      rewriteOrphanMarksOnCommandConnection: async (
        ...args: Parameters<
          typeof original.rewriteOrphanMarksOnCommandConnection
        >
      ) => {
        if (state.marksFail) {
          state.marksFail = false;
          throw new Error("the orphan marks could not be written");
        }
        return original.rewriteOrphanMarksOnCommandConnection(...args);
      },
    };
  }
);

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

const SLUG = "rb-posts";
const TABLE = "dc_rb_posts";
const REPORTS = "rb-reports";

/** A plugin installed after the baseline, before the migration that records it. */
const FIRST = definePlugin({
  name: "@test/rb-first",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    permissions: [{ action: "sync", resource: "rb-first", label: "Sync" }],
  },
});
/** A plugin installed and uninstalled after the baseline. */
const SECOND = definePlugin({
  name: "@test/rb-second",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    permissions: [{ action: "send", resource: "rb-second", label: "Send" }],
  },
});
/** A plugin installed after the baseline with a permission its next release drops. */
const THIRD = definePlugin({
  name: "@test/rb-third",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    permissions: [
      { action: "tally", resource: "rb-third", label: "Tally" },
      { action: "purge", resource: "rb-third", label: "Purge" },
    ],
  },
});
/** That plugin's next release, which no longer declares `purge-rb-third`. */
const THIRD_NEXT = definePlugin({
  name: "@test/rb-third",
  version: "1.1.0",
  nextly: "*",
  contributes: {
    permissions: [{ action: "tally", resource: "rb-third", label: "Tally" }],
  },
});

/**
 * A plugin named `app`, the owner key the app's own permissions are stored
 * under, with a permission of its own.
 */
const APP_NAMED = definePlugin({
  name: "app",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    permissions: [{ action: "tally", resource: "rb-app", label: "Tally" }],
  },
});
/** A plugin whose first release declares two permissions. */
const AGAIN = definePlugin({
  name: "@test/rb-again",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    permissions: [
      { action: "keep", resource: "rb-again", label: "Keep" },
      { action: "drop", resource: "rb-again", label: "Drop" },
    ],
  },
});
/** Its next release, which no longer declares `drop-rb-again`. */
const AGAIN_NEXT = definePlugin({
  name: "@test/rb-again",
  version: "1.1.0",
  nextly: "*",
  contributes: {
    permissions: [{ action: "keep", resource: "rb-again", label: "Keep" }],
  },
});

type Plugin = typeof FIRST;

/**
 * The app's config: one collection with `extra` fields beyond its two, the
 * app's own permissions on `rb-reports` (`actions`), and `plugins`.
 */
function config(
  extra: readonly string[] = [],
  actions: readonly string[] = ["export", "archive"],
  plugins: readonly Plugin[] = []
): unknown {
  return defineConfig({
    collections: [
      defineCollection({
        slug: SLUG,
        fields: [
          text({ name: "title" }),
          text({ name: "summary" }),
          ...extra.map(name => text({ name })),
        ],
      }),
    ],
    permissions: actions.map(action => ({ action, resource: REPORTS })),
    plugins: [...plugins],
    db: { migrationsDir: "./migrations" },
  });
}

/** A new site's config, declaring no entity. */
const EMPTY = defineConfig({
  collections: [],
  db: { migrationsDir: "./migrations" },
});

/** The data-loss consent given without targets, as `--accept-data-loss` alone gives it. */
const EVERY_DELETION = resolveDataLossConsent({ flag: true, env: {} });

/** A registry row as the comparison reads it: what the baseline says the row is. */
interface ComparedRow {
  fields: unknown;
  schemaHash: unknown;
  schemaVersion: unknown;
  migrationStatus: unknown;
}

function compared(row: Record<string, unknown>): ComparedRow {
  const fields =
    typeof row.fields === "string"
      ? (JSON.parse(row.fields) as unknown)
      : row.fields;
  return {
    fields,
    schemaHash: row.schemaHash ?? row.schema_hash,
    schemaVersion: Number(row.schemaVersion ?? row.schema_version),
    migrationStatus: row.migrationStatus ?? row.migration_status,
  };
}

describe.each(getConfiguredTestDialects())(
  "migrate:down and the registry record (%s)",
  (dialect: TestDialect) => {
    const drops: (() => Promise<void>)[] = [];
    let clock = 0;
    let files = 0;
    const q = dialect === "mysql" ? "`" : '"';

    /** A new empty database the commands are pointed at. */
    async function scratch(): Promise<string> {
      let url: string;
      if (dialect === "sqlite") {
        files += 1;
        url = `file:${join(state.dir, `db-${files}.db`)}`;
      } else {
        const made = await createScratchDatabase(dialect, "nextly_down_base");
        drops.push(made.drop);
        url = made.url;
      }
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      return url;
    }

    beforeEach(() => {
      state.dir = mkdtempSync(join(tmpdir(), "nextly-down-baseline-"));
      mkdirSync(join(state.dir, "migrations"));
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv(
        "NEXTLY_SECRET",
        process.env.NEXTLY_SECRET ??
          "test-secret-must-be-at-least-32-characters-long!!"
      );
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 12, 12, 0, 0, 0)));
    });

    afterEach(async () => {
      state.marksFail = false;
      setNonInteractive(false);
      vi.useRealTimers();
      vi.unstubAllEnvs();
      _resetEnvCache();
      for (const drop of drops.splice(0)) await drop();
      rmSync(state.dir, { recursive: true, force: true });
    });

    /** Each command runs a second after the one before. */
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
          cwd: state.dir,
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

    /** The app's migrations, by base name, in run order. */
    function migrationNames(): string[] {
      return readdirSync(join(state.dir, "migrations"))
        .filter(file => /^\d.*\.sql$/.test(file) && !/\.\w+\.sql$/.test(file))
        .map(file => file.replace(/\.sql$/, ""))
        .sort();
    }

    /** `nextly migrate:create --name=<name>`, which must succeed; returns the migration's base name. */
    async function migrateCreate(name: string, cfg: unknown): Promise<string> {
      state.config = cfg;
      tick();
      const before = new Set(migrationNames());
      const { context, said } = command();
      setNonInteractive(true);
      const code = await exiting(() =>
        runMigrateCreate(name, { cwd: state.dir }, context)
      ).finally(() => setNonInteractive(false));
      expect(code, said.join("\n")).toBeUndefined();
      const made = migrationNames().filter(base => !before.has(base));
      expect(made).toHaveLength(1);
      return made[0];
    }

    /** Make `base`'s snapshot one an earlier release wrote: no registry metadata, no permissions. */
    function asEarlierRelease(base: string): void {
      const path = join(
        state.dir,
        "migrations",
        "meta",
        `${base}.snapshot.json`
      );
      const snapshot = JSON.parse(readFileSync(path, "utf-8")) as Record<
        string,
        unknown
      >;
      delete snapshot.entities;
      delete snapshot.permissions;
      writeFileSync(path, JSON.stringify(snapshot, null, 2));
    }

    /** `nextly migrate`, which must succeed. */
    async function migrate(cfg: unknown): Promise<void> {
      state.config = cfg;
      tick();
      const { context, said } = command();
      try {
        await runMigrate({ cwd: state.dir, throwOnFailure: true }, context);
      } catch (error) {
        throw new Error(
          `migrate failed: ${messageOf(error)}\n${said.join("\n")}`
        );
      }
    }

    function messageOf(error: unknown): string {
      return NextlyError.is(error)
        ? error.publicMessage
        : String((error as Error).message);
    }

    /** `nextly migrate:down --step <step> --accept-data-loss`; returns its failure, if any, and what it said. */
    async function migrateDown(
      cfg: unknown,
      step = 1
    ): Promise<{ failure: string | undefined; said: string[] }> {
      state.config = cfg;
      tick();
      const { context, said } = command();
      setNonInteractive(true);
      try {
        await runMigrateDown(
          { cwd: state.dir, step, acceptDataLoss: true },
          context
        );
        return { failure: undefined, said };
      } catch (error) {
        return { failure: messageOf(error), said };
      } finally {
        setNonInteractive(false);
      }
    }

    /** `nextly plugins install <name>` with `cfg`. */
    async function install(name: string, cfg: unknown): Promise<void> {
      state.config = cfg;
      tick();
      await runPluginInstall(name, {}, command().context);
    }

    /** `nextly plugins uninstall <name>` with `cfg`. */
    async function uninstall(name: string, cfg: unknown): Promise<void> {
      state.config = cfg;
      tick();
      await runPluginUninstall(
        name,
        { keepData: true, yes: false, consent: EVERY_DELETION },
        command().context
      );
    }

    /** With a connection of the test's own to `url`, closed after. */
    async function on<T>(
      url: string,
      fn: (adapter: DrizzleAdapter) => Promise<T>
    ): Promise<T> {
      const adapter = (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
      try {
        return await fn(adapter);
      } finally {
        await adapter.disconnect();
      }
    }

    /** What the database records as its bookkeeping, as two states compare by it. */
    async function bookkeeping(url: string): Promise<{
      rows: Record<string, ComparedRow>;
      permissions: Record<string, boolean>;
      grants: string[];
      applied: string[];
      columns: string[];
    }> {
      return on(url, async adapter => {
        const rows: Record<string, ComparedRow> = {};
        for (const row of await adapter.executeQuery<Record<string, unknown>>(
          `SELECT * FROM ${q}dynamic_collections${q}`
        )) {
          rows[String(row.slug)] = compared(row);
        }
        const permissions: Record<string, boolean> = {};
        for (const p of await adapter.executeQuery<{
          slug: unknown;
          orphaned: unknown;
        }>(
          `SELECT ${q}slug${q} AS slug, ${q}orphaned_at${q} AS orphaned FROM ${q}permissions${q}`
        )) {
          permissions[String(p.slug)] = p.orphaned != null;
        }
        const grants = (
          await adapter.executeQuery<{ role: unknown; slug: unknown }>(
            `SELECT r.${q}slug${q} AS role, p.${q}slug${q} AS slug FROM ${q}role_permissions${q} rp JOIN ${q}roles${q} r ON r.${q}id${q} = rp.${q}role_id${q} JOIN ${q}permissions${q} p ON p.${q}id${q} = rp.${q}permission_id${q}`
          )
        )
          .map(g => `${String(g.role)}:${String(g.slug)}`)
          .sort();
        const applied = (
          await adapter.executeQuery<{ f: unknown; o: unknown; s: unknown }>(
            `SELECT ${q}filename${q} AS f, ${q}event_type${q} AS o, ${q}status${q} AS s FROM ${q}nextly_schema_events${q}`
          )
        )
          .map(row => `${String(row.f)} ${String(row.o)} ${String(row.s)}`)
          .sort();
        const columns = (await adapter.tableExists(TABLE))
          ? (
              await adapter.executeQuery<{ c: unknown }>(
                dialect === "sqlite"
                  ? `SELECT name AS c FROM pragma_table_info('${TABLE}')`
                  : `SELECT column_name AS c FROM information_schema.columns WHERE table_name = '${TABLE}'${dialect === "mysql" ? " AND table_schema = DATABASE()" : ""}`
              )
            )
              .map(row => String(row.c))
              .sort()
          : [];
        return { rows, permissions, grants, applied, columns };
      });
    }

    /** The record's baseline rows, as the comparison reads them. */
    async function baselineRows(
      url: string
    ): Promise<Record<string, ComparedRow>> {
      const record = await on(url, adapter =>
        readRegistryRecord(adapter.getDrizzle(), dialect)
      );
      expect(record?.baseline).toBeDefined();
      return Object.fromEntries(
        Object.entries(record!.baseline!.collections).map(
          ([slug, row]: [string, BaselineRow]) => [slug, compared(row)]
        )
      );
    }

    /** Where `nextly migrate:status --json` says the registry and the tables disagree. */
    async function disagreements(cfg: unknown): Promise<unknown> {
      state.config = cfg;
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
      return (JSON.parse(printed.join("\n")) as { registry: unknown }).registry;
    }

    const AGREES = {
      missingTables: [],
      missingColumns: [],
      unregistered: [],
      unreadable: [],
    };

    /**
     * A database an earlier release migrated with one migration of its own,
     * whose next `nextly migrate` keeps a baseline at that migration: with no
     * migration carrying the metadata, that run writes the rows from the
     * configuration (`from-configuration`, run here); with the first one
     * carrying it pending, the run records the rows as they stand just before
     * it applies (`before-migration`, left to the caller's next run).
     */
    async function earlierReleaseDatabase(
      kind: "from-configuration" | "before-migration"
    ): Promise<string> {
      const url = await scratch();
      const earlier = await migrateCreate("one", config());
      asEarlierRelease(earlier);
      await migrate(config());
      if (kind === "before-migration") {
        // As the earlier release left it: no record.
        await on(url, adapter =>
          adapter.executeQuery(
            `DELETE FROM ${q}nextly_meta${q} WHERE ${q}key${q} = 'registry_record'`
          )
        );
      }
      return url;
    }

    describe.each(["from-configuration", "before-migration"] as const)(
      "a rollback to the record's point (%s)",
      kind => {
        it("restores the baseline rows, orphans the permission it added and clears the mark it set", async () => {
          const url = await earlierReleaseDatabase(kind);
          const atBaseline = await bookkeeping(url);
          expect(atBaseline.permissions[`archive-${REPORTS}`]).toBe(false);
          // A migration with the metadata: a field, a new app permission,
          // and the app permission `archive` dropped.
          const next = config(["extra"], ["export", "publish"]);
          await migrateCreate("added", next);
          await migrate(next);
          const baseline = await baselineRows(url);
          expect(baseline).toEqual(atBaseline.rows);
          const applied = await bookkeeping(url);
          expect(applied.permissions[`publish-${REPORTS}`]).toBe(false);
          expect(applied.permissions[`archive-${REPORTS}`]).toBe(true);
          expect(applied.grants).toContain(`admin:publish-${REPORTS}`);
          expect(applied.rows[SLUG]).not.toEqual(baseline[SLUG]);

          const { failure, said } = await migrateDown(config());

          expect(failure, said.join("\n")).toBeUndefined();
          const after = await bookkeeping(url);
          expect(after.rows).toEqual(baseline);
          expect(after.columns).not.toContain("extra");
          // Orphaned, with its grants kept; the other's mark cleared.
          expect(after.permissions[`publish-${REPORTS}`]).toBe(true);
          expect(after.permissions[`archive-${REPORTS}`]).toBe(false);
          expect(after.grants).toEqual(applied.grants);
          // Every other permission as it was at the baseline.
          const { [`publish-${REPORTS}`]: added, ...others } =
            after.permissions;
          expect(added).toBe(true);
          expect(others).toEqual(atBaseline.permissions);
          expect(await disagreements(config())).toEqual(AGREES);
        }, 240_000);
      }
    );

    it("leaves what plugin installs and uninstalls wrote, and core's own permissions, as they are", async () => {
      const url = await earlierReleaseDatabase("from-configuration");
      // A core permission a newer release added after the baseline was
      // taken: live, and not in the baseline.
      const core = "read-users";
      await on(url, async adapter => {
        const db = adapter.getDrizzle();
        const record = await readRegistryRecord(db, dialect);
        expect(record?.baseline?.permissions).toContain(core);
        await adapter.executeQuery(
          `DELETE FROM ${q}nextly_meta${q} WHERE ${q}key${q} = 'registry_record'`
        );
        await storeRegistryRecord(db, dialect, {
          ...record!,
          baseline: {
            ...record!.baseline!,
            permissions: record!.baseline!.permissions.filter(
              slug => slug !== core
            ),
          },
        });
      });
      // Between the baseline and the migration: one plugin installed, one
      // installed and uninstalled, and one installed with a permission its
      // next release drops.
      const all = [FIRST, SECOND, THIRD];
      await install(FIRST.name, config([], undefined, all));
      await install(SECOND.name, config([], undefined, all));
      await uninstall(SECOND.name, config([], undefined, all));
      await install(THIRD.name, config([], undefined, all));
      const plugins = [FIRST, SECOND, THIRD_NEXT];
      const next = config(["extra"], ["export", "publish"], plugins);
      await migrateCreate("added", next);
      await migrate(next);
      const applied = await bookkeeping(url);
      expect(applied.permissions["sync-rb-first"]).toBe(false);
      expect(applied.permissions["send-rb-second"]).toBe(true);
      expect(applied.permissions["purge-rb-third"]).toBe(true);
      expect(applied.permissions[`archive-${REPORTS}`]).toBe(true);
      expect(applied.grants).toEqual(
        expect.arrayContaining([
          "admin:sync-rb-first",
          "admin:send-rb-second",
          "admin:purge-rb-third",
        ])
      );

      // The build goes back with the migration: the third plugin's release
      // that still declares `purge-rb-third`.
      const back = config([], undefined, all);
      const { failure, said } = await migrateDown(back);

      expect(failure, said.join("\n")).toBeUndefined();
      const after = await bookkeeping(url);
      // The installed plugins' permissions live, the uninstalled one's still
      // orphaned, and core's live, with every grant as it was.
      expect(after.permissions["sync-rb-first"]).toBe(false);
      expect(after.permissions["tally-rb-third"]).toBe(false);
      expect(after.permissions["purge-rb-third"]).toBe(false);
      expect(after.permissions["send-rb-second"]).toBe(true);
      expect(after.permissions[core]).toBe(false);
      expect(after.permissions[`publish-${REPORTS}`]).toBe(true);
      expect(after.permissions[`archive-${REPORTS}`]).toBe(false);
      expect(after.grants).toEqual(applied.grants);
      expect(after.rows).toEqual(await baselineRows(url));
      expect(await disagreements(back)).toEqual(AGREES);
    }, 300_000);

    it("clears the mark it set on the app's own permission, while a plugin named app is recorded uninstalled", async () => {
      const url = await earlierReleaseDatabase("from-configuration");
      // A plugin named `app` installed and uninstalled after the baseline:
      // its own permission is orphaned, the app's are not.
      const withApp = config([], undefined, [APP_NAMED]);
      await install(APP_NAMED.name, withApp);
      await uninstall(APP_NAMED.name, withApp);
      const next = config(["extra"], ["export", "publish"], [APP_NAMED]);
      await migrateCreate("added", next);
      await migrate(next);
      const applied = await bookkeeping(url);
      expect(applied.permissions["tally-rb-app"]).toBe(true);
      expect(applied.permissions[`archive-${REPORTS}`]).toBe(true);

      const { failure, said } = await migrateDown(withApp);

      expect(failure, said.join("\n")).toBeUndefined();
      const after = await bookkeeping(url);
      // The app's permission the migration orphaned is the app's, whatever
      // owner key it shares with the plugin: its mark is cleared. The
      // plugin's own stays as its uninstall left it.
      expect(after.permissions[`archive-${REPORTS}`]).toBe(false);
      expect(after.permissions["tally-rb-app"]).toBe(true);
      expect(after.grants).toEqual(applied.grants);
    }, 240_000);

    it("leaves orphaned a permission a plugin's uninstall marked and its reinstalled release no longer declares", async () => {
      const url = await earlierReleaseDatabase("from-configuration");
      const next = config(["extra"], ["export", "publish"]);
      await migrateCreate("added", next);
      await migrate(next);
      // After the migration: installed, uninstalled, and installed again at
      // a release that no longer declares `drop-rb-again`.
      await install(
        AGAIN.name,
        config(["extra"], ["export", "publish"], [AGAIN])
      );
      await uninstall(
        AGAIN.name,
        config(["extra"], ["export", "publish"], [AGAIN])
      );
      await install(
        AGAIN.name,
        config(["extra"], ["export", "publish"], [AGAIN_NEXT])
      );
      const applied = await bookkeeping(url);
      expect(applied.permissions["drop-rb-again"]).toBe(true);
      expect(applied.permissions["keep-rb-again"]).toBe(false);

      const { failure, said } = await migrateDown(
        config([], undefined, [AGAIN_NEXT])
      );

      expect(failure, said.join("\n")).toBeUndefined();
      const after = await bookkeeping(url);
      // Neither the baseline nor the rolled-back migration declared it, and
      // the plugin's current release does not: its mark is the uninstall's.
      expect(after.permissions["drop-rb-again"]).toBe(true);
      expect(after.permissions["keep-rb-again"]).toBe(false);
      expect(after.grants).toEqual(applied.grants);
    }, 240_000);

    it("rolls a new site's first migration back to the point before any: no row, its permissions orphaned, core's live", async () => {
      const url = await scratch();
      await migrate(EMPTY);
      const atBaseline = await bookkeeping(url);
      await migrateCreate("first", config([], []));
      await migrate(config([], []));
      const applied = await bookkeeping(url);
      expect(Object.keys(applied.rows)).toEqual([SLUG]);
      expect(applied.permissions[`read-${SLUG}`]).toBe(false);

      const { failure, said } = await migrateDown(EMPTY);

      expect(failure, said.join("\n")).toBeUndefined();
      const after = await bookkeeping(url);
      expect(after.rows).toEqual({});
      for (const action of ["create", "read", "update", "delete"]) {
        expect(after.permissions[`${action}-${SLUG}`]).toBe(true);
      }
      // Every permission the baseline holds, core's all of them, still live.
      for (const slug of Object.keys(atBaseline.permissions)) {
        expect(after.permissions[slug], slug).toBe(false);
      }
      expect(after.grants).toEqual(applied.grants);
      expect(await disagreements(EMPTY)).toEqual(AGREES);
    }, 240_000);

    // On MySQL a schema statement commits as it runs, so the DOWN's own
    // statements cannot be undone with its bookkeeping there.
    it.skipIf(dialect === "mysql")(
      "keeps nothing of the rollback when its bookkeeping cannot be written",
      async () => {
        const url = await earlierReleaseDatabase("from-configuration");
        const next = config(["extra"], ["export", "publish"]);
        const added = await migrateCreate("added", next);
        await migrate(next);
        const before = await bookkeeping(url);

        state.marksFail = true;
        const { failure } = await migrateDown(config());

        expect(failure).toBeDefined();
        expect(state.marksFail).toBe(false);
        const after = await bookkeeping(url);
        // The DOWN, its recorded rollback and the rows written back are
        // undone with the marks: the migration is still applied, its column
        // still there, and the registry and permissions as they were.
        expect(after.columns).toContain("extra");
        expect(after.rows).toEqual(before.rows);
        expect(after.permissions).toEqual(before.permissions);
        expect(after.grants).toEqual(before.grants);
        // The ledger says only that the rollback failed.
        expect(after.applied).toEqual(
          [...before.applied, `${added}.sql file_rollback failed`].sort()
        );
      },
      240_000
    );

    it.runIf(dialect === "mysql")(
      "on MySQL, leaves the migration recorded applied and its rollback recorded failed when its bookkeeping cannot be written",
      async () => {
        const url = await earlierReleaseDatabase("from-configuration");
        const next = config(["extra"], ["export", "publish"]);
        const added = await migrateCreate("added", next);
        await migrate(next);
        const before = await bookkeeping(url);

        state.marksFail = true;
        const { failure } = await migrateDown(config());

        expect(failure).toBeDefined();
        const after = await bookkeeping(url);
        // The DOWN's schema statements committed as they ran; the rollback
        // is not recorded as done, so the history checks stop the next
        // command until the operator resolves it.
        expect(after.columns).not.toContain("extra");
        expect(after.applied).toEqual(
          [...before.applied, `${added}.sql file_rollback failed`].sort()
        );
        expect(after.permissions).toEqual(before.permissions);
      },
      240_000
    );

    it("refuses a rollback past the record's point, changing nothing and naming the point", async () => {
      const url = await scratch();
      // One migration applied by an earlier release.
      const earliest = await migrateCreate("one", config());
      asEarlierRelease(earliest);
      await migrate(config());
      await on(url, adapter =>
        adapter.executeQuery(
          `DELETE FROM ${q}nextly_meta${q} WHERE ${q}key${q} = 'registry_record'`
        )
      );
      // The first run applies one more without the metadata, then one with
      // it: the record is at the second of the three.
      const second = await migrateCreate("two", config(["extra"]));
      asEarlierRelease(second);
      const full = config(["extra", "more"]);
      await migrateCreate("three", full);
      await migrate(full);
      expect(
        (
          await on(url, adapter =>
            readRegistryRecord(adapter.getDrizzle(), dialect)
          )
        )?.point
      ).toBe(second);

      // The last alone: back to the record's point, with the baseline.
      const last = await migrateDown(config(["extra"]));
      expect(last.failure, last.said.join("\n")).toBeUndefined();
      expect((await bookkeeping(url)).rows).toEqual(await baselineRows(url));
      await migrate(full);

      for (const [step, point] of [
        [2, `${earliest}.sql`],
        [3, "the point before any app migration"],
      ] as const) {
        const before = await bookkeeping(url);
        const refused = await migrateDown(full, step);
        expect(refused.failure, refused.said.join("\n")).toContain(point);
        expect(refused.failure).toContain("nothing records the registry");
        expect(refused.failure).toContain("new migration");
        expect(await bookkeeping(url)).toEqual(before);
      }
    }, 300_000);
  }
);
