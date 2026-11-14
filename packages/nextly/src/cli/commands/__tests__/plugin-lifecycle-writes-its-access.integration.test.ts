/**
 * `nextly plugins install` and `uninstall` write the access the plugin's new
 * state brings, in the transaction that records the state, on every
 * configured dialect, with no `nextly migrate` after them.
 *
 * The database starts empty: a scratch database on PostgreSQL and MySQL, a new
 * file on SQLite. It is set up by the commands themselves (`runMigrateCreate`,
 * `runMigrate`, `runPluginInstall`, `runPluginUninstall`); only the config
 * file is not read from disk. The app's last `nextly migrate` ran before the
 * plugins joined the configuration, so every permission of theirs found
 * afterwards is the install's.
 *
 * Two releases are told apart by the version the commands read
 * (`getCoreVersion`) and by their presets, which resolve the app's
 * permissions, none of them a plugin's, differently: the older one (0.9.0) has
 * the viewer preset also grant `export-pla-posts`, which the newer one
 * withholds, and the newer one (0.10.0) has the author preset also grant
 * `delete-pla-posts`, which the older one withholds.
 *
 * - An install adds the plugin's permission and role and sets every preset
 *   role's grants, the admin's grant of the plugin's permission included,
 *   before any start; a production start then serves the plugin with them.
 * - An install stopped after its permissions are written and before the
 *   plugin is recorded installed leaves no permission, role, grant, install
 *   state or release record, and a production start refuses the plugin.
 * - A full uninstall and one keeping data each orphan the plugin's permission
 *   and change no grant; a reinstall clears the mark, the grants as they were.
 *   An uninstall stopped just before its record leaves no orphan mark.
 * - A permission an uninstall orphaned keeps the admin role's grant when
 *   another plugin's install sets the presets again.
 * - A newer release's install sets every preset role's grants to its own and
 *   records itself; an older release's `nextly migrate` then leaves them. One
 *   stopped just before the record leaves every grant and the record as they
 *   were. An uninstall sets no preset grant and records no release.
 * - A `nextly migrate` with an uninstalled plugin still configured leaves its
 *   permission orphaned and its grants as they were, while it still adds an
 *   installed plugin's new permission and a never-installed plugin's.
 * - The uninstall of a plugin named `app`, the key the app's own permissions
 *   are stored under, leaves the app's permission live with its grants.
 * - A migration written before a plugin named `app` joined, which drops one
 *   of the app's own permissions, orphans that permission and not the
 *   plugin's, though both are stored under the owner key `app`.
 * - A migration written after a plugin joined, and applied after its
 *   uninstall, leaves the plugin's permission orphaned, though its snapshot
 *   still declares it: only the plugin's install declares it again.
 * - In production, an older release's install and uninstall are refused
 *   before anything is written, naming the recorded release; the recorded
 *   release's succeed. In development an older release's install goes on.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import {
  ROLE_PRESETS,
  resolvePreset,
  type RolePreset,
} from "../../../auth/role-presets";
import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { PermissionSeedService } from "../../../domains/auth/services/permission-seed-service";
import { readPresetGrantsRelease } from "../../../domains/meta/preset-grants-release";
import { MetaService } from "../../../domains/meta/services/meta-service";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { resolveDataLossConsent } from "../../../domains/schema/migrate/data-loss-consent";
import { readPluginLifecycle } from "../../../domains/schema/ownership/plugin-lifecycle-state";
import { SchemaOwnersRepository } from "../../../domains/schema/ownership/schema-owners-repository";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";
import {
  runPluginInstall,
  runPluginUninstall,
} from "../plugin-lifecycle-runner";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/** The config the commands load, the release they run as, and the failures injected. */
const state = vi.hoisted(() => ({
  config: undefined as unknown,
  dir: "",
  release: "0.10.0",
  /** The lifecycle state whose record fails just before it is written, if any. */
  failRecordOf: undefined as string | undefined,
  /** Whether the release record fails just before it is written. */
  failRelease: false,
  /** How many times an injected failure was reached. */
  injected: 0,
  /** How many times the hooked plugin's `onInstall` ran. */
  hookRuns: 0,
}));

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

/** The release the commands run as. */
vi.mock("../../../plugins/core-version", () => ({
  getCoreVersion: () => state.release,
}));

/** The release record's write, failing just before it where asked. */
vi.mock("../../../domains/meta/preset-grants-release", async importOriginal => {
  const original =
    await importOriginal<
      typeof import("../../../domains/meta/preset-grants-release")
    >();
  return {
    ...original,
    recordPresetGrantsRelease: async (
      ...args: Parameters<typeof original.recordPresetGrantsRelease>
    ) => {
      if (state.failRelease) {
        state.injected += 1;
        throw new Error("stopped just before the release is recorded");
      }
      await original.recordPresetGrantsRelease(...args);
    },
  };
});

/** A plugin's lifecycle record, failing just before it is written where asked. */
vi.mock(
  "../../../domains/schema/ownership/plugin-lifecycle-state",
  async importOriginal => {
    const original =
      await importOriginal<
        typeof import("../../../domains/schema/ownership/plugin-lifecycle-state")
      >();
    return {
      ...original,
      recordPluginLifecycle: async (
        ...args: Parameters<typeof original.recordPluginLifecycle>
      ) => {
        if (state.failRecordOf === args[2].state) {
          state.injected += 1;
          throw new Error(`stopped just before ${args[2].state} is recorded`);
        }
        await original.recordPluginLifecycle(...args);
      },
    };
  }
);

const OLD = "0.9.0";
const NEW = "0.10.0";
type Release = typeof OLD | typeof NEW;

/** A plugin declaring a permission of its own and a role bundling it. */
const FEEDS = definePlugin({
  name: "@test/pla-feeds",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    permissions: [
      { action: "sync", resource: "pla-feeds", label: "Sync feeds" },
    ],
    roles: [
      {
        slug: "pla-syncer",
        name: "Feed syncer",
        permissionSlugs: ["sync-pla-feeds"],
        level: 20,
      },
    ],
  },
});
const FEEDS_PERMISSION = "sync-pla-feeds";

/** Another plugin, whose install sets the presets again. */
const DIGEST = definePlugin({
  name: "@test/pla-digest",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    permissions: [{ action: "send", resource: "pla-digest", label: "Send" }],
  },
});
const DIGEST_PERMISSION = "send-pla-digest";

/** The other plugin's next release, which declares one permission more. */
const DIGEST_NEXT = definePlugin({
  name: "@test/pla-digest",
  version: "1.1.0",
  nextly: "*",
  contributes: {
    permissions: [
      { action: "send", resource: "pla-digest", label: "Send" },
      { action: "schedule", resource: "pla-digest", label: "Schedule" },
    ],
  },
});

/**
 * Plugins named `app`, the key the app's own permissions are stored under:
 * one declaring no permission, and one declaring one of its own.
 */
const APP_NAMED = definePlugin({
  name: "app",
  version: "1.0.0",
  nextly: "*",
  contributes: {},
});
const APP_NAMED_DECLARING = definePlugin({
  name: "app",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    permissions: [{ action: "tally", resource: "pla-app", label: "Tally" }],
  },
});

/** A plugin with an `onInstall`, counting its runs, in two releases. */
const HOOKED = definePlugin({
  name: "@test/pla-hooked",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    permissions: [{ action: "pull", resource: "pla-hooked", label: "Pull" }],
  },
  onInstall: () => {
    state.hookRuns += 1;
  },
});
const HOOKED_NEXT = definePlugin({
  ...HOOKED,
  version: "1.1.0",
  contributes: {
    permissions: [
      { action: "pull", resource: "pla-hooked", label: "Pull" },
      { action: "push", resource: "pla-hooked", label: "Push" },
    ],
  },
});

/** A plugin configured and never installed: no lifecycle record names it. */
const NEVER = definePlugin({
  name: "@test/pla-never",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    permissions: [{ action: "watch", resource: "pla-never", label: "Watch" }],
  },
});

/** The app, with the plugins listed beside it. */
function configWith(...plugins: (typeof FEEDS)[]): unknown {
  return defineConfig({
    collections: [
      defineCollection({
        slug: "pla-posts",
        fields: [text({ name: "title" })],
      }),
    ],
    // The app's own permission, which only the older release's viewer grants.
    permissions: [{ action: "export", resource: "pla-posts" }],
    plugins,
    db: { migrationsDir: "./migrations" },
  });
}

/** The data-loss consent given without targets, as `--accept-data-loss` alone gives it. */
const EVERY_DELETION = resolveDataLossConsent({ flag: true, env: {} });

/** The presets' own rules, put back after each test. */
const original = new Map<string, RolePreset["grants"]>();

function preset(slug: string): RolePreset {
  const found = ROLE_PRESETS.find(p => p.slug === slug);
  if (!found) throw new Error(`no preset ${slug}`);
  return found;
}

/** Run as `release`, with its presets. */
function runAs(release: Release): void {
  state.release = release;
  const viewer = original.get("viewer")!;
  const author = original.get("author")!;
  preset("viewer").grants =
    release === OLD
      ? (p, c) =>
          viewer(p, c) || (p.action === "export" && p.resource === "pla-posts")
      : viewer;
  preset("author").grants =
    release === NEW
      ? (p, c) =>
          author(p, c) || (p.action === "delete" && p.resource === "pla-posts")
      : author;
}

describe.each(getConfiguredTestDialects())(
  "a plugin's install and uninstall write its access (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;
    let started: TestNextly | undefined;
    let clock = 0;
    const q = dialect === "mysql" ? "`" : '"';

    beforeAll(() => {
      for (const p of ROLE_PRESETS) original.set(p.slug, p.grants);
    });

    afterAll(() => {
      for (const p of ROLE_PRESETS) p.grants = original.get(p.slug)!;
    });

    beforeEach(async () => {
      state.dir = mkdtempSync(join(tmpdir(), "nextly-plugin-access-"));
      mkdirSync(join(state.dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(state.dir, "empty.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(
          dialect,
          "nextly_plugin_access"
        );
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      // Production, as a start decides it, unless a test says otherwise.
      vi.stubEnv("NODE_ENV", "production");
      // Which a production environment requires before it opens the database.
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv(
        "NEXTLY_SECRET",
        process.env.NEXTLY_SECRET ??
          "test-secret-must-be-at-least-32-characters-long!!"
      );
      _resetEnvCache();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 12, 12, 0, 0, 0)));
      state.failRecordOf = undefined;
      state.failRelease = false;
      state.injected = 0;
      state.hookRuns = 0;
      runAs(NEW);
    }, 60_000);

    afterEach(async () => {
      await started?.destroy();
      started = undefined;
      vi.restoreAllMocks();
      for (const p of ROLE_PRESETS) p.grants = original.get(p.slug)!;
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

    /** The app's first migration, written before any plugin joined the configuration. */
    async function migrateCreate(
      name = "initial",
      config: unknown = configWith()
    ): Promise<void> {
      state.config = config;
      tick();
      const { context, said } = command();
      setNonInteractive(true);
      const code = await exiting(() =>
        runMigrateCreate(name, { cwd: state.dir }, context)
      ).finally(() => setNonInteractive(false));
      expect(code, said.join("\n")).toBeUndefined();
    }

    /** `nextly migrate` from `release` over `config`, which must succeed. */
    async function migrate(
      release: Release,
      config: unknown = configWith()
    ): Promise<string[]> {
      runAs(release);
      state.config = config;
      tick();
      const { context, said } = command();
      const code = await exiting(() => runMigrate({ cwd: state.dir }, context));
      expect(code, said.join("\n")).toBeUndefined();
      return said;
    }

    /** `nextly plugins install` of `name` from `release`, with every plugin configured. */
    async function install(
      name: string,
      release: Release = NEW,
      plugins: (typeof FEEDS)[] = [FEEDS, DIGEST]
    ): Promise<void> {
      runAs(release);
      state.config = configWith(...plugins);
      tick();
      await runPluginInstall(name, {}, command().context);
    }

    /** `nextly plugins uninstall` of `name` from `release`, with every plugin configured. */
    async function uninstall(
      name: string,
      keepData: boolean,
      release: Release = NEW,
      plugins: (typeof FEEDS)[] = [FEEDS, DIGEST]
    ): Promise<void> {
      runAs(release);
      state.config = configWith(...plugins);
      tick();
      await runPluginUninstall(
        name,
        { keepData, yes: false, consent: EVERY_DELETION },
        command().context
      );
    }

    async function open(): Promise<DrizzleAdapter> {
      return (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
    }

    async function reading<T>(
      read: (adapter: DrizzleAdapter) => Promise<T>
    ): Promise<T> {
      const adapter = await open();
      try {
        return await read(adapter);
      } finally {
        await adapter.disconnect();
      }
    }

    const quiet = {
      debug() {},
      info() {},
      warn() {},
      error() {},
    } as unknown as ConstructorParameters<typeof MetaService>[1];

    /** The recorded release. */
    const recorded = () =>
      reading(adapter =>
        readPresetGrantsRelease(new MetaService(adapter, quiet))
      );

    /** Every grant row of every role, as `<row id> <role> <permission>`, sorted. */
    const grantRows = () =>
      reading(async adapter => {
        const rows = await adapter.executeQuery<Record<string, unknown>>(
          `SELECT rp.${q}id${q} AS id, r.${q}slug${q} AS role, p.${q}slug${q} AS permission FROM ${q}role_permissions${q} rp JOIN ${q}roles${q} r ON r.${q}id${q} = rp.${q}role_id${q} JOIN ${q}permissions${q} p ON p.${q}id${q} = rp.${q}permission_id${q}`
        );
        return rows
          .map(
            row =>
              `${String(row.id)} ${String(row.role)} ${String(row.permission)}`
          )
          .sort();
      });

    /** Every permission, as stored. */
    const permissionRows = () =>
      reading(async adapter => {
        const rows = await adapter.executeQuery<Record<string, unknown>>(
          `SELECT ${q}slug${q} AS slug, ${q}action${q} AS action, ${q}resource${q} AS resource, ${q}owner${q} AS owner, ${q}orphaned_at${q} AS orphaned FROM ${q}permissions${q}`
        );
        return rows
          .map(row => ({
            slug: String(row.slug),
            action: String(row.action),
            resource: String(row.resource),
            owner: row.owner == null ? null : String(row.owner),
            orphaned: row.orphaned != null,
          }))
          .sort((a, b) => a.slug.localeCompare(b.slug));
      });

    /** The permission `slug`, or undefined where there is none. */
    async function permission(
      slug: string
    ): Promise<{ owner: string | null; orphaned: boolean } | undefined> {
      const found = (await permissionRows()).find(row => row.slug === slug);
      return found && { owner: found.owner, orphaned: found.orphaned };
    }

    /** Every role's slug, sorted. */
    const roleSlugs = () =>
      reading(async adapter =>
        (
          await adapter.executeQuery<Record<string, unknown>>(
            `SELECT ${q}slug${q} AS slug FROM ${q}roles${q}`
          )
        )
          .map(row => String(row.slug))
          .sort()
      );

    /** Every plugin's recorded lifecycle state, by name. */
    const lifecycle = () =>
      reading(async adapter => {
        const states = await readPluginLifecycle(
          new SchemaEventsRepository(adapter.getDrizzle(), dialect),
          await new SchemaOwnersRepository(adapter.getDrizzle(), dialect).read()
        );
        return Object.fromEntries(states);
      });

    /** Everything the access writes and the state reach, for a before-and-after comparison. */
    const everything = async () => ({
      lifecycle: await lifecycle(),
      permissions: await permissionRows(),
      roles: await roleSlugs(),
      grants: await grantRows(),
      recorded: await recorded(),
    });

    /** The permission slugs `role` holds, read from `rows`. */
    function held(rows: readonly string[], role: string): string[] {
      return rows
        .map(row => row.split(" "))
        .filter(([, r]) => r === role)
        .map(([, , slug]) => slug)
        .sort();
    }

    /** A production start over the database, with every plugin configured. */
    async function startInProduction(): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      _resetEnvCache();
      return createTestNextly({
        adapter: (await open()) as unknown as NonNullable<
          Parameters<typeof createTestNextly>[0]
        >["adapter"],
        plugins: [FEEDS],
        collections: [
          defineCollection({
            slug: "pla-posts",
            fields: [text({ name: "title" })],
          }),
        ],
      });
    }

    it("adds the plugin's permission and role and sets the presets with no nextly migrate between, and a production start serves it with them", async () => {
      await migrateCreate();
      await migrate(NEW);
      // The control: the app's migrate ran before the plugin joined, so none of it is there yet.
      expect(await permission(FEEDS_PERMISSION)).toBeUndefined();
      expect(held(await grantRows(), "admin")).not.toContain(FEEDS_PERMISSION);

      await install(FEEDS.name);

      // Straight after the install, before any start.
      expect(await permission(FEEDS_PERMISSION)).toEqual({
        owner: FEEDS.name,
        orphaned: false,
      });
      expect(await roleSlugs()).toContain("pla-syncer");
      const rows = await grantRows();
      expect(held(rows, "pla-syncer")).toEqual([FEEDS_PERMISSION]);
      expect(held(rows, "admin")).toContain(FEEDS_PERMISSION);
      expect(await recorded()).toBe(NEW);

      started = await startInProduction();
      expect(held(await grantRows(), "admin")).toContain(FEEDS_PERMISSION);
    }, 240_000);

    it("writes no permission, role, grant or install state when the install stops before it records the plugin installed, and a production start refuses the plugin", async () => {
      await migrateCreate();
      await migrate(NEW);
      const before = await everything();

      // What the install's seeding created, so the stop is shown to come after it.
      const seed = PermissionSeedService.prototype.seedCustomPermissions;
      const created: string[] = [];
      vi.spyOn(
        PermissionSeedService.prototype,
        "seedCustomPermissions"
      ).mockImplementation(async function (
        this: PermissionSeedService,
        ...args: Parameters<typeof seed>
      ) {
        const result = await seed.apply(this, args);
        if (result.created > 0) {
          created.push(...args[0].map(p => `${p.action}-${p.resource}`));
        }
        return result;
      });
      state.failRecordOf = "installed";

      await expect(install(FEEDS.name)).rejects.toThrow(
        "stopped just before installed is recorded"
      );
      expect(state.injected).toBe(1);
      expect(created).toEqual([FEEDS_PERMISSION]);

      expect(await everything()).toEqual(before);
      await expect(startInProduction()).rejects.toMatchObject({
        code: "PLUGIN_NOT_INSTALLED",
      });
    }, 240_000);

    it.each([
      { keepData: false, recordedAs: "uninstalled" },
      { keepData: true, recordedAs: "orphaned" },
    ])(
      "orphans the plugin's permission with every grant kept on an uninstall (keepData: $keepData), and a reinstall clears the mark",
      async ({ keepData, recordedAs }) => {
        await migrateCreate();
        await migrate(NEW);
        await install(FEEDS.name);
        const grants = await grantRows();
        expect(held(grants, "admin")).toContain(FEEDS_PERMISSION);

        await uninstall(FEEDS.name, keepData);

        expect((await lifecycle())[FEEDS.name]).toEqual({ state: recordedAs });
        expect(await permission(FEEDS_PERMISSION)).toEqual({
          owner: FEEDS.name,
          orphaned: true,
        });
        // Row for row, ids included: no grant added, removed or rewritten.
        expect(await grantRows()).toEqual(grants);

        await install(FEEDS.name);

        expect(await permission(FEEDS_PERMISSION)).toEqual({
          owner: FEEDS.name,
          orphaned: false,
        });
        expect(await grantRows()).toEqual(grants);
      },
      240_000
    );

    it("writes no orphan mark when the uninstall stops just before it records the plugin uninstalled", async () => {
      await migrateCreate();
      await migrate(NEW);
      await install(FEEDS.name);
      const grants = await grantRows();

      // What the uninstall marked, so the stop is shown to come after it.
      const mark = PermissionSeedService.prototype.markOrphanedPermissions;
      let marked = 0;
      vi.spyOn(
        PermissionSeedService.prototype,
        "markOrphanedPermissions"
      ).mockImplementation(async function (
        this: PermissionSeedService,
        ...args: Parameters<typeof mark>
      ) {
        const result = await mark.apply(this, args);
        marked += result.created;
        return result;
      });
      state.failRecordOf = "uninstalled";

      await expect(uninstall(FEEDS.name, false)).rejects.toThrow(
        "stopped just before uninstalled is recorded"
      );
      expect(state.injected).toBe(1);
      expect(marked).toBe(1);
      expect(await permission(FEEDS_PERMISSION)).toEqual({
        owner: FEEDS.name,
        orphaned: false,
      });
      expect(await grantRows()).toEqual(grants);

      // Run again, the uninstall finishes, marking it then.
      state.failRecordOf = undefined;
      await uninstall(FEEDS.name, false);
      expect(await permission(FEEDS_PERMISSION)).toEqual({
        owner: FEEDS.name,
        orphaned: true,
      });
      expect(await grantRows()).toEqual(grants);
    }, 240_000);

    it("keeps the admin role's grant of a permission an uninstall orphaned when another install sets the presets, and finds it as it was on a reinstall", async () => {
      await migrateCreate();
      await migrate(NEW);
      await install(FEEDS.name);
      const adminsGrant = (await grantRows()).find(row =>
        row.endsWith(` admin ${FEEDS_PERMISSION}`)
      );
      expect(adminsGrant).toBeDefined();
      await uninstall(FEEDS.name, false);

      // Another plugin's install sets every preset role's grants.
      await install(DIGEST.name);

      const rows = await grantRows();
      // The control: the presets were set, the other plugin's permission granted.
      expect(held(rows, "admin")).toContain(DIGEST_PERMISSION);
      expect(rows).toContain(adminsGrant);
      // The other install did not declare it again.
      expect(await permission(FEEDS_PERMISSION)).toEqual({
        owner: FEEDS.name,
        orphaned: true,
      });

      await install(FEEDS.name);

      expect(await permission(FEEDS_PERMISSION)).toEqual({
        owner: FEEDS.name,
        orphaned: false,
      });
      expect(await grantRows()).toContain(adminsGrant);
    }, 240_000);

    it("sets every preset role's grants as the newer release resolves them and records it, which an older release's migrate then leaves", async () => {
      await migrateCreate();
      await migrate(OLD);
      const older = await grantRows();
      expect(await recorded()).toBe(OLD);
      expect(held(older, "viewer")).toContain("export-pla-posts");
      expect(held(older, "author")).not.toContain("delete-pla-posts");

      await install(FEEDS.name, NEW);

      const rows = await grantRows();
      expect(await recorded()).toBe(NEW);
      // Every preset role's grants are what the newer release's presets
      // resolve to over the permissions stored now, the plugin's and the
      // unrelated app permissions' alike.
      runAs(NEW);
      const live = (await permissionRows()).filter(p => !p.orphaned);
      for (const p of ROLE_PRESETS) {
        expect(held(rows, p.slug), p.slug).toEqual(
          resolvePreset(p, live)
            .map(found => found.slug)
            .sort()
        );
      }
      expect(held(rows, "author")).toContain("delete-pla-posts");
      expect(held(rows, "viewer")).not.toContain("export-pla-posts");
      expect(held(rows, "admin")).toContain(FEEDS_PERMISSION);

      // The older release's migrate leaves them, row for row.
      const said = await migrate(OLD, configWith(FEEDS, DIGEST));
      expect(await grantRows()).toEqual(rows);
      expect(await recorded()).toBe(NEW);
      expect(said.join("\n")).toContain("left as they were");
    }, 240_000);

    it("leaves every preset role's grants and the record as they were when the newer release's install stops just before the record", async () => {
      await migrateCreate();
      await migrate(OLD);
      const before = await everything();
      expect(before.recorded).toBe(OLD);
      state.failRelease = true;

      await expect(install(FEEDS.name, NEW)).rejects.toThrow(
        "stopped just before the release is recorded"
      );
      expect(state.injected).toBeGreaterThan(0);

      expect(await everything()).toEqual(before);
    }, 240_000);

    it("sets no preset grant and records no release on an uninstall", async () => {
      await migrateCreate();
      await migrate(OLD);
      await install(FEEDS.name, OLD);
      const rows = await grantRows();
      expect(await recorded()).toBe(OLD);

      // From the newer release, whose presets would resolve differently.
      await uninstall(FEEDS.name, false, NEW);

      expect(await grantRows()).toEqual(rows);
      expect(await recorded()).toBe(OLD);
    }, 240_000);

    it.each([false, true])(
      "leaves an uninstalled plugin's permission orphaned with its grants when nextly migrate runs with it still configured (keepData: %s), and adds the other plugins'",
      async keepData => {
        await migrateCreate();
        await migrate(NEW);
        await install(FEEDS.name);
        await install(DIGEST.name);
        await uninstall(FEEDS.name, keepData);
        expect(await permission(FEEDS_PERMISSION)).toEqual({
          owner: FEEDS.name,
          orphaned: true,
        });
        const ofFeeds = (rows: string[]) =>
          rows.filter(row => row.endsWith(` ${FEEDS_PERMISSION}`));
        const feedsGrants = ofFeeds(await grantRows());
        expect(feedsGrants.length).toBeGreaterThan(0);

        // The uninstalled plugin is still listed, beside the installed one's
        // next release and a plugin never installed.
        await migrate(NEW, configWith(FEEDS, DIGEST_NEXT, NEVER));

        expect(await permission(FEEDS_PERMISSION)).toEqual({
          owner: FEEDS.name,
          orphaned: true,
        });
        const rows = await grantRows();
        expect(ofFeeds(rows)).toEqual(feedsGrants);
        // The controls: the run did seed the configured plugins it should.
        expect(await permission("schedule-pla-digest")).toEqual({
          owner: DIGEST.name,
          orphaned: false,
        });
        expect(held(rows, "admin")).toContain("schedule-pla-digest");
        expect(await permission("watch-pla-never")).toEqual({
          owner: NEVER.name,
          orphaned: false,
        });
      },
      240_000
    );

    it.each([
      { plugin: APP_NAMED, own: undefined },
      { plugin: APP_NAMED_DECLARING, own: "tally-pla-app" },
    ])(
      "leaves the app's own permission live with its grants on the uninstall of a plugin named app (declaring $own)",
      async ({ plugin, own }) => {
        await migrateCreate();
        await migrate(NEW);
        await install(plugin.name, NEW, [plugin]);
        // The app's own permission, stored under the same owner key.
        expect(await permission("export-pla-posts")).toEqual({
          owner: "app",
          orphaned: false,
        });
        const grants = await grantRows();

        await uninstall(plugin.name, false, NEW, [plugin]);

        expect((await lifecycle()).app).toEqual({ state: "uninstalled" });
        expect(await permission("export-pla-posts")).toEqual({
          owner: "app",
          orphaned: false,
        });
        expect(await grantRows()).toEqual(grants);
        // The control: the plugin's own permission is orphaned by the same run.
        if (own !== undefined) {
          expect(await permission(own)).toEqual({
            owner: "app",
            orphaned: true,
          });
        }
      },
      240_000
    );

    it("orphans the app's dropped permission and not a plugin named app the migration does not record", async () => {
      await migrateCreate();
      await migrate(NEW);
      await install(APP_NAMED_DECLARING.name, NEW, [APP_NAMED_DECLARING]);
      expect(await permission("tally-pla-app")).toEqual({
        owner: "app",
        orphaned: false,
      });

      // The app stops declaring its own permission in a migration written
      // without the plugin in the configuration.
      const without = (config: unknown) => ({
        ...(config as Record<string, unknown>),
        permissions: [],
      });
      await migrateCreate("drop_export", without(configWith()));
      const said = await migrate(NEW, without(configWith(APP_NAMED_DECLARING)));

      // The control: the migration speaks for the app, and its log says so.
      expect(await permission("export-pla-posts")).toEqual({
        owner: "app",
        orphaned: true,
      });
      expect(said.join("\n")).toContain(
        'Permission "export-pla-posts" is no longer declared'
      );
      // The plugin's permission was never marked, not even for the run's
      // own seeding to clear again.
      expect(await permission("tally-pla-app")).toEqual({
        owner: "app",
        orphaned: false,
      });
      expect(said.join("\n")).not.toContain(
        'Permission "tally-pla-app" is no longer declared'
      );
    }, 240_000);

    it.each([false, true])(
      "keeps an uninstalled plugin's permission orphaned when a migration written after it joined applies (keepData: %s)",
      async keepData => {
        await migrateCreate();
        await migrate(NEW);
        await install(FEEDS.name);
        await install(DIGEST.name);
        // Written with both plugins configured, so its snapshot declares their permissions.
        await migrateCreate("plugins_joined", configWith(FEEDS, DIGEST));
        await uninstall(FEEDS.name, keepData);
        expect(await permission(FEEDS_PERMISSION)).toEqual({
          owner: FEEDS.name,
          orphaned: true,
        });
        const grants = await grantRows();

        const said = await migrate(NEW, configWith(FEEDS, DIGEST));

        // The control: the migration applied, its snapshot speaking for both plugins.
        expect(said.join("\n")).toContain("plugins_joined");
        expect(await permission(DIGEST_PERMISSION)).toEqual({
          owner: DIGEST.name,
          orphaned: false,
        });
        expect(await permission(FEEDS_PERMISSION)).toEqual({
          owner: FEEDS.name,
          orphaned: true,
        });
        expect(said.join("\n")).not.toContain(
          `Permission "${FEEDS_PERMISSION}" is declared again`
        );
        expect(await grantRows()).toEqual(grants);
      },
      240_000
    );

    it("refuses an older release's install and uninstall in production, naming the recorded release, and the recorded release's succeed", async () => {
      await migrateCreate();
      await migrate(NEW);
      await install(DIGEST.name, NEW);
      const before = await everything();
      expect(before.recorded).toBe(NEW);

      for (const attempt of [
        () => install(FEEDS.name, OLD),
        () => uninstall(DIGEST.name, false, OLD),
      ]) {
        const refused = attempt();
        await expect(refused).rejects.toMatchObject({ code: "CONFLICT" });
        await expect(refused).rejects.toThrow(
          `Run this command from Nextly ${NEW} or newer`
        );
        expect(await everything()).toEqual(before);
      }

      await install(FEEDS.name, NEW);
      expect(held(await grantRows(), "admin")).toContain(FEEDS_PERMISSION);
      await uninstall(DIGEST.name, false, NEW);
      expect(await lifecycle()).toEqual({
        [FEEDS.name]: { state: "installed" },
        [DIGEST.name]: { state: "uninstalled" },
      });
    }, 240_000);

    it("lets an older release's install go on in development, leaving the presets as the newer release set them", async () => {
      await migrateCreate();
      await migrate(NEW);
      const rows = await grantRows();

      vi.stubEnv("NODE_ENV", "development");
      await install(FEEDS.name, OLD);

      expect((await lifecycle())[FEEDS.name]).toEqual({ state: "installed" });
      expect(await permission(FEEDS_PERMISSION)).toEqual({
        owner: FEEDS.name,
        orphaned: false,
      });
      expect(await recorded()).toBe(NEW);
      // No preset role's grants changed: the older presets did not set them.
      const presets = new Set(ROLE_PRESETS.map(p => p.slug));
      const ofPresets = (all: string[]) =>
        all.filter(row => presets.has(row.split(" ")[1]));
      expect(ofPresets(await grantRows())).toEqual(ofPresets(rows));
    }, 240_000);

    describe("an install of a plugin already recorded installed", () => {
      const DIGEST_SCHEDULE = "schedule-pla-digest";

      /** How many lifecycle events name `name`. */
      const events = (name: string) =>
        reading(
          async adapter =>
            (
              await new SchemaEventsRepository(
                adapter.getDrizzle(),
                dialect
              ).listPluginLifecycle()
            ).filter(row => row.scopeSlug === name).length
        );

      it("adds the permission its upgraded package declares, sets every preset role's grants and records the release, appending no event, with no nextly migrate between", async () => {
        await migrateCreate();
        await migrate(NEW);
        await install(DIGEST.name);
        expect(await events(DIGEST.name)).toBe(1);
        // The control: the first release declares no schedule permission.
        expect(await permission(DIGEST_SCHEDULE)).toBeUndefined();

        await install(DIGEST.name, NEW, [FEEDS, DIGEST_NEXT]);

        expect(await permission(DIGEST_SCHEDULE)).toEqual({
          owner: DIGEST.name,
          orphaned: false,
        });
        expect(held(await grantRows(), "admin")).toContain(DIGEST_SCHEDULE);
        expect(await recorded()).toBe(NEW);
        expect(await events(DIGEST.name)).toBe(1);
        expect((await lifecycle())[DIGEST.name]).toEqual({
          state: "installed",
        });
      }, 240_000);

      it("runs no onInstall, though its upgraded package adds a permission it then holds", async () => {
        await migrateCreate();
        await migrate(NEW);
        await install(HOOKED.name, NEW, [FEEDS, HOOKED]);
        expect(state.hookRuns).toBe(1);

        await install(HOOKED.name, NEW, [FEEDS, HOOKED_NEXT]);

        expect(state.hookRuns).toBe(1);
        expect(await permission("push-pla-hooked")).toEqual({
          owner: HOOKED.name,
          orphaned: false,
        });
        expect(await events(HOOKED.name)).toBe(1);
      }, 240_000);

      it("runs onInstall again, and records the install, after an uninstall", async () => {
        // The control: a finished uninstall makes the next install a first one.
        await migrateCreate();
        await migrate(NEW);
        await install(HOOKED.name, NEW, [FEEDS, HOOKED]);
        await uninstall(HOOKED.name, false, NEW, [FEEDS, HOOKED]);

        await install(HOOKED.name, NEW, [FEEDS, HOOKED]);

        expect(state.hookRuns).toBe(2);
        expect((await lifecycle())[HOOKED.name]).toEqual({
          state: "installed",
        });
      }, 240_000);

      it("sets every preset role's grants as a release whose presets resolve differently does, and records that release, appending no event", async () => {
        await migrateCreate();
        await migrate(OLD);
        await install(FEEDS.name, OLD);
        // The control: the older release's viewer holds the export.
        expect(held(await grantRows(), "viewer")).toContain("export-pla-posts");
        expect(await recorded()).toBe(OLD);

        await install(FEEDS.name, NEW);

        const rows = await grantRows();
        expect(held(rows, "viewer")).not.toContain("export-pla-posts");
        expect(held(rows, "author")).toContain("delete-pla-posts");
        expect(await recorded()).toBe(NEW);
        expect(await events(FEEDS.name)).toBe(1);
      }, 240_000);

      it("writes no permission, grant or release record when it stops just before the release record", async () => {
        // Installed from the older release, so the newer one's repeat install
        // has a release record to write.
        await migrateCreate();
        await migrate(OLD);
        await install(DIGEST.name, OLD);
        runAs(NEW);
        const before = await everything();
        expect(before.recorded).toBe(OLD);

        state.failRelease = true;
        await expect(
          install(DIGEST.name, NEW, [FEEDS, DIGEST_NEXT])
        ).rejects.toThrow("stopped just before the release is recorded");

        expect(state.injected).toBeGreaterThan(0);
        expect(await everything()).toEqual(before);
        expect(await events(DIGEST.name)).toBe(1);
      }, 240_000);

      it("is refused in production from an older release, naming the recorded release, before it adds the upgrade's permission", async () => {
        await migrateCreate();
        await migrate(NEW);
        await install(DIGEST.name, NEW);
        const before = await everything();

        const refused = install(DIGEST.name, OLD, [FEEDS, DIGEST_NEXT]);
        await expect(refused).rejects.toMatchObject({ code: "CONFLICT" });
        await expect(refused).rejects.toThrow(
          `Run this command from Nextly ${NEW} or newer`
        );

        expect(await everything()).toEqual(before);
        expect(await permission(DIGEST_SCHEDULE)).toBeUndefined();
        expect(await events(DIGEST.name)).toBe(1);
      }, 240_000);

      it("clears the orphan mark of a permission it declares again, restoring its grants as they were, appending no event", async () => {
        await migrateCreate();
        await migrate(NEW);
        await install(DIGEST.name, NEW, [FEEDS, DIGEST_NEXT]);
        const scheduleGrants = (rows: readonly string[]) =>
          rows
            .filter(row => row.endsWith(` ${DIGEST_SCHEDULE}`))
            .map(row => row.split(" ").slice(1).join(" "))
            .sort();
        const granted = scheduleGrants(await grantRows());
        expect(granted.length).toBeGreaterThan(0);

        // The app's next migration, written while the configured package
        // no longer declared it, applied: its snapshot speaks for the plugin
        // and leaves the permission out, which orphans it.
        await migrateCreate("digest_drops_schedule", configWith(FEEDS, DIGEST));
        await migrate(NEW, configWith(FEEDS, DIGEST));
        expect(await permission(DIGEST_SCHEDULE)).toEqual({
          owner: DIGEST.name,
          orphaned: true,
        });

        await install(DIGEST.name, NEW, [FEEDS, DIGEST_NEXT]);

        expect(await permission(DIGEST_SCHEDULE)).toEqual({
          owner: DIGEST.name,
          orphaned: false,
        });
        expect(scheduleGrants(await grantRows())).toEqual(granted);
        expect(await events(DIGEST.name)).toBe(1);
      }, 240_000);
    });
  }
);
