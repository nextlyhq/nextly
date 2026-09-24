/**
 * Connecting `plugins install` / `plugins uninstall` to a config and a
 * database.
 *
 * Split from `plugin-lifecycle.ts` so the decisions there stay testable
 * without a connection, and from `plugins.ts` so that file keeps its
 * read-only introspection character — `list` and `info` never open a
 * database, and these two always do.
 *
 * @module cli/commands/plugin-lifecycle-runner
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { PluginDefinition } from "../../plugins/plugin-context";
import type { CommandContext } from "../program";
import { createCliAdapter } from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

import { executeTransaction } from "./migrate";
import {
  runPluginInstallCommand,
  runPluginUninstallCommand,
  type LifecyclePlugin,
} from "./plugin-lifecycle";

interface RunnerOptions {
  config?: string;
  cwd?: string;
}

/**
 * The lifecycle view of each configured plugin.
 *
 * Read from the config rather than from the database: which plugins EXIST is
 * the config's answer, and the database only knows which ones have left
 * traces. An uninstall needs both, and conflating them is how a plugin that
 * was removed from config becomes impossible to uninstall.
 */
function toLifecyclePlugins(
  plugins: readonly PluginDefinition[]
): LifecyclePlugin[] {
  return plugins.map(plugin => ({
    name: plugin.name,
    version: plugin.version,
    enabled: plugin.enabled !== false,
    dependsOn: [
      ...(plugin.dependsOn ? Object.keys(plugin.dependsOn) : []),
      ...(plugin.optionalDependsOn
        ? Object.keys(plugin.optionalDependsOn)
        : []),
    ],
    modules: (plugin.contributes?.schema?.migrations ?? []).map(module => ({
      name: module.name,
      // A module with no DOWN on the live dialect cannot be undone. Checked
      // per dialect below, where the dialect is known.
      reversible: true,
    })),
  }));
}

async function connect(options: RunnerOptions, context: CommandContext) {
  const { config } = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
  });
  const adapter = await createCliAdapter({});
  const dialect = adapter.dialect;
  const plugins = toLifecyclePlugins(config.plugins ?? []);

  // Reversibility is a per-DIALECT fact: a module may ship DOWN statements for
  // PostgreSQL and none for SQLite, and an uninstall on the second cannot be
  // completed however complete the first would be.
  const definitions = config.plugins ?? [];
  for (const plugin of plugins) {
    const source = definitions.find(d => d.name === plugin.name);
    const modules = source?.contributes?.schema?.migrations ?? [];
    plugin.modules = modules.map(module => ({
      name: module.name,
      reversible: (module.dialects[dialect]?.down ?? []).length > 0,
    }));
  }

  const drizzleAdapter = adapter as unknown as DrizzleAdapter;

  /**
   * Undo one module, newest first, exactly as the apply path runs its UP.
   *
   * Supplied rather than left undefined: the command calls this optionally,
   * so an absent implementation made `uninstall` log every module as reverted
   * and record the plugin uninstalled while its tables and their data stayed
   * in the database. The statements come from the plugin's own definition —
   * the lifecycle view carries module NAMES, not their SQL.
   */
  const runDown = async (
    plugin: LifecyclePlugin,
    moduleName: string
  ): Promise<number> => {
    const definition = definitions.find(d => d.name === plugin.name);
    const module = (definition?.contributes?.schema?.migrations ?? []).find(
      m => m.name === moduleName
    );
    const statements = module?.dialects[dialect]?.down ?? [];
    if (statements.length === 0) return 0;
    // One transaction for the module, like the UP path: a module half undone
    // is a state no snapshot describes.
    await executeTransaction(drizzleAdapter, dialect, async () => {
      for (const statement of statements) {
        await drizzleAdapter.executeQuery(statement);
      }
    });
    return statements.length;
  };

  /**
   * Apply this plugin's pending modules, through the phase `migrate` uses.
   *
   * Not a second implementation: `runPluginPhase` owns the lock, the ledger,
   * the drop guard and the owner records, and an install that applied modules
   * its own way would record them differently from every later `migrate`.
   * Scoped to the one plugin being installed, which is the only difference.
   */
  const applyMigrations = async (plugin: LifecyclePlugin): Promise<void> => {
    const definition = definitions.find(d => d.name === plugin.name);
    const modules = definition?.contributes?.schema?.migrations ?? [];
    if (definition === undefined || modules.length === 0) return;
    const { runPluginPhase } = await import("./migrate");
    const { pluginMigrationSetsFrom } = await import(
      "../../domains/schema/migrate/plugin/run-plugin-migrations"
    );
    await runPluginPhase({
      dialect,
      db: drizzleAdapter.getDrizzle(),
      adapter,
      migrationsDir: config.db?.migrationsDir ?? "./src/db/migrations",
      logger: context.logger,
      pluginsWithMigrations: new Set([plugin.name]),
      pluginMigrationSets: await pluginMigrationSetsFrom([definition]),
    });
  };

  return {
    adapter,
    dialect,
    applyMigrations,
    // The same cast `migrate` makes: `CLIDatabaseAdapter` is deliberately
    // connect/disconnect/dialect, and the Drizzle handle underneath it is
    // what any command touching data needs.
    db: drizzleAdapter.getDrizzle(),
    plugins,
    definitions,
    migrationsDir: config.db?.migrationsDir,
    logger: context.logger,
    runDown,
  };
}

export async function runPluginInstall(
  name: string,
  options: RunnerOptions,
  context: CommandContext
): Promise<void> {
  const deps = await connect(options, context);
  try {
    await runPluginInstallCommand(name, deps);
  } finally {
    await deps.adapter.disconnect();
  }
}

export async function runPluginUninstall(
  name: string,
  options: RunnerOptions & { keepData: boolean; yes: boolean },
  context: CommandContext
): Promise<void> {
  const deps = await connect(options, context);
  try {
    await runPluginUninstallCommand(
      name,
      { keepData: options.keepData, yes: options.yes },
      deps
    );
  } finally {
    await deps.adapter.disconnect();
  }
}
