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

  return {
    adapter,
    dialect,
    // The same cast `migrate` makes: `CLIDatabaseAdapter` is deliberately
    // connect/disconnect/dialect, and the Drizzle handle underneath it is
    // what any command touching data needs.
    db: (adapter as unknown as DrizzleAdapter).getDrizzle(),
    plugins,
    logger: context.logger,
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
