import type { PluginDefinition } from "./plugin-context";
import { resolutionError } from "./resolution-error";
import { isValidRange, satisfiesRange } from "./semver-range";

/**
 * Boot-check every plugin's `nextly` core range and its `dependsOn` /
 * present `optionalDependsOn` version ranges. Throws fail-fast.
 *
 * Missing-required-dependency *presence* is handled by topoSortPlugins; this
 * function only checks version compatibility of dependencies that ARE present.
 */
export function validatePluginVersions(
  plugins: PluginDefinition[],
  coreVersion: string
): void {
  const byName = new Map(plugins.map(pl => [pl.name, pl]));

  for (const pl of plugins) {
    if (!isValidRange(pl.nextly)) {
      throw resolutionError(
        "invalid-nextly-range",
        `Plugin "${pl.name}" declares an invalid \`nextly\` range "${pl.nextly}".`,
        { plugin: pl.name, range: pl.nextly }
      );
    }
    if (!satisfiesRange(coreVersion, pl.nextly)) {
      throw resolutionError(
        "core-incompatible",
        `Plugin "${pl.name}" requires Nextly ${pl.nextly}, but this is Nextly ${coreVersion}.`,
        { plugin: pl.name, range: pl.nextly, coreVersion }
      );
    }

    for (const [dep, range] of Object.entries(pl.dependsOn ?? {})) {
      const target = byName.get(dep);
      if (!target) continue; // presence error is raised by topoSortPlugins
      if (!satisfiesRange(target.version, range)) {
        throw resolutionError(
          "version-incompatible",
          `Plugin "${pl.name}" requires "${dep}" ${range}, but "${dep}" is ${target.version}.`,
          { plugin: pl.name, dependency: dep, range, actual: target.version }
        );
      }
    }

    for (const [dep, range] of Object.entries(pl.optionalDependsOn ?? {})) {
      const target = byName.get(dep);
      if (target && !satisfiesRange(target.version, range)) {
        throw resolutionError(
          "optional-version-incompatible",
          `Plugin "${pl.name}" optionally depends on "${dep}" ${range}, but "${dep}" is ${target.version}.`,
          { plugin: pl.name, dependency: dep, range, actual: target.version }
        );
      }
    }
  }
}
