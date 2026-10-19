/**
 * Refusing to boot a configured plugin that is not installed, or whose
 * uninstall has begun.
 *
 * A plugin is installed once `nextly plugins install` has recorded it
 * (`plugin-lifecycle-state.ts`). Production refuses one that is not, whatever
 * the migration mode: its `onInstall` has not run, and with migrations at
 * boot its modules would otherwise apply without it. Development warns
 * instead, because there a plugin is added to the config and tried before
 * anyone installs it.
 *
 * A DISABLED plugin is not required to be installed. `enabled: false`
 * withholds its behaviour, hooks included, so no install can run its
 * `onInstall`, and requiring one would refuse every production boot of a
 * config that disables a plugin. Its contributions stay in the schema, so its
 * tables exist; its `onInstall` runs once it is enabled and installed, which
 * this gate then requires like any other.
 *
 * Uninstalled, kept data or not, and an uninstall that stopped part way are
 * refused in every environment, enabled or not: the operator has to finish the uninstall and
 * remove the plugin from the config, or install it again. A development push
 * would otherwise recreate tables an uninstall removed, and a half-removed
 * plugin's code would run over whatever tables are left.
 *
 * Runs before boot migrations, so neither refusal comes after a migration
 * has applied the plugin's modules again.
 *
 * @module domains/schema/ownership/plugin-install-gate
 */
import { NextlyError } from "../../../errors/nextly-error";
import type { SchemaEventRow } from "../events/schema-events-repository";

import type { OwnerRecord } from "./owner-registry";
import {
  readPluginLifecycle,
  type PluginLifecycleRecord,
} from "./plugin-lifecycle-state";

/** The command that finishes an uninstall run with these options. */
function uninstallCommand(name: string, keepData: boolean): string {
  return `nextly plugins uninstall ${name}${keepData ? " --keep-data" : ""}`;
}

/**
 * Refuse a plugin whose recorded state is an uninstall, finished or not —
 * in every environment, enabled or not. An installed record passes.
 */
function refuseUninstallState(
  name: string,
  record: PluginLifecycleRecord
): void {
  if (record.state === "uninstalling") {
    throw new NextlyError({
      code: "PLUGIN_UNINSTALL_UNFINISHED",
      publicMessage: `The uninstall of the plugin "${name}" began and did not finish. Run "${uninstallCommand(name, record.keepData)}" to finish it, or "nextly plugins install ${name}" to reinstate it.`,
      logContext: { plugin: name, keepData: record.keepData },
    });
  }
  if (record.state === "uninstalled" || record.state === "orphaned") {
    throw new NextlyError({
      code: "PLUGIN_SCHEMA_UNINSTALLED",
      publicMessage: `The plugin "${name}" has been uninstalled${record.state === "orphaned" ? ", keeping its data," : ""} but is still listed in your config. Run "nextly plugins install ${name}" to reinstate it, or remove it from the config.`,
      logContext: { plugin: name, state: record.state },
    });
  }
}

/**
 * Refuse a boot over the configured plugins' recorded states.
 *
 * Every plugin that is uninstalled or mid-uninstall refuses on its own,
 * first in config order. Enabled plugins that are not installed are named
 * together, so a production refusal lists every install still to run.
 */
export function assertPluginsInstalled(args: {
  plugins: readonly { name: string; enabled?: boolean }[];
  states: ReadonlyMap<string, PluginLifecycleRecord>;
  production: boolean;
  warn: (message: string) => void;
}): void {
  const notInstalled: string[] = [];
  for (const { name, enabled } of args.plugins) {
    const record = args.states.get(name);
    if (record === undefined) {
      // A disabled plugin is not required to be installed: see the module
      // note. An uninstall state is refused whatever its setting.
      if (enabled !== false) notInstalled.push(name);
      continue;
    }
    refuseUninstallState(name, record);
  }
  if (notInstalled.length === 0) return;

  const commands = notInstalled.map(name => `nextly plugins install ${name}`);
  const message = `${notInstalled.length === 1 ? "A configured plugin has" : "Configured plugins have"} not been installed on this database: ${notInstalled.join(", ")}. Run ${commands.map(command => `"${command}"`).join(", then ")}.`;
  if (!args.production) {
    args.warn(message);
    return;
  }
  throw new NextlyError({
    code: "PLUGIN_NOT_INSTALLED",
    publicMessage: message,
    logContext: { plugins: notInstalled },
  });
}

/**
 * The boot's gate: read every configured plugin's state and judge it.
 *
 * A ledger or owner registry that is not there yet holds no state, so every
 * plugin reads as not installed; one that is there and cannot be read is a
 * fault, and is not turned into an empty reading, which would let an
 * uninstalled plugin boot.
 */
export async function assertBootPluginsInstalled(args: {
  plugins: readonly { name: string; enabled?: boolean }[];
  /** The ledger's `plugin_lifecycle` rows. */
  readLifecycleEvents: () => Promise<SchemaEventRow[]>;
  /** Whether the ledger table exists, asked only when reading it fails. */
  ledgerExists: () => Promise<boolean>;
  readOwners: () => Promise<OwnerRecord[]>;
  /** Whether the owner registry exists, asked only when reading it fails. */
  registryExists: () => Promise<boolean>;
  production: boolean;
  warn: (message: string) => void;
}): Promise<void> {
  if (args.plugins.length === 0) return;
  let events: SchemaEventRow[] = [];
  try {
    events = await args.readLifecycleEvents();
  } catch (error) {
    if (await args.ledgerExists()) throw error;
  }
  let owners: OwnerRecord[] = [];
  try {
    owners = await args.readOwners();
  } catch (error) {
    if (await args.registryExists()) throw error;
  }
  assertPluginsInstalled({
    plugins: args.plugins,
    states: await readPluginLifecycle(
      { listPluginLifecycle: () => Promise.resolve(events) },
      owners
    ),
    production: args.production,
    warn: args.warn,
  });
}
