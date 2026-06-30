import type { PluginDefinition } from "./plugin-context";
import { resolutionError } from "./resolution-error";

/**
 * Order plugins so every dependency precedes its dependents. Edges come from
 * `dependsOn` (required) and present `optionalDependsOn`. Array order is the
 * tiebreaker among otherwise-independent plugins. Throws on a missing
 * required dependency or a cycle.
 *
 * Pure — does not read `enabled` (disabled plugins still order, since they still
 * contribute schema).
 */
export function topoSortPlugins(
  plugins: PluginDefinition[]
): PluginDefinition[] {
  const byName = new Map(plugins.map(pl => [pl.name, pl]));
  const order = plugins.map(pl => pl.name);
  const orderIndex = new Map(order.map((n, i) => [n, i]));

  const dependents = new Map<string, Set<string>>(); // dependency -> dependents
  const indegree = new Map<string, number>(order.map(n => [n, 0]));

  for (const pl of plugins) {
    const required = Object.keys(pl.dependsOn ?? {});
    for (const dep of required) {
      if (!byName.has(dep)) {
        throw resolutionError(
          "missing-dependency",
          `Plugin "${pl.name}" depends on "${dep}", which is not registered.`,
          { plugin: pl.name, dependency: dep }
        );
      }
    }
    const edges = [
      ...required,
      ...Object.keys(pl.optionalDependsOn ?? {}).filter(d => byName.has(d)),
    ];
    for (const dep of edges) {
      if (!dependents.has(dep)) dependents.set(dep, new Set());
      if (!dependents.get(dep)!.has(pl.name)) {
        dependents.get(dep)!.add(pl.name);
        indegree.set(pl.name, indegree.get(pl.name)! + 1);
      }
    }
  }

  // Ready set = indegree-0 nodes, always processed in original array order.
  const sortByOrder = (a: string, b: string) =>
    orderIndex.get(a)! - orderIndex.get(b)!;
  const ready = order.filter(n => indegree.get(n) === 0).sort(sortByOrder);

  const result: PluginDefinition[] = [];
  while (ready.length > 0) {
    const name = ready.shift()!;
    result.push(byName.get(name)!);
    for (const dependent of dependents.get(name) ?? []) {
      indegree.set(dependent, indegree.get(dependent)! - 1);
      if (indegree.get(dependent) === 0) {
        ready.push(dependent);
        ready.sort(sortByOrder);
      }
    }
  }

  if (result.length !== plugins.length) {
    const inCycle = order.filter(n => !result.some(r => r.name === n));
    throw resolutionError(
      "dependency-cycle",
      `Plugin dependency cycle detected: ${inCycle.join(" → ")}.`,
      { plugins: inCycle }
    );
  }

  return result;
}
