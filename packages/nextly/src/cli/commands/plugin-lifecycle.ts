/**
 * `nextly plugins install` and `nextly plugins uninstall`.
 *
 * Subcommands of the EXISTING `plugins` group rather than commands of their
 * own, because `plugins list` and `plugins info` already exist and a plugin's
 * lifecycle belongs beside its introspection.
 *
 * The decisions live in `uninstall-plan.ts`, which is tested without a
 * database. This file is the part that talks to one: decide, take the lock,
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

import { assertDependenciesInstalled } from "../../domains/schema/ownership/install-plan";
import { createOwnerRegistry } from "../../domains/schema/ownership/owner-registry";
import { SchemaOwnersRepository } from "../../domains/schema/ownership/schema-owners-repository";
import {
  planUninstall,
  type UninstallInput,
  type UninstallPlan,
} from "../../domains/schema/ownership/uninstall-plan";
import { NextlyError } from "../../errors/nextly-error";
import type { CommandContext } from "../program";
import type { CLIDatabaseAdapter } from "../utils/adapter";

/** What both commands need about the configured plugins. */
export interface LifecyclePlugin {
  name: string;
  version: string;
  enabled: boolean;
  /** `dependsOn` and `optionalDependsOn` together — what uninstall refuses on. */
  dependsOn: string[];
  /**
   * The two kinds kept apart, for install: a required dependency must be
   * configured and installed, an optional one only installed when configured.
   */
  requires: string[];
  optionallyRequires: string[];
  /**
   * Every module the plugin DECLARES, in apply order — applied or not. Install
   * reads a dependency's to tell whether its install has happened.
   */
  declaredModules: string[];
  /**
   * The modules this database has APPLIED, in apply order, and whether each
   * can be undone. Uninstall runs DOWN for these and nothing else.
   */
  modules: { name: string; reversible: boolean }[];
}

/**
 * One module's DOWN as it will run: verified against its checksums and
 * judged by the drop guard before any module of the uninstall runs, and then
 * executed exactly as judged.
 */
export interface PreparedModuleDown {
  moduleName: string;
  /** The module's ledger key, `plugin:<name>/<module>`. */
  filename: string;
  statements: string[];
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
   * Every named module's DOWN, in the order given, each verified against
   * the checksum it was sealed and applied with and judged by the drop
   * guard. Throws on the first module that fails either, so an uninstall
   * that would be refused part way is refused before anything runs.
   */
  prepareDowns: (
    plugin: LifecyclePlugin,
    moduleNames: readonly string[]
  ) => Promise<PreparedModuleDown[]>;
  /**
   * Executes one prepared module's DOWN statements and records the module
   * rolled back.
   *
   * REQUIRED for the same reason: optional, it was never passed, so a
   * confirmed uninstall logged every module as reverted and recorded the
   * plugin uninstalled while its tables and their data stayed exactly where
   * they were.
   */
  runDown: (
    plugin: LifecyclePlugin,
    down: PreparedModuleDown
  ) => Promise<number>;
  /**
   * Runs `work` holding the migrate lock, after re-reading `plugins` from
   * the ledger, and releases the lock however `work` ends. Throws when the
   * lock cannot be had, without running `work`.
   */
  underMigrateLock: <T>(work: () => Promise<T>) => Promise<T>;
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
  /**
   * Ledger filenames whose newest `file_apply` event is `applied` — the same
   * reading `modules` is built from. Install checks its dependencies against
   * it before anything runs.
   */
  readAppliedModules: () => Promise<ReadonlySet<string>>;
}

function find(plugins: LifecyclePlugin[], name: string): LifecyclePlugin {
  const plugin = plugins.find(p => p.name === name);
  if (plugin) return plugin;
  // Named rather than "not found": an operator who mistyped needs to see what
  // IS configured, and one whose plugin is genuinely absent needs to know the
  // config is what was consulted.
  throw NextlyError.notFound({
    message: `No plugin named "${name}" is configured. Configured: ${
      plugins.map(p => p.name).join(", ") || "(none)"
    }`,
    logContext: { plugin: name },
  });
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
  const plugin = find(deps.plugins, name);
  const registry = createOwnerRegistry(
    new SchemaOwnersRepository(deps.db, deps.dialect)
  );

  deps.logger.info(`Installing ${plugin.name}@${plugin.version}...`);

  // Every dependency installed, or nothing runs.
  //
  // Applying this plugin's modules, activating its owner rows and running its
  // `onInstall` all assume what its dependencies' installs provide — their
  // tables AND whatever their own `onInstall` set up. Nothing downstream
  // checks that: this plugin's SQL fails only if it happens to reference a
  // dependency table, and otherwise the install succeeds without its
  // prerequisite. So it is refused up front, naming each missing dependency
  // and the command that installs it — the mirror of uninstall refusing while
  // an enabled dependent remains.
  //
  // Checked before the migrate lock rather than under it, because holding the
  // lock here would not make the result any more true by the time it matters:
  // the lock is released after this plugin's modules apply, before its owner
  // rows and `onInstall`, so a concurrent change could land after the check
  // either way. The change that would turn a passing check false is a
  // dependency's uninstall, and that refuses while this plugin is configured,
  // enabled and depends on it. A disabled plugin gets no such protection;
  // the opposite race — a dependency finishing its install just after this
  // read — only produces a refusal that a re-run clears.
  assertDependenciesInstalled({
    pluginName: plugin.name,
    configured: deps.plugins,
    appliedFilenames: await deps.readAppliedModules(),
    owners: await new SchemaOwnersRepository(deps.db, deps.dialect).read(),
  });

  // BEFORE the hook, because `onInstall` is documented as running against the
  // plugin's own tables: a hook that seeds a row cannot do it into a table no
  // migration has created yet. The phase reports its own applied/adopted
  // counts — this command does not restate them, because a second count is a
  // second thing that can be wrong.
  await deps.applyMigrations(plugin);

  // The owner rows go back to `active` BEFORE the hook, not after.
  //
  // A REINSTALL is what makes the order load-bearing. After a full uninstall
  // the rows survive marked `uninstalled`, and the boot check refuses an
  // `uninstalled` owner that is still listed in config — deliberately, since
  // that state means "its tables were dropped". `runLifecycleHook` boots the
  // runtime to build the plugin's context, so with the reset after the hook, a
  // reinstall of a plugin declaring `onInstall` could never complete: boot
  // rejected the plugin the install was in the middle of restoring.
  //
  // Migrations still run first, which is the order that matters for the hook's
  // own contract — it reads the plugin's tables, and they have to exist.
  const owned = await registry.listByOwner(plugin.name);
  if (owned.length > 0) {
    await registry.setState(plugin.name, "active");
  }

  await deps.runLifecycleHook(plugin, "onInstall", { keepData: false });

  deps.logger.success(
    `${plugin.name} installed (${String(owned.length)} table(s) recorded).`
  );
}

/** What an uninstall that passed every refusal will do. */
interface UninstallDecision {
  plugin: LifecyclePlugin;
  plan: UninstallPlan;
  /** The modules' DOWNs, newest first, each already verified and judged. */
  downs: PreparedModuleDown[];
}

/**
 * Uninstall: decide, then execute under the migrate lock.
 *
 * Every refusal is decided before the lock is taken and before anything
 * runs, and is thrown rather than exited on: an exit inside the locked work
 * skips the lock's release, and on PostgreSQL the lock is a row that then
 * blocks every migration until it expires.
 *
 * The decision is made again once the lock is held, against the plan
 * re-read from the ledger there, because the one made before it can be stale
 * by then — and it is that second decision that runs. A refusal from it
 * still leaves the database as it found it: it is thrown before the hook and
 * before any DOWN.
 */
export async function runPluginUninstallCommand(
  name: string,
  opts: { keepData: boolean; yes: boolean },
  deps: PluginLifecycleDeps
): Promise<void> {
  await decideUninstall(name, opts, deps);
  await deps.underMigrateLock(async () => {
    const decision = await decideUninstall(name, opts, deps);
    await executeUninstall(decision, opts, deps);
  });
}

/**
 * Every refusal an uninstall can meet, in the order an operator should see
 * them. Reads the database; changes nothing.
 */
async function decideUninstall(
  name: string,
  opts: { keepData: boolean; yes: boolean },
  deps: PluginLifecycleDeps
): Promise<UninstallDecision> {
  const plugin = find(deps.plugins, name);
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

  // Throws on a dependent or an irreversible module.
  const plan = planUninstall(input);

  // Tables to drop, and nothing that would drop them.
  //
  // Development push creates a plugin's tables from the compiled model and
  // records their ownership, without any migration module being applied — so
  // the owner rows name tables to drop while the module list, which is built
  // from the ledger's applied rows, is empty. Running no DOWN statements and
  // marking the plugin `uninstalled` would leave the tables and their data
  // exactly where they were.
  //
  // Refused rather than improvised: the honest answer is that this database
  // has no recorded statement that undoes those tables, and inventing DROPs
  // here would be a destructive path nothing generated and nothing reviewed.
  if (plan.tablesDropped.length > 0 && plan.downModules.length === 0) {
    for (const table of plan.tablesDropped) deps.logger.warn(`  - ${table}`);
    throw new NextlyError({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      publicMessage:
        `${plugin.name} owns ${String(plan.tablesDropped.length)} table(s), listed above, but this database has no applied migration module to undo them — ` +
        `they were created by a development push rather than by a migration. ` +
        `Nothing was changed. Drop them with a migration, or remove the plugin from config and reset the development database.`,
      logContext: {
        plugin: plugin.name,
        reason: "no-applied-module",
        tables: plan.tablesDropped,
      },
    });
  }

  // Before the confirmation: a DOWN that would be refused is refused whether
  // or not the operator confirms, and asking them to confirm it first only
  // costs them a run.
  const downs =
    plan.downModules.length > 0
      ? await deps.prepareDowns(plugin, plan.downModules)
      : [];

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
    throw new NextlyError({
      code: "PLUGIN_UNINSTALL_UNCONFIRMED",
      publicMessage:
        "Nothing was changed. Re-run with --yes to confirm, or --keep-data to leave the tables in place.",
      logContext: { plugin: plugin.name, tables: plan.tablesDropped },
    });
  }

  return { plugin, plan, downs };
}

/** Runs a decided uninstall: the hook, the DOWNs, the owner state. */
async function executeUninstall(
  { plugin, plan, downs }: UninstallDecision,
  opts: { keepData: boolean },
  deps: PluginLifecycleDeps
): Promise<void> {
  const registry = createOwnerRegistry(
    new SchemaOwnersRepository(deps.db, deps.dialect)
  );

  await deps.runLifecycleHook(plugin, "onUninstall", {
    keepData: opts.keepData,
  });

  for (const down of downs) {
    const executed = await deps.runDown(plugin, down);
    deps.logger.info(
      `Reverted ${down.moduleName} (${String(executed)} statement(s))`
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
