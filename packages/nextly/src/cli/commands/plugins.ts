/**
 * Plugins Command (D48)
 *
 * `nextly plugins list` — table of installed plugins + their contributions.
 * `nextly plugins info <name>` — one plugin's details.
 *
 * Read-only INTROSPECTION: derived from the declarative `contributes` via the
 * pure {@link collectPluginInfo} fold — plugin `init()` is never run. Mirrors the
 * `prune` command shape (pure render + thin command wrapper + register fn).
 *
 * **Runtime restriction:** CLI-only. Do NOT import from runtime code.
 *
 * @module cli/commands/plugins
 * @example
 * ```bash
 * nextly plugins list
 * nextly plugins info @nextlyhq/plugin-form-builder
 * ```
 */

import type { Command } from "commander";

import type { NextlyServiceConfig } from "../../di/register";
import { pluginAdminSlug } from "../../plugins/admin-meta";
import { getCoreVersion } from "../../plugins/core-version";
import {
  collectPluginInfo,
  findPluginInfo,
  type PluginInfo,
} from "../../plugins/plugin-introspection";
import { createContext, type CommandContext } from "../program";
import { loadConfig } from "../utils/config-loader";
import type { Logger } from "../utils/logger";

interface PluginsCommandOptions {
  config?: string;
  cwd?: string;
}

/** Render the plugins list as a table. Pure (logger-only) — unit-testable. */
export function renderPluginsList(
  infos: PluginInfo[],
  logger: Pick<Logger, "header" | "info" | "table">
): void {
  logger.header("Plugins");
  if (infos.length === 0) {
    logger.info("No plugins registered.");
    return;
  }
  logger.table(
    ["name", "version", "enabled", "collections", "routes", "permissions"],
    infos.map(i => [
      i.name,
      i.version,
      i.enabled ? "yes" : "no",
      i.collections.length,
      i.routeCount,
      i.permissions.length,
    ])
  );
}

/** Render one plugin's details. Pure (logger-only) — unit-testable. */
export function renderPluginInfo(
  info: PluginInfo,
  logger: Pick<Logger, "header" | "keyValue" | "item" | "info">
): void {
  logger.header(info.name);
  logger.keyValue("version", info.version);
  logger.keyValue("nextly", info.nextly);
  logger.keyValue("enabled", info.enabled ? "yes" : "no");
  if (info.dependsOn.length > 0) {
    logger.keyValue("dependsOn", info.dependsOn.join(", "));
  }
  if (info.optionalDependsOn.length > 0) {
    logger.keyValue("optionalDependsOn", info.optionalDependsOn.join(", "));
  }
  if (Object.keys(info.renamed).length > 0) {
    logger.keyValue(
      "renamed",
      Object.entries(info.renamed)
        .map(([from, to]) => `${from}→${to}`)
        .join(", ")
    );
  }

  const list = (label: string, values: string[]): void => {
    if (values.length === 0) return;
    logger.keyValue(label, String(values.length));
    for (const v of values) logger.item(v, 1);
  };

  list("collections", info.collections);
  list("singles", info.singles);
  list("components", info.components);
  list("permissions", info.permissions);
  list("events", info.events);

  logger.keyValue("routes", String(info.routeCount));
  logger.keyValue("admin menu items", String(info.adminMenuCount));
  logger.keyValue("admin pages", String(info.adminPageCount));
  logger.keyValue("settings page", info.hasSettings ? "yes" : "no");
}

/** Load config + introspect all plugins (shared by list + info). */
async function loadPluginInfos(
  options: PluginsCommandOptions
): Promise<PluginInfo[]> {
  const { config } = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
  });
  return collectPluginInfo(
    config as unknown as NextlyServiceConfig,
    config.plugins ?? [],
    { coreVersion: getCoreVersion() }
  );
}

/** Execute `nextly plugins list`. */
export async function runPluginsListCommand(
  options: PluginsCommandOptions,
  context: CommandContext
): Promise<void> {
  const infos = await loadPluginInfos(options);
  renderPluginsList(infos, context.logger);
}

/** Execute `nextly plugins info <name>`. Matches by exact name or admin slug. */
export async function runPluginsInfoCommand(
  name: string,
  options: PluginsCommandOptions,
  context: CommandContext
): Promise<void> {
  const infos = await loadPluginInfos(options);
  const info =
    findPluginInfo(infos, name) ??
    infos.find(i => pluginAdminSlug(i.name) === name);

  if (!info) {
    context.logger.error(
      `Plugin "${name}" not found. Run \`nextly plugins list\` to see installed plugins.`
    );
    process.exitCode = 1;
    return;
  }
  renderPluginInfo(info, context.logger);
}

/** Register the `nextly plugins` command group (D48). */
export function registerPluginsCommand(program: Command): void {
  const plugins = program
    .command("plugins")
    .description("Inspect installed plugins and their contributions (D48)");

  plugins
    .command("list")
    .description("List installed plugins and their contributions")
    .action(async (_cmdOptions: unknown, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);
      try {
        await runPluginsListCommand(
          { config: globalOpts.config, cwd: globalOpts.cwd },
          context
        );
      } catch (error) {
        context.logger.error(
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });

  plugins
    .command("info <name>")
    .description(
      "Show one plugin's details (collections, permissions, routes, admin)"
    )
    .action(async (name: string, _cmdOptions: unknown, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);
      try {
        await runPluginsInfoCommand(
          name,
          { config: globalOpts.config, cwd: globalOpts.cwd },
          context
        );
      } catch (error) {
        context.logger.error(
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
