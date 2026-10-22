/**
 * A plugin's migration history, checked whole before anything runs.
 *
 * A plugin's history is append-only: its list keeps every module the ledger
 * records applied, unchanged and under its name, and a new module may only
 * follow them. A module edited, removed, renamed or placed before an applied
 * one means the list no longer describes the database, and every migration
 * after that point would run against a state its author never saw.
 *
 * Every check runs before the first module of ANY plugin does — and
 * `migrateCore` runs them before the core reconcile — rather than when the
 * walk reaches the module: a refusal that comes after earlier modules ran
 * leaves the database part-way through a history the code no longer
 * describes.
 *
 * @module domains/schema/migrate/plugin/plugin-history
 * @since 1.0.0
 */
import { NextlyError } from "../../../../errors/nextly-error";
import { pluginOfLedgerRow } from "../../events/ledger-scope";

import {
  assertAppliedUnchanged,
  assertModuleIntact,
  assertModulesInNameOrder,
  assertUniqueModuleNames,
  orderedMigrations,
  qualifiedFilename,
  type PluginMigration,
} from "./plugin-migration";

/** One plugin's modules, as the history checks read them. */
export interface PluginModuleList {
  pluginName: string;
  migrations: readonly PluginMigration[];
}

/**
 * The checks that need no database: each plugin's modules have unique names,
 * are listed in name order, and are intact. Run before the migrate lock is
 * taken, so a list edited by hand is refused before anything waits on the
 * database.
 */
export function assertPluginListsSound(
  lists: readonly PluginModuleList[]
): void {
  // Every plugin's names first: a clash in a later plugin would otherwise be
  // reported only after an earlier plugin's edited module.
  for (const list of lists) {
    assertUniqueModuleNames(list.pluginName, list.migrations);
  }
  for (const list of lists) {
    assertModulesInNameOrder(list.pluginName, list.migrations);
    for (const migration of list.migrations) {
      assertModuleIntact(list.pluginName, migration);
    }
  }
}

/**
 * Every check of every plugin's history: `assertPluginListsSound`, then,
 * against the ledger's applied modules, each plugin's history
 * (`assertPluginHistory`).
 *
 * `declaredPlugins` names every plugin the configuration declares, including
 * one whose list is now empty: such a plugin ships no set to run, but a
 * module the ledger records applied for it was removed all the same. Absent,
 * only the plugins in `lists` are judged.
 */
export function assertPluginHistories(args: {
  lists: readonly PluginModuleList[];
  /** Applied plugin modules by ledger key, with what ran (`appliedPluginShas`). */
  appliedShas: ReadonlyMap<string, string | null>;
  declaredPlugins?: Iterable<string>;
}): void {
  assertPluginListsSound(args.lists);
  const byPlugin = new Map<string, readonly PluginMigration[]>(
    args.lists.map(list => [list.pluginName, list.migrations])
  );
  for (const pluginName of args.declaredPlugins ?? []) {
    if (!byPlugin.has(pluginName)) byPlugin.set(pluginName, []);
  }
  for (const [pluginName, migrations] of byPlugin) {
    assertPluginHistory(pluginName, migrations, args.appliedShas);
  }
}

/**
 * One plugin's list against the ledger: every applied module still listed,
 * each unchanged since it ran, and no pending module before an applied one.
 * Applied rows of other plugins, including one no longer configured, are not
 * this plugin's and are left alone.
 */
function assertPluginHistory(
  pluginName: string,
  migrations: readonly PluginMigration[],
  appliedShas: ReadonlyMap<string, string | null>
): void {
  const ordered = orderedMigrations(migrations);
  const listed = new Set(
    ordered.map(migration => qualifiedFilename(pluginName, migration.name))
  );
  for (const filename of appliedShas.keys()) {
    if (pluginOfLedgerRow(filename) !== pluginName) continue;
    if (!listed.has(filename)) throw appliedModuleMissing(pluginName, filename);
  }
  const applied = ordered.map(migration =>
    appliedShas.has(qualifiedFilename(pluginName, migration.name))
  );
  ordered.forEach((migration, at) => {
    if (!applied[at]) return;
    assertAppliedUnchanged(
      pluginName,
      migration,
      appliedShas.get(qualifiedFilename(pluginName, migration.name)) ?? null
    );
  });
  const lastApplied = applied.lastIndexOf(true);
  const placedBefore = applied.findIndex(
    (isApplied, at) => !isApplied && at < lastApplied
  );
  if (placedBefore !== -1) {
    throw pendingBeforeApplied(
      pluginName,
      ordered[placedBefore].name,
      ordered[lastApplied].name
    );
  }
}

/** The module name of a plugin's ledger key: what follows the last slash. */
function moduleNameOf(filename: string): string {
  return filename.slice(filename.lastIndexOf("/") + 1);
}

function appliedModuleMissing(
  pluginName: string,
  filename: string
): NextlyError {
  const name = moduleNameOf(filename);
  return new NextlyError({
    code: "PLUGIN_MIGRATION_HISTORY_CHANGED",
    publicMessage: `Plugin "${pluginName}" no longer lists its migration "${name}", which the database records as applied. A plugin's applied migrations are never removed or renamed: the database holds what they did, and the migrations after them were written for that. Restore "${name}" under its name. To take it out, roll it back first with \`nextly migrate:down --plugin ${pluginName}\` while it is still listed. Nothing was applied.`,
    logContext: {
      plugin: pluginName,
      migration: name,
      ledgerKey: filename,
      reason: "applied-module-missing",
    },
  });
}

function pendingBeforeApplied(
  pluginName: string,
  pending: string,
  lastApplied: string
): NextlyError {
  return new NextlyError({
    code: "PLUGIN_MIGRATION_HISTORY_CHANGED",
    publicMessage: `Plugin "${pluginName}" lists a migration "${pending}" that has not run, ordered before "${lastApplied}", which has. A new migration may only follow the ones already applied: run now, it would run after migrations written to come after it. Rename it so its name sorts after "${lastApplied}", as the generator's timestamps do. If it was rolled back by hand, roll back the migrations after it first, or once its changes are in place record it with \`nextly migrate:resolve --applied ${qualifiedFilename(pluginName, pending)}\`. Nothing was applied.`,
    logContext: {
      plugin: pluginName,
      migration: pending,
      lastApplied,
      reason: "pending-before-applied",
    },
  });
}
