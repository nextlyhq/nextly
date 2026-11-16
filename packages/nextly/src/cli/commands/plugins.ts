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
import { exitWithError, failWithError } from "../errors";
import { installTargetUnclear, pluginNotFound } from "../errors/areas/plugins";
import { createContext, type CommandContext } from "../program";
import { loadConfig } from "../utils/config-loader";
import {
  readDataLossConsent,
  type AcceptDataLossOption,
} from "../utils/data-loss-consent";
import type { Logger } from "../utils/logger";

export { registerPluginsCommand } from "./plugins.command";

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
  list("field groups", info.fieldGroups);
  list("permissions", info.permissions);
  list("events", info.events);
  // Who besides staff the plugin lets sign in, which an operator weighs as
  // they weigh its permissions.
  list("signed-in kinds", info.principalKinds);

  logger.keyValue("routes", String(info.routeCount));
  logger.keyValue("admin menu items", String(info.adminMenuCount));
  logger.keyValue("admin pages", String(info.adminPageCount));
  logger.keyValue("settings page", info.hasSettings ? "yes" : "no");

  // The manifest, which is what an operator reviews before installing: a
  // reach the plugin declared but nobody can see is not reviewable.
  const { manifest } = info;
  list("outbound hosts", manifest.outbound);
  logger.keyValue("raw SQL", manifest.rawSql ? "declared" : "no");
  logger.keyValue(
    "finishes logins",
    manifest.completesLogins ? "declared" : "no"
  );
  // Shown even when absent, so "declares none" reads differently from a
  // version the operator expected and the plugin left out.
  logger.keyValue(
    "schemaVersion",
    manifest.schemaVersion === undefined
      ? "not declared"
      : String(manifest.schemaVersion)
  );
  list("secret settings", manifest.secrets);
  list("provides", manifest.provides);
  list(
    "requires",
    Object.entries(manifest.requires).map(
      ([capability, range]) => `${capability} ${range}`
    )
  );
}

/** Load config + introspect all plugins (shared by list + info). */
async function loadPluginInfos(
  options: PluginsCommandOptions
): Promise<PluginInfo[]> {
  const { config, pluginConsent } = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
  });
  // The grants as the app wrote them, read by the loader before any `setup`
  // transformer ran, rather than derived again from the transformed config.
  return collectPluginInfo(
    config as unknown as NextlyServiceConfig,
    config.plugins ?? [],
    { coreVersion: getCoreVersion(), consent: pluginConsent }
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
    failWithError(context.logger, pluginNotFound(name));
    return;
  }
  renderPluginInfo(info, context.logger);
}

/**
 * What `nextly plugins install` was asked to install: one named plugin, every
 * configured one, or — given both or neither — nothing it can act on.
 */
export function installTarget(
  name: string | undefined,
  all: boolean
): { name: string } | "all" | null {
  if (all) return name === undefined ? "all" : null;
  return name === undefined ? null : { name };
}

/** The action of `nextly plugins list`, loaded when it runs. */
export async function pluginsListAction(
  _cmdOptions: unknown,
  cmd: Command
): Promise<void> {
  const globalOpts = cmd.optsWithGlobals();
  const context = createContext(globalOpts);
  try {
    await runPluginsListCommand(
      { config: globalOpts.config, cwd: globalOpts.cwd },
      context
    );
  } catch (error) {
    exitWithError(context.logger, error);
  }
}

/** The action of `nextly plugins install`, loaded when it runs. */
export async function pluginsInstallAction(
  name: string | undefined,
  cmdOptions: {
    all?: boolean;
    acceptDataLoss?: AcceptDataLossOption;
    dryRun?: boolean;
    lockTimeout?: string;
    lockTimeoutTotal?: string;
  },
  cmd: Command
): Promise<void> {
  const globalOpts = cmd.optsWithGlobals();
  const context = createContext(globalOpts);
  // Exactly one of the two: a name with --all would leave which one was
  // meant to the parser's reading of the line.
  const target = installTarget(name, cmdOptions.all === true);
  if (target === null) {
    exitWithError(context.logger, installTargetUnclear(name));
  }
  try {
    // The consent to the data the install's modules delete, as `nextly migrate` reads it.
    const consent = readDataLossConsent({
      flag: cmdOptions.acceptDataLoss,
      warn: message => context.logger.warn(message),
    });
    const options = {
      config: globalOpts.config,
      cwd: globalOpts.cwd,
      consent,
      dryRun: cmdOptions.dryRun === true,
      // Checked by the runner before anything is read (`busyTableBounds`).
      lockTimeout: cmdOptions.lockTimeout,
      lockTimeoutTotal: cmdOptions.lockTimeoutTotal,
    };
    const { runPluginInstall, runPluginInstallAll } = await import(
      "./plugin-lifecycle-runner"
    );
    if (target === "all") await runPluginInstallAll(options, context);
    else await runPluginInstall(target.name, options, context);
  } catch (error) {
    exitWithError(context.logger, error);
  }
}

/** The action of `nextly plugins uninstall`, loaded when it runs. */
export async function pluginsUninstallAction(
  name: string,
  cmdOptions: {
    keepData?: boolean;
    yes?: boolean;
    acceptDataLoss?: AcceptDataLossOption;
    dryRun?: boolean;
    lockTimeout?: string;
    lockTimeoutTotal?: string;
  },
  cmd: Command
): Promise<void> {
  const globalOpts = cmd.optsWithGlobals();
  const context = createContext(globalOpts);
  try {
    const consent = readDataLossConsent({
      flag: cmdOptions.acceptDataLoss,
      warn: message => context.logger.warn(message),
    });
    const { runPluginUninstall } = await import("./plugin-lifecycle-runner");
    await runPluginUninstall(
      name,
      {
        config: globalOpts.config,
        cwd: globalOpts.cwd,
        keepData: cmdOptions.keepData === true,
        yes: cmdOptions.yes === true,
        consent,
        dryRun: cmdOptions.dryRun === true,
        // Checked by the runner before anything is read (`busyTableBounds`).
        lockTimeout: cmdOptions.lockTimeout,
        lockTimeoutTotal: cmdOptions.lockTimeoutTotal,
      },
      context
    );
  } catch (error) {
    exitWithError(context.logger, error);
  }
}

/** The action of `nextly plugins info`, loaded when it runs. */
export async function pluginsInfoAction(
  name: string,
  _cmdOptions: unknown,
  cmd: Command
): Promise<void> {
  const globalOpts = cmd.optsWithGlobals();
  const context = createContext(globalOpts);
  try {
    await runPluginsInfoCommand(
      name,
      { config: globalOpts.config, cwd: globalOpts.cwd },
      context
    );
  } catch (error) {
    exitWithError(context.logger, error);
  }
}
