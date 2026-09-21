/**
 * Deciding what an uninstall does, before it does any of it.
 *
 * Separated from the command because every refusal here is the last thing
 * standing between an operator and deleted data, and a decision buried in a
 * CLI handler is one nothing can test without a terminal.
 *
 * ## Why a plugin must still be in config to be uninstalled
 *
 * Its DOWN sections are its own code. A plugin removed from config first
 * cannot be uninstalled at all — there is nothing left to ask how to undo its
 * schema — which is why the boot check refuses an `uninstalled` owner still
 * listed rather than telling people to delete the line and move on.
 *
 * @module domains/schema/ownership/uninstall-plan
 * @since 1.0.0
 */
import { NextlyError } from "../../../errors/nextly-error";

import type { OwnerRecord } from "./owner-registry";

export interface UninstallInput {
  pluginName: string;
  /** Enabled plugins and what each declares a dependency on. */
  enabled: ReadonlyArray<{ name: string; dependsOn: readonly string[] }>;
  /** This plugin's owner rows. */
  owned: readonly OwnerRecord[];
  /** Each module's name and whether it has DOWN statements, in apply order. */
  modules: ReadonlyArray<{ name: string; reversible: boolean }>;
  keepData: boolean;
}

export interface UninstallPlan {
  /** `orphaned` keeps the tables; `uninstalled` means they were dropped. */
  finalState: "orphaned" | "uninstalled";
  /** Modules to run DOWN for, in reverse apply order. Empty when keeping data. */
  downModules: string[];
  /** Tables the operator is about to lose. Empty when keeping data. */
  tablesDropped: string[];
  /** Ledger rows to supersede. */
  supersedeFilenames: string[];
}

/**
 * Plan an uninstall, or refuse it.
 *
 * Refusals come first and in a fixed order, because the operator can only act
 * on one at a time and the most consequential should be the one they see.
 */
export function planUninstall(input: UninstallInput): UninstallPlan {
  assertNoEnabledDependents(input);

  if (input.keepData) {
    // Nothing is executed and nothing is superseded: the tables stay exactly
    // as they are, and `orphaned` records that nobody maintains them now.
    return {
      finalState: "orphaned",
      downModules: [],
      tablesDropped: [],
      supersedeFilenames: [],
    };
  }

  assertEveryModuleReversible(input);

  // Reverse apply order: a later module may depend on what an earlier one
  // created, so undoing forwards would drop a table a later DOWN still needs.
  const reversed = [...input.modules].reverse().map(module => module.name);
  return {
    finalState: "uninstalled",
    downModules: reversed,
    tablesDropped: input.owned.map(row => row.tableName),
    supersedeFilenames: reversed.map(
      name => `plugin:${input.pluginName}/${name}`
    ),
  };
}

/**
 * Refuse while another enabled plugin depends on this one.
 *
 * Dropping its tables would leave the dependent querying something that is no
 * longer there — and the dependent is, by construction, the plugin least able
 * to notice, because it declared the dependency precisely so it could assume
 * the tables exist.
 */
function assertNoEnabledDependents(input: UninstallInput): void {
  const dependents = input.enabled
    .filter(
      plugin =>
        plugin.name !== input.pluginName &&
        plugin.dependsOn.includes(input.pluginName)
    )
    .map(plugin => plugin.name);

  if (dependents.length === 0) return;

  throw new NextlyError({
    code: "PLUGIN_HAS_DEPENDENTS",
    publicMessage: `"${input.pluginName}" cannot be uninstalled while ${dependents.map(d => `"${d}"`).join(", ")} ${dependents.length === 1 ? "depends" : "depend"} on it. Uninstall ${dependents.length === 1 ? "it" : "those"} first, or disable ${dependents.length === 1 ? "it" : "them"}.`,
    logContext: { plugin: input.pluginName, dependents },
  });
}

/**
 * Refuse a full uninstall when any module cannot be undone.
 *
 * Running the reversible ones and stopping at the first irreversible module
 * would leave the schema half-undone, which is a worse state than either end:
 * the plugin's tables partly exist, and no module describes what is there.
 * `--keep-data` is the supported answer.
 */
function assertEveryModuleReversible(input: UninstallInput): void {
  const irreversible = input.modules
    .filter(module => !module.reversible)
    .map(module => module.name);

  if (irreversible.length === 0) return;

  throw new NextlyError({
    code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
    publicMessage: `"${input.pluginName}" has migrations that cannot be undone (${irreversible.join(", ")}). Use --keep-data to leave its tables in place.`,
    logContext: { plugin: input.pluginName, irreversible },
  });
}
