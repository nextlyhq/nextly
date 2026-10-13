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

import { pluginOfLedgerRow } from "../../domains/schema/events/ledger-scope";
import { qualifiedFilename } from "../../domains/schema/migrate/plugin/plugin-migration";
import { assertDependenciesInstalled } from "../../domains/schema/ownership/install-plan";
import { createOwnerRegistry } from "../../domains/schema/ownership/owner-registry";
import type { PluginLifecycleState } from "../../domains/schema/ownership/plugin-lifecycle-state";
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
  /** Whether it declares `onInstall`, which only the install command runs. */
  hasInstallHook: boolean;
  /**
   * The modules this database has APPLIED, in apply order, and whether each
   * can be undone. Uninstall runs DOWN for these and nothing else.
   */
  modules: { name: string; reversible: boolean }[];
  /**
   * Modules this database has APPLIED that the plugin no longer declares —
   * removed or renamed in a later version. Their DOWN was part of the
   * plugin's code, so nothing left can undo them, and an uninstall that
   * skipped them would leave their schema and data behind while recording
   * the plugin uninstalled.
   */
  unshippedModules: string[];
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
  /** False when the module is marked `transaction: false`. */
  transaction: boolean;
  /**
   * Whether it drops a table or column, or truncates a table, judged the way
   * `migrate:down` judges one (`isDestructiveDown`). A module that drops only
   * a column it added to another table loses data no table count shows.
   */
  destructive: boolean;
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
   * Which of these tables still exist in the database. An uninstall whose
   * modules were already rolled back by `migrate:down --plugin` has owner
   * rows naming tables those DOWNs dropped; only a table still present needs
   * a statement to undo it.
   */
  liveTables: (tables: readonly string[]) => Promise<string[]>;
  /**
   * Applies the plugin's pending migration modules. Called under
   * `underMigrateLock`, and takes no lock of its own: the install holds the
   * lock from the first module through the hook.
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
  /** Each plugin's newest recorded lifecycle state (`readPluginLifecycle`). */
  readLifecycleStates: () => Promise<ReadonlyMap<string, PluginLifecycleState>>;
  /**
   * Record a plugin's lifecycle state (`recordPluginLifecycle`). Recorded for
   * every plugin, beside its owner rows, because a plugin that owns no table
   * has no owner row to carry it.
   */
  recordLifecycleState: (
    plugin: LifecyclePlugin,
    state: PluginLifecycleState
  ) => Promise<void>;
}

/**
 * The modules this database has applied for a plugin that its configured
 * version does not declare, by module name. Owned by the plugin as the ledger
 * reads ownership (`pluginOfLedgerRow`, which splits on the last slash), so a
 * plugin whose name is a prefix of another's never claims that one's modules.
 */
export function unshippedModules(
  pluginName: string,
  declared: readonly string[],
  applied: ReadonlySet<string>
): string[] {
  const shipped = new Set(
    declared.map(name => qualifiedFilename(pluginName, name))
  );
  const prefix = qualifiedFilename(pluginName, "");
  return [...applied]
    .filter(
      filename =>
        pluginOfLedgerRow(filename) === pluginName && !shipped.has(filename)
    )
    .map(filename => filename.slice(prefix.length))
    .sort();
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
  // an enabled dependent remains. Decided here first, so a refusal takes no
  // lock, and again under the lock, where the answer holds until the install
  // is done.
  await assertDependenciesReady(plugin, deps);

  // ONE hold of the migrate lock, from the first module to the hook.
  //
  // The modules used to apply under a lock of their own that was released
  // before the owner rows and `onInstall`. An uninstall starting in that gap
  // could take the lock, roll the just-applied modules down and mark the
  // owner uninstalled — and the install then resumed, marked those rows
  // active again and reported success over dropped tables.
  const owned = await deps.underMigrateLock(async () => {
    await assertDependenciesReady(plugin, deps);

    // BEFORE the hook, because `onInstall` is documented as running against
    // the plugin's own tables: a hook that seeds a row cannot do it into a
    // table no migration has created yet. The phase reports its own
    // applied/adopted counts — this command does not restate them, because a
    // second count is a second thing that can be wrong.
    await deps.applyMigrations(plugin);

    // The owner rows go back to `active`, and the plugin is recorded
    // installed, BEFORE the hook, not after.
    //
    // A REINSTALL is what makes the order load-bearing. After a full
    // uninstall the rows survive marked `uninstalled`, and so does the
    // plugin's own recorded state, and the boot check refuses an
    // `uninstalled` plugin that is still listed in config — deliberately,
    // since that state means "its tables were dropped". `runLifecycleHook`
    // boots the runtime to build the plugin's context, so with the reset
    // after the hook, a reinstall of a plugin declaring `onInstall` could
    // never complete: boot rejected the plugin the install was restoring. A
    // hook that then fails leaves an install to repair by running it again,
    // which the hook is documented to allow.
    const rows = await registry.listByOwner(plugin.name);
    if (rows.length > 0) {
      await registry.setState(plugin.name, "active");
    }
    await deps.recordLifecycleState(plugin, "installed");

    await deps.runLifecycleHook(plugin, "onInstall", { keepData: false });
    return rows;
  });

  deps.logger.success(
    `${plugin.name} installed (${String(owned.length)} table(s) recorded).`
  );
}

/** Refuse an install whose dependencies are not installed, reading now. */
async function assertDependenciesReady(
  plugin: LifecyclePlugin,
  deps: PluginLifecycleDeps
): Promise<void> {
  assertDependenciesInstalled({
    pluginName: plugin.name,
    configured: deps.plugins,
    appliedFilenames: await deps.readAppliedModules(),
    owners: await new SchemaOwnersRepository(deps.db, deps.dialect).read(),
    lifecycle: await deps.readLifecycleStates(),
  });
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
  assertEveryAppliedModuleShipped(plugin);
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
  const plan = await withoutTablesAlreadyGone(planUninstall(input), deps);
  assertTablesCanBeUndone(plugin, plan, deps);

  // Before the confirmation: a DOWN that would be refused is refused whether
  // or not the operator confirms, and asking them to confirm it first only
  // costs them a run.
  const downs =
    plan.downModules.length > 0
      ? await deps.prepareDowns(plugin, plan.downModules)
      : [];

  if (!opts.yes) assertNothingLostUnconfirmed(plugin, plan, downs, deps);

  return { plugin, plan, downs };
}

/**
 * Refuse an uninstall while the database holds a module the plugin no longer
 * ships: one an older version applied, since removed or renamed.
 *
 * Its DOWN is the plugin's own code, so with the module gone nothing here can
 * undo it. Skipping it rolled back only the modules still declared, recorded
 * the plugin uninstalled, and reported success over the missing module's
 * schema, its data and its applied ledger row.
 */
function assertEveryAppliedModuleShipped(plugin: LifecyclePlugin): void {
  if (plugin.unshippedModules.length === 0) return;
  throw new NextlyError({
    code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
    publicMessage:
      `${plugin.name} has migration module(s) applied to this database that its configured version no longer ships: ${plugin.unshippedModules.join(", ")}. ` +
      `A module's DOWN is part of the plugin, so nothing here can undo them. ` +
      `Nothing was changed. Configure the version of ${plugin.name} that ships them, uninstall, then upgrade.`,
    logContext: {
      plugin: plugin.name,
      reason: "applied-module-not-shipped",
      modules: plugin.unshippedModules,
    },
  });
}

/**
 * The plan, without the tables already gone when no module is left to drop
 * them.
 *
 * `migrate:down --plugin` keeps a plugin's owner rows as ownership history
 * after rolling back its last module, though that module's DOWN dropped the
 * tables they name. With no applied module left, those rows read as tables a
 * development push created and nothing can undo, so the uninstall was refused
 * for good: neither `onUninstall` could run nor the plugin's state be
 * recorded, except through `--keep-data`, which says the opposite of what
 * happened. Only a table still in the database needs undoing. With modules to
 * run, the plan stands as it is: their DOWNs drop the tables it names.
 */
async function withoutTablesAlreadyGone(
  plan: UninstallPlan,
  deps: Pick<PluginLifecycleDeps, "liveTables">
): Promise<UninstallPlan> {
  if (plan.downModules.length > 0 || plan.tablesDropped.length === 0) {
    return plan;
  }
  const live = await deps.liveTables(plan.tablesDropped);
  if (live.length === plan.tablesDropped.length) return plan;
  return {
    ...plan,
    tablesDropped: live,
    // An element on a table that is gone went with it.
    elementsDropped: live.length === 0 ? [] : plan.elementsDropped,
  };
}

/**
 * Tables to drop, and nothing that would drop them.
 *
 * Development push creates a plugin's tables from the compiled model and
 * records their ownership, without any migration module being applied — so
 * the owner rows name tables to drop while the module list, which is built
 * from the ledger's applied rows, is empty. Running no DOWN statements and
 * marking the plugin `uninstalled` would leave the tables and their data
 * exactly where they were.
 *
 * Refused rather than improvised: the honest answer is that this database
 * has no recorded statement that undoes those tables, and inventing DROPs
 * here would be a destructive path nothing generated and nothing reviewed.
 */
function assertTablesCanBeUndone(
  plugin: LifecyclePlugin,
  plan: UninstallPlan,
  deps: Pick<PluginLifecycleDeps, "logger">
): void {
  if (plan.tablesDropped.length === 0 || plan.downModules.length > 0) return;
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

/**
 * Refuse, without `--yes`, an uninstall that loses data: the tables the
 * plugin owns, and any DOWN that drops a column or truncates without
 * dropping one of them. What would be lost is listed first.
 */
function assertNothingLostUnconfirmed(
  plugin: LifecyclePlugin,
  plan: UninstallPlan,
  downs: readonly PreparedModuleDown[],
  deps: Pick<PluginLifecycleDeps, "logger">
): void {
  const destructiveDowns = downs.filter(down => down.destructive);
  if (plan.tablesDropped.length === 0 && destructiveDowns.length === 0) return;
  warnList(
    deps,
    `This will DROP ${String(plan.tablesDropped.length)} table(s) and their data:`,
    plan.tablesDropped
  );
  warnList(
    deps,
    `...along with ${String(plan.elementsDropped.length)} element(s) other owners added to those tables:`,
    plan.elementsDropped
  );
  warnList(
    deps,
    "These migrations' DOWN drops a table or column, losing its data:",
    destructiveDowns.map(down => down.filename)
  );
  throw new NextlyError({
    code: "PLUGIN_UNINSTALL_UNCONFIRMED",
    publicMessage:
      "Nothing was changed. Re-run with --yes to confirm, or --keep-data to leave the tables in place.",
    logContext: {
      plugin: plugin.name,
      tables: plan.tablesDropped,
      modules: destructiveDowns.map(down => down.filename),
    },
  });
}

/** A heading and one line per item, or nothing when there are none. */
function warnList(
  deps: Pick<PluginLifecycleDeps, "logger">,
  heading: string,
  items: readonly string[]
): void {
  if (items.length === 0) return;
  deps.logger.warn(heading);
  for (const item of items) deps.logger.warn(`  - ${item}`);
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

  // `runDown` names a module whose DOWN runs outside a transaction before
  // it runs, as `migrate:down` does, through the same executor.
  for (const down of downs) {
    const executed = await deps.runDown(plugin, down);
    deps.logger.info(
      `Reverted ${down.moduleName} (${String(executed)} statement(s))`
    );
  }

  await registry.setState(plugin.name, plan.finalState);
  await deps.recordLifecycleState(plugin, plan.finalState);

  deps.logger.success(
    plan.finalState === "orphaned"
      ? `${plugin.name} uninstalled; its tables were kept and are now orphaned.`
      : `${plugin.name} uninstalled and its tables dropped.`
  );
  // Said after every uninstall, and the consequence only where it holds: the
  // boot check refuses a plugin left `uninstalled` that is still configured,
  // and an operator who does not know that reads it as a broken app. An
  // `orphaned` one, whose tables were kept, still boots, and being told it
  // would not is a reason to delete the config line in a hurry.
  deps.logger.info(
    plan.finalState === "uninstalled"
      ? `Remove "${plugin.name}" from your config to finish. Until you do, boot will refuse to start.`
      : `Remove "${plugin.name}" from your config to finish; until you do, it keeps running at boot over its kept tables.`
  );
}
