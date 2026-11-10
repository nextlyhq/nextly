/**
 * The component map itself, and the ONE privileged writer.
 *
 * Split out of `component-registry.ts` because that module is a published
 * subpath — `@nextlyhq/admin/lib/component-registry` — so everything it exports
 * is importable by any plugin. `registerCoreComponent` bypasses the `core#`
 * reservation by design, and exported from there it was a documented way around
 * the guard standing next to it: a plugin could import the bypass and claim
 * `core#TeamSummary` outright.
 *
 * This module is not in the package's `exports` map, so the bypass is
 * unreachable from outside the admin. That is what makes the reservation a
 * boundary rather than a check: a guard with a published way around it
 * constrains nobody, and the way around is the more discoverable of the two.
 *
 * @module lib/plugins/component-registry-internal
 */

import type { ComponentType } from "react";

/** Component path as `"package/path#ExportName"`, or `"core#Export"`. */
export type ComponentPath = string;

/**
 * The prefix core's own dashboard cards resolve under.
 *
 * Reserved because a core widget's DEFINITION names this path and the widget id
 * stays core's, so a plugin registering the same path would replace the body
 * drawn for a card the registry still attributes to core -- a substitution no
 * permission gates, because nothing about the widget changed.
 *
 * A PREFIX, matched with `startsWith` rather than as a substring: a package
 * legitimately named `@acme/core#X` is not core's, and refusing it would reject
 * a valid registration to catch an invalid one.
 */
export const CORE_COMPONENT_PREFIX = "core#";

/** Maps component path strings to actual React components. */
export const componentRegistry: Map<string, ComponentType> = new Map<
  ComponentPath,
  ComponentType
>();

/**
 * The single write into the registry map.
 *
 * Everything that registers a component reaches the map through here, so the
 * reservation in `registerComponent` is complete by CONSTRUCTION rather than by
 * having enumerated the callers.
 */
export function writeComponent(
  path: ComponentPath,
  component: ComponentType<never>
): void {
  componentRegistry.set(path, component as ComponentType);
  // A surface drawn before this component arrived draws it now.
  registryChanged();
}

/**
 * The plugin admin modules whose loading has ended, either way: what was
 * going to register from them has, so a component of theirs still missing
 * is missing rather than on its way.
 */
const settledModules = new Set<string>();

/** Who to tell when a component arrives or a module's loading ends. */
const registryListeners = new Set<() => void>();

/** Bumped on every such change, as the snapshot a React reader compares. */
let registryVersion = 0;

function registryChanged(): void {
  registryVersion += 1;
  for (const listener of registryListeners) listener();
}

/** Records that loading these plugin admin modules has ended. */
export function markModulesSettled(modules: Iterable<string>): void {
  for (const module of modules) settledModules.add(module);
  registryChanged();
}

/** The module a component path loads from: what precedes its `#`. */
function moduleOf(path: ComponentPath): string | undefined {
  const hash = path.indexOf("#");
  return hash === -1 ? undefined : path.slice(0, hash);
}

/**
 * Whether a component path is settled: registered, or its module's loading
 * has ended, so a surface can tell "still loading" from "not there". A path
 * naming no module is settled, as nothing would load it.
 */
export function componentSettled(path: ComponentPath): boolean {
  if (componentRegistry.has(path)) return true;
  const module = moduleOf(path);
  return module === undefined || settledModules.has(module);
}

/** Subscribes to registry changes, for `useSyncExternalStore`. */
export function subscribeToRegistry(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

/** The registry's current version, for `useSyncExternalStore`. */
export function registryVersionNow(): number {
  return registryVersion;
}

/** Forgets which modules have settled, with the registry, for tests. */
export function resetSettledModules(): void {
  settledModules.clear();
  registryChanged();
}

/**
 * Registers a component core itself owns, under the reserved prefix.
 *
 * The only writer permitted past `registerComponent`'s reservation. It lives
 * here rather than beside that guard so it is not on the published subpath: a
 * bypass a plugin can import is not a reservation.
 */
export function registerCoreComponent(
  path: ComponentPath,
  component: ComponentType<never>
): void {
  writeComponent(path, component);
}
