/**
 * A full `nextly plugins uninstall` of a plugin with an `onUninstall` hook,
 * in production with `db.runMigrationsOnBoot` on, on every configured
 * dialect, through the command's entry point.
 *
 * The hook runs in a boot of the app, inside the migrate lock the command
 * holds, after the uninstall has decided which modules to undo. The plugin
 * ships a second module no migrate has applied yet, so a boot that ran its
 * migrations there would apply it in the middle of the uninstall, creating a
 * table of the plugin's that none of the DOWNs it decided on drops, and the
 * uninstall would refuse. The command boots with them off, and the uninstall
 * completes with that module never applied. Only the
 * config is faked: the adapter is a real one over a throwaway database, the
 * hook's boot is the real one, and the plugin's two modules come from the
 * real generator.
 *
 * Production mode and the boot-migration gate are process state that
 * outlives a test. Both are put back before and after every test, and the
 * last two tests show that what one test leaves does not reach the next.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearServices, destroyRegisteredPlugins } from "../../../di/register";
import { buildExtensionSchema } from "../../../domains/schema/extension/build-extension-schema";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { buildPluginMigration } from "../../../domains/schema/migrate-create/generate-plugin";
import { reconcileCore } from "../../../domains/schema/migrate/core-reconcile";
import { resolveDataLossConsent } from "../../../domains/schema/migrate/data-loss-consent";
import type { PluginMigration } from "../../../domains/schema/migrate/plugin/plugin-migration";
import { assertBootPluginsInstalled } from "../../../domains/schema/ownership/plugin-install-gate";
import { SchemaOwnersRepository } from "../../../domains/schema/ownership/schema-owners-repository";
import { NextlyError } from "../../../errors/nextly-error";
import {
  _resetBootMigrationsGateForTest,
  assertBootMigrationsSettled,
  awaitBootMigrations,
  refuseBootMigrations,
} from "../../../init/boot-migrations-gate";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { CORE_TABLE_NAMES } from "../../../schemas/index";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import {
  runPluginInstall,
  runPluginUninstall,
} from "../plugin-lifecycle-runner";

const ALL = ["postgresql", "mysql", "sqlite"] as const;

const run = vi.hoisted(() => ({
  dialect: "sqlite" as string,
  adapter: undefined as unknown,
  plugin: undefined as unknown,
}));

// The app's config with boot migrations on, which the hook's boot starts
// from, as the loader hands it to the command: its database block filled in
// by the config's own defaults, which a boot that migrates reads.
vi.mock("../../utils/config-loader", async () => {
  const { sanitizeConfig } = await import("../../../shared/types/config");
  return {
    loadConfig: async () => {
      const config = {
        db: sanitizeConfig({ db: { runMigrationsOnBoot: true } }).db,
        plugins: [run.plugin],
      };
      return { config, appConfig: config, pluginConsent: undefined };
    },
  };
});

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: run.dialect,
    databaseUrl: "unused",
  }),
  // The test's adapter, kept connected after the command so the test can
  // read the database.
  createCliAdapter: async () =>
    Object.assign(Object.create(run.adapter as object) as object, {
      disconnect: async () => {},
    }),
}));

const PLUGIN = "@acme/bm";

/** What the environment said before any test changed it. */
const NODE_ENV_AT_START = process.env.NODE_ENV;

/**
 * Puts back what a test may leave in the process: production mode, and the
 * gate's pending boot or recorded refusal, which would make every later boot
 * in this process refuse.
 */
function resetProcessState(): void {
  vi.unstubAllEnvs();
  _resetEnvCache();
  _resetBootMigrationsGateForTest();
}

beforeEach(resetProcessState);
afterEach(resetProcessState);

const context = {
  logger: createLogger({ quiet: true }),
} as unknown as CommandContext;

const notes = defineTable("notes", {
  id: col.id(),
  body: col.shortText({ nullable: true }),
});
const tags = defineTable("tags", {
  id: col.id(),
  label: col.shortText({ nullable: true }),
});

/** The plugin's tables compiled for every dialect by the real builder. */
async function tablesByDialect(tables: ReturnType<typeof defineTable>[]) {
  const out = {} as Parameters<
    typeof buildPluginMigration
  >[0]["tablesByDialect"];
  for (const dialect of ALL) {
    const built = await buildExtensionSchema({
      dialect,
      coreTableNames: CORE_TABLE_NAMES,
      entities: [],
      pluginPrefixes: new Map([[PLUGIN, "bm"]]),
      plugins: [{ owner: { kind: "plugin", id: PLUGIN }, tables }],
    });
    out[dialect] = built.specs;
  }
  return out;
}

/** Two modules: the first creates `bm__notes`, the second `bm__tags`. */
async function generateModules(): Promise<PluginMigration[]> {
  const first = buildPluginMigration({
    pluginName: PLUGIN,
    schemaVersion: 1,
    name: "notes",
    now: new Date(Date.UTC(2026, 10, 3, 10, 0, 0)),
    tablesByDialect: await tablesByDialect([notes]),
    existing: [],
  });
  if (!first) throw new Error("no first module generated");
  const second = buildPluginMigration({
    pluginName: PLUGIN,
    schemaVersion: 2,
    name: "tags",
    now: new Date(Date.UTC(2026, 10, 3, 11, 0, 0)),
    tablesByDialect: await tablesByDialect([notes, tags]),
    existing: [first.module],
  });
  if (!second) throw new Error("no second module generated");
  return [first.module, second.module];
}

let modules: PluginMigration[] = [];

describe.each(getConfiguredTestDialects())(
  "a full plugin uninstall with boot migrations on (%s)",
  dialect => {
    let handle: TestNextly;
    const db = () => handle.adapter.getDrizzle();
    /** Each `onUninstall` call's options, in order. */
    let hookRuns: Array<{ keepData: boolean }> = [];

    beforeEach(async () => {
      if (modules.length === 0) modules = await generateModules();
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      await reconcileCore({
        db: db(),
        dialect,
        logger: { info: () => {}, warn: () => {} },
      });
      hookRuns = [];
      run.dialect = dialect;
      run.adapter = handle.adapter;
      run.plugin = pluginWith(modules);
    });

    /** The plugin, shipping `migrations`, with a hook that records its runs. */
    function pluginWith(migrations: PluginMigration[]) {
      return {
        name: PLUGIN,
        version: "1.0.0",
        // The hook's boot resolves the plugin, which takes this range.
        nextly: ">=0.0.0",
        contributes: {
          schema: { prefix: "bm", tables: [notes, tags], migrations },
        },
        onUninstall: async (_context: unknown, opts: { keepData: boolean }) => {
          hookRuns.push(opts);
        },
      };
    }

    afterEach(async () => {
      await handle?.destroy();
    });

    /** The boot's gate over this database, as a production boot runs it. */
    const boot = () =>
      assertBootPluginsInstalled({
        plugins: [{ name: PLUGIN }],
        readLifecycleEvents: () =>
          new SchemaEventsRepository(db(), dialect).listPluginLifecycle(),
        ledgerExists: async () => true,
        readOwners: () => new SchemaOwnersRepository(db(), dialect).read(),
        registryExists: async () => true,
        production: true,
        warn: () => {},
      });

    const exists = (table: string) => handle.adapter.tableExists(table);

    it("runs the hook and drops its tables in production with boot migrations on", async () => {
      // Installed at its first module; the second ships later, unapplied.
      run.plugin = pluginWith(modules.slice(0, 1));
      await runPluginInstall(PLUGIN, {}, context);
      run.plugin = pluginWith(modules);
      // The hook's boot registers services of its own, which a registration
      // left by the harness's boot would refuse.
      await destroyRegisteredPlugins();
      clearServices();
      vi.stubEnv("NODE_ENV", "production");
      // What a production boot's environment check requires besides the
      // secret, which the harness already gives.
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      _resetEnvCache();

      await runPluginUninstall(
        PLUGIN,
        {
          keepData: false,
          yes: false,
          // Exactly what its one applied module's DOWN drops.
          consent: resolveDataLossConsent({ flag: "bm__notes", env: {} }),
        },
        context
      );

      expect(hookRuns).toEqual([{ keepData: false }]);
      expect(await exists("bm__notes")).toBe(false);
      // Never created: no boot applied the module that makes it.
      expect(await exists("bm__tags")).toBe(false);
      await expect(boot()).rejects.toMatchObject({
        code: "PLUGIN_SCHEMA_UNINSTALLED",
      });
      // The hook's boot settled the gate without refusing, so this process
      // could still serve.
      await expect(awaitBootMigrations()).resolves.toBeUndefined();
    });
  }
);

describe("the process state a test leaves", () => {
  it("is left by a test that refuses boot migrations in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const refusal = new NextlyError({
      code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
      publicMessage: "Boot migrations did not run.",
    });
    refuseBootMigrations(refusal);

    expect(process.env.NODE_ENV).toBe("production");
    await expect(awaitBootMigrations()).rejects.toBe(refusal);
  });

  it("does not reach the next test", async () => {
    expect(process.env.NODE_ENV).toBe(NODE_ENV_AT_START);
    expect(() => assertBootMigrationsSettled()).not.toThrow();
    await expect(awaitBootMigrations()).resolves.toBeUndefined();
  });
});
