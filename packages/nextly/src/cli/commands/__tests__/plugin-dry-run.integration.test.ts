/**
 * `nextly plugins install --dry-run` and `plugins uninstall --dry-run` name
 * what the real command would do and change nothing, on every dialect.
 *
 * The plugin has two modules, one creating `lc__notes` and one `lc__tags`.
 * The install's dry run names both modules and the lifecycle record, and says
 * its `onInstall` is not simulated; the real install then applies them. The
 * uninstall's dry run names each module's DOWN and the tables it drops, in
 * the data-loss consent's own words, and with `--keep-data` names no drop and
 * keeps the owner rows as orphaned; the real uninstall then drops them. With
 * `--all`, a plugin depending on another is planned as if the install before
 * it had run, while alone it is refused as the real install refuses it.
 *
 * Only the config is faked: the adapter is a real one over a throwaway
 * database, and the modules come from the real generator.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildExtensionSchema } from "../../../domains/schema/extension/build-extension-schema";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { buildPluginMigration } from "../../../domains/schema/migrate-create/generate-plugin";
import { reconcileCore } from "../../../domains/schema/migrate/core-reconcile";
import { resolveDataLossConsent } from "../../../domains/schema/migrate/data-loss-consent";
import type { PluginMigration } from "../../../domains/schema/migrate/plugin/plugin-migration";
import { SchemaOwnersRepository } from "../../../domains/schema/ownership/schema-owners-repository";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { CORE_TABLE_NAMES } from "../../../schemas/index";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import {
  runPluginInstall,
  runPluginInstallAll,
  runPluginUninstall,
} from "../plugin-lifecycle-runner";

const ALL = ["postgresql", "mysql", "sqlite"] as const;

const run = vi.hoisted(() => ({
  dialect: "sqlite" as string,
  adapter: undefined as unknown,
  plugins: [] as unknown[],
}));

vi.mock("../../utils/config-loader", () => ({
  loadConfig: async () => {
    const config = {
      db: { migrationsDir: "./migrations" },
      plugins: run.plugins,
    };
    return { config, appConfig: config, pluginConsent: undefined };
  },
}));

/** The test's adapter, kept connected after the command so the test can read it. */
const kept = () =>
  Object.assign(Object.create(run.adapter as object) as object, {
    disconnect: async () => {},
  });

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: run.dialect,
    databaseUrl: "unused",
  }),
  createCliAdapter: async () => kept(),
  openCommandAdapter: async () => kept(),
}));

const PLUGIN = "@acme/lc";
const DEPENDENT = "@acme/dp";

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
      pluginPrefixes: new Map([[PLUGIN, "lc"]]),
      plugins: [{ owner: { kind: "plugin", id: PLUGIN }, tables }],
    });
    out[dialect] = built.specs;
  }
  return out;
}

/** Two modules: the first creates `lc__notes`, the second `lc__tags`. */
async function generateModules(): Promise<PluginMigration[]> {
  const first = buildPluginMigration({
    pluginName: PLUGIN,
    schemaVersion: 1,
    name: "notes",
    now: new Date(Date.UTC(2026, 10, 5, 10, 0, 0)),
    tablesByDialect: await tablesByDialect([notes]),
    existing: [],
  });
  if (!first) throw new Error("no first module generated");
  const second = buildPluginMigration({
    pluginName: PLUGIN,
    schemaVersion: 2,
    name: "tags",
    now: new Date(Date.UTC(2026, 10, 5, 11, 0, 0)),
    tablesByDialect: await tablesByDialect([notes, tags]),
    existing: [first.module],
  });
  if (!second) throw new Error("no second module generated");
  return [first.module, second.module];
}

let modules: PluginMigration[] = [];

describe.each(getConfiguredTestDialects())(
  "plugins install and uninstall --dry-run (%s)",
  dialect => {
    let handle: TestNextly;
    let lines: string[];
    let context: CommandContext;
    const db = () => handle.adapter.getDrizzle();

    beforeEach(async () => {
      if (modules.length === 0) modules = await generateModules();
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      await reconcileCore({
        db: db(),
        dialect,
        logger: { info: () => {}, warn: () => {} },
      });
      run.dialect = dialect;
      run.adapter = handle.adapter;
      run.plugins = [
        {
          name: PLUGIN,
          version: "1.0.0",
          contributes: {
            schema: {
              prefix: "lc",
              tables: [notes, tags],
              migrations: modules,
            },
          },
        },
      ];
      lines = [];
      const logger = createLogger({ quiet: true });
      logger.info = (message: string) => void lines.push(message);
      context = { logger } as unknown as CommandContext;
    });

    afterEach(async () => {
      await handle?.destroy();
    });

    /** Every table, the ledger, and the owner rows. */
    async function state() {
      return {
        tables: (await handle.adapter.listTables()).sort(),
        ledger: (
          await new SchemaEventsRepository(db(), dialect).listFileApplies()
        ).map(row => [row.filename, row.status]),
        lifecycle: (
          await new SchemaEventsRepository(db(), dialect).listPluginLifecycle()
        ).length,
        owners: (await new SchemaOwnersRepository(db(), dialect).read())
          .map(row => `${row.ownerId}:${row.tableName}:${row.state}`)
          .sort(),
      };
    }

    const said = () => lines.join("\n");

    it("install names each module and the record, and changes nothing", async () => {
      const before = await state();

      await runPluginInstall(PLUGIN, { dryRun: true }, context);

      for (const module of modules) expect(said()).toContain(module.name);
      expect(said()).toContain(`Would record ${PLUGIN} as installed`);
      expect(said()).toMatch(/onInstall.*not simulated/);
      expect(said()).toContain("Dry run: nothing was changed.");
      expect(await state()).toEqual(before);

      // The real install applies what the dry run named.
      await runPluginInstall(PLUGIN, {}, context);
      expect(await handle.adapter.tableExists("lc__notes")).toBe(true);
      expect(await handle.adapter.tableExists("lc__tags")).toBe(true);
    });

    it("uninstall names each DOWN and each table it drops, and changes nothing", async () => {
      await runPluginInstall(PLUGIN, {}, context);
      const before = await state();

      lines.length = 0;
      await runPluginUninstall(
        PLUGIN,
        { keepData: false, yes: false, dryRun: true },
        context
      );
      expect(said()).toContain("lc__notes");
      expect(said()).toContain("lc__tags");
      expect(said()).toMatch(/Would remove .*lc__tags/);
      expect(said()).toMatch(/onUninstall.*not simulated/);
      expect(said()).toContain(`Would record ${PLUGIN} as uninstalled`);

      lines.length = 0;
      await runPluginUninstall(
        PLUGIN,
        { keepData: true, yes: false, dryRun: true },
        context
      );
      expect(said()).not.toMatch(/Would remove .*lc__tags/);
      expect(said()).toContain("orphaned");
      expect(await state()).toEqual(before);

      // The real uninstall drops what the dry run named.
      await runPluginUninstall(
        PLUGIN,
        {
          keepData: false,
          yes: false,
          consent: resolveDataLossConsent({ flag: true, env: {} }),
        },
        context
      );
      expect(await handle.adapter.tableExists("lc__tags")).toBe(false);
    });

    it("--all plans a dependent as if the install before it had run; alone it is refused", async () => {
      run.plugins.push({
        name: DEPENDENT,
        version: "1.0.0",
        dependsOn: { [PLUGIN]: "*" },
      });
      const before = await state();

      await runPluginInstallAll({ dryRun: true }, context);
      expect(said()).toContain(`Would record ${PLUGIN} as installed`);
      expect(said()).toContain(`Would record ${DEPENDENT} as installed`);
      expect(said()).not.toContain("A real run would refuse");

      lines.length = 0;
      await runPluginInstall(DEPENDENT, { dryRun: true }, context);
      expect(said()).toContain("A real run would refuse");
      expect(said()).toContain(PLUGIN);
      expect(await state()).toEqual(before);
    });
  }
);
