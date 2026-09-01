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
 * unreachable from outside the admin. That makes the reservation a boundary
 * rather than a check — the property `AGENTS.md` asks for, and the reason the
 * guard is worth having at all.
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
export const componentRegistry = new Map<ComponentPath, ComponentType>();

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
