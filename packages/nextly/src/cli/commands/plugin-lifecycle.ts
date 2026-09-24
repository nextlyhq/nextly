/**
 * `nextly plugins install` and `nextly plugins uninstall`.
 *
 * Subcommands of the EXISTING `plugins` group rather than commands of their
 * own, because `plugins list` and `plugins info` already exist and a plugin's
 * lifecycle belongs beside its introspection.
 *
 * The decisions live in `uninstall-plan.ts`, which is tested without a
 * database. This file is the part that talks to one: connect, take the lock,
 * run the plan, record the outcome.
 *
 * ## Why the plugin must still be in config to be uninstalled
 *
 * Its DOWN statements are its own code. A plugin deleted from config first
 * cannot be uninstalled at all — there is nothing left to ask how to undo its
 * schema — which is why the boot check refuses an `uninstalled` owner that is
 * still listed rather than telling the operator to delete the line.
 *
 * @module cli/commands/plugin-lifecycle
 */

import { createOwnerRegistry } from "../../domains/schema/ownership/owner-registry";
import { SchemaOwnersRepository } from "../../domains/schema/ownership/schema-owners-repository";
import {
  planUninstall,
  type UninstallInput,
} from "../../domains/schema/ownership/uninstall-plan";
import type { CommandContext } from "../program";
import type { CLIDatabaseAdapter } from "../utils/adapter";

/** What both commands need about the configured plugins. */
export interface LifecyclePlugin {
  name: string;
  version: string;
  enabled: boolean;
  dependsOn: string[];
  /** Module names in apply order, and whether each can be undone. */
  modules: { name: string; reversible: boolean }[];
}

export interface PluginLifecycleDeps {
  adapter: CLIDatabaseAdapter;
  db: unknown;
  dialect: "postgresql" | "mysql" | "sqlite";
  plugins: LifecyclePlugin[];
  logger: CommandContext["logger"];
  /**
   * Runs the plugin's own `onInstall` / `onUninstall` against a booted context.
   *
   * REQUIRED, like the two below and for the same reason: while it was
   * optional the one caller never passed it, so both commands reported the
   * hook's work done and no hook ran. A plugin whose `onInstall` seeds a row
   * or registers with an external service was installed without either.
   */
  runLifecycleHook: (
    plugin: LifecyclePlugin,
    hook: "onInstall" | "onUninstall",
    opts: { keepData: boolean }
  ) => Promise<void>;
  /**
   * Executes DOWN statements for one module, newest first.
   *
   * REQUIRED for the same reason: optional, it was never passed, so a
   * confirmed uninstall logged every module as reverted and recorded the
   * plugin uninstalled while its tables and their data stayed exactly where
   * they were.
   */
  runDown: (plugin: LifecyclePlugin, moduleName: string) => Promise<number>;
  /**
   * Applies the plugin's pending migration modules.
   *
   * REQUIRED, like the two above. Install previously recorded a plugin as
   * installed and reported success without applying anything, so an operator
   * was told the tables were there and every later query disagreed. An
   * optional callback is what allowed that: the one caller simply did not
   * pass it, and nothing said so.
   */
  applyMigrations: (plugin: LifecyclePlugin) => Promise<void>;
}

function find(
  plugins: LifecyclePlugin[],
  name: string,
  logger: CommandContext["logger"]
): LifecyclePlugin {
  const plugin = plugins.find(p => p.name === name);
  if (plugin) return plugin;
  // Named rather than "not found": an operator who mistyped needs to see what
  // IS configured, and one whose plugin is genuinely absent needs to know the
  // config is what was consulted.
  logger.error(
    `No plugin named "${name}" is configured. Configured: ${
      plugins.map(p => p.name).join(", ") || "(none)"
    }`
  );
  process.exit(1);
}

/**
 * Install: apply the plugin's pending migrations, then run `onInstall`.
 *
 * A second install re-runs `onInstall` alone, which is why that hook is
 * documented as idempotent — an operator repairing a half-finished install
 * should not have to reason about whether it is safe to repeat.
 */
export async function runPluginInstallCommand(
  name: string,
  deps: PluginLifecycleDeps
): Promise<void> {
  const plugin = find(deps.plugins, name, deps.logger);
  const registry = createOwnerRegistry(
    new SchemaOwnersRepository(deps.db, deps.dialect)
  );

  deps.logger.info(`Installing ${plugin.name}@${plugin.version}...`);

  // BEFORE the hook, because `onInstall` is documented as running against the
  // plugin's own tables: a hook that seeds a row cannot do it into a table no
  // migration has created yet. The phase reports its own applied/adopted
  // counts — this command does not restate them, because a second count is a
  // second thing that can be wrong.
  await deps.applyMigrations(plugin);

  await deps.runLifecycleHook(plugin, "onInstall", { keepData: false });

  const owned = await registry.listByOwner(plugin.name);
  if (owned.length > 0) {
    await registry.setState(plugin.name, "active");
  }

  deps.logger.success(
    `${plugin.name} installed (${String(owned.length)} table(s) recorded).`
  );
}

/**
 * Uninstall: refuse, plan, then execute.
 *
 * Every refusal is decided before anything runs, so a rejected uninstall
 * leaves the database exactly as it found it.
 */
export async function runPluginUninstallCommand(
  name: string,
  opts: { keepData: boolean; yes: boolean },
  deps: PluginLifecycleDeps
): Promise<void> {
  const plugin = find(deps.plugins, name, deps.logger);
  const repository = new SchemaOwnersRepository(deps.db, deps.dialect);
  const registry = createOwnerRegistry(repository);
  const owned = await registry.listByOwner(plugin.name);
  // Element rows on this plugin's tables that somebody else owns — they go
  // with the table on a full uninstall, and the confirmation names them.
  const foreignElements = (
    await repository.read([...new Set(owned.map(row => row.tableName))])
  ).filter(
    row =>
      (row.elementKind ?? "table") !== "table" && row.ownerId !== plugin.name
  );

  const input: UninstallInput = {
    pluginName: plugin.name,
    enabled: deps.plugins
      .filter(p => p.enabled)
      .map(p => ({ name: p.name, dependsOn: p.dependsOn })),
    owned,
    foreignElements,
    modules: plugin.modules,
    keepData: opts.keepData,
  };

  // Throws on a dependent or an irreversible module. Nothing has run yet.
  const plan = planUninstall(input);

  if (plan.tablesDropped.length > 0 && !opts.yes) {
    deps.logger.warn(
      `This will DROP ${String(plan.tablesDropped.length)} table(s) and their data:`
    );
    for (const table of plan.tablesDropped) deps.logger.warn(`  - ${table}`);
    if (plan.elementsDropped.length > 0) {
      deps.logger.warn(
        `...along with ${String(plan.elementsDropped.length)} element(s) other owners added to those tables:`
      );
      for (const element of plan.elementsDropped) {
        deps.logger.warn(`  - ${element}`);
      }
    }
    deps.logger.error(
      "Re-run with --yes to confirm, or --keep-data to leave the tables in place."
    );
    process.exit(1);
  }

  await deps.runLifecycleHook(plugin, "onUninstall", {
    keepData: opts.keepData,
  });

  for (const moduleName of plan.downModules) {
    const executed = await deps.runDown(plugin, moduleName);
    deps.logger.info(
      `Reverted ${moduleName} (${String(executed)} statement(s))`
    );
  }

  await registry.setState(plugin.name, plan.finalState);

  deps.logger.success(
    plan.finalState === "orphaned"
      ? `${plugin.name} uninstalled; its tables were kept and are now orphaned.`
      : `${plugin.name} uninstalled and its tables dropped.`
  );
  // Said every time, because until the line is gone the boot check refuses to
  // start — and an operator who does not know that reads it as a broken app.
  deps.logger.info(
    `Remove "${plugin.name}" from your config to finish. Until you do, boot will refuse to start.`
  );
}
