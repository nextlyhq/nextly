/**
 * Deciding whether an install may proceed, before it does anything.
 *
 * The mirror of `uninstall-plan.ts`. Uninstall refuses while an enabled
 * plugin depends on the one being removed; install refuses while a plugin the
 * target depends on is not installed. Without the second, `plugins install
 * <dependent>` applied the dependent's modules, activated its owner rows and
 * ran its `onInstall` over a dependency whose own install — its modules and
 * the setup its `onInstall` performs — had never happened. The dependent's SQL
 * fails only if it happens to reference a dependency table; otherwise the
 * install succeeded with its prerequisite missing.
 *
 * Kept free of any connection, like the uninstall plan: the caller reads the
 * ledger and the owner rows, and this decides from them.
 *
 * @module domains/schema/ownership/install-plan
 * @since 1.0.0
 */
import { NextlyError } from "../../../errors/nextly-error";
import { qualifiedFilename } from "../migrate/plugin/plugin-migration";

import type { OwnerRecord } from "./owner-registry";

/** What the check needs about one configured plugin. */
export interface InstallCandidate {
  name: string;
  /** `dependsOn` keys: must be configured AND installed. */
  requires: readonly string[];
  /** `optionalDependsOn` keys: must be installed only when configured. */
  optionallyRequires: readonly string[];
  /** Every migration module the plugin declares, applied or not. */
  declaredModules: readonly string[];
}

export interface InstallDependencyInput {
  pluginName: string;
  /** Every configured plugin, the target included. */
  configured: readonly InstallCandidate[];
  /**
   * Ledger filenames whose NEWEST `file_apply` event is `applied` — see
   * `appliedFilenames`. A module with an older `applied` row and a newer
   * `rolled_back` one is not applied.
   */
  appliedFilenames: ReadonlySet<string>;
  /** Owner rows; only the dependencies' rows are consulted. */
  owners: readonly OwnerRecord[];
}

/** Why a dependency does not count as installed. */
export type MissingDependency =
  | { name: string; reason: "not-configured" }
  | { name: string; reason: "pending-modules"; pending: string[] }
  | { name: string; reason: "uninstalled" };

/**
 * The target's dependencies that are not installed on this database, in
 * dependency order — a dependency before anything that depends on it, so the
 * list reads as the order to install them in.
 *
 * Transitive: a dependency's own required dependencies, and its configured
 * optional ones, are its prerequisites and so the target's too.
 *
 * "Installed" is decided from the database, not the config:
 * - every module the dependency declares is applied per the ledger, and
 * - none of its owner rows is `uninstalled` — the state a full uninstall
 *   leaves behind, where its tables were dropped.
 *
 * A dependency that declares no modules and has no owner rows has nothing
 * either check could find missing, so it counts as installed.
 */
export function missingDependencies(
  input: InstallDependencyInput
): MissingDependency[] {
  const byName = new Map(input.configured.map(p => [p.name, p]));
  const missing: MissingDependency[] = [];
  const visited = new Set<string>([input.pluginName]);

  const visit = (name: string, required: boolean): void => {
    if (visited.has(name)) return;
    const candidate = byName.get(name);
    if (candidate === undefined) {
      // An optional dependency that is not configured is simply absent — the
      // dependent declared it can run without it.
      if (!required) return;
      visited.add(name);
      missing.push({ name, reason: "not-configured" });
      return;
    }
    visited.add(name);
    // Post-order, so a dependency's own prerequisites are listed before it.
    for (const dep of candidate.requires) visit(dep, true);
    for (const dep of candidate.optionallyRequires) visit(dep, false);

    const reason = notInstalledReason(candidate, input);
    if (reason !== undefined) missing.push(reason);
  };

  const target = byName.get(input.pluginName);
  if (target === undefined) return [];
  for (const dep of target.requires) visit(dep, true);
  for (const dep of target.optionallyRequires) visit(dep, false);
  return missing;
}

function notInstalledReason(
  candidate: InstallCandidate,
  input: InstallDependencyInput
): MissingDependency | undefined {
  const pending = candidate.declaredModules.filter(
    module =>
      !input.appliedFilenames.has(qualifiedFilename(candidate.name, module))
  );
  if (pending.length > 0) {
    return { name: candidate.name, reason: "pending-modules", pending };
  }
  // Anything but `active`. An `orphaned` dependency was uninstalled with
  // `--keep-data`: its tables survive, but its `onUninstall` has run, so
  // whatever its install set up outside those tables may be gone — the same
  // reason a fully uninstalled one is refused.
  const uninstalled = input.owners.some(
    row => row.ownerId === candidate.name && row.state !== "active"
  );
  if (uninstalled) return { name: candidate.name, reason: "uninstalled" };
  return undefined;
}

function describeMissing(dep: MissingDependency): string {
  const install = `run \`nextly plugins install ${dep.name}\``;
  switch (dep.reason) {
    case "not-configured":
      return `  - "${dep.name}": it is not configured — add it to your config, then ${install}`;
    case "pending-modules":
      return `  - "${dep.name}": its migration(s) ${dep.pending.join(", ")} ${dep.pending.length === 1 ? "is" : "are"} not applied — ${install}`;
    case "uninstalled":
      return `  - "${dep.name}": it was uninstalled — ${install}`;
  }
}

/**
 * Refuse an install while any dependency is not installed.
 *
 * Refused rather than installed on the operator's behalf: installing the
 * dependency runs ITS `onInstall` and records ITS owner rows, and that is a
 * decision the operator makes by naming it — the same reason uninstall names
 * dependents instead of removing them.
 */
export function assertDependenciesInstalled(
  input: InstallDependencyInput
): void {
  const missing = missingDependencies(input);
  if (missing.length === 0) return;

  const lines = missing.map(describeMissing);
  throw new NextlyError({
    code: "PLUGIN_DEPENDENCY_NOT_INSTALLED",
    publicMessage:
      `"${input.pluginName}" cannot be installed until ${missing.length === 1 ? "its dependency is" : "its dependencies are"} installed, in this order:\n` +
      `${lines.join("\n")}\n` +
      `Nothing was changed.`,
    logContext: {
      plugin: input.pluginName,
      missing: missing.map(dep => dep.name),
    },
  });
}
