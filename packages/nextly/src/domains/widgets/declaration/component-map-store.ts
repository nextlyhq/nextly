/**
 * The plugins this boot resolved, kept for the admin's component-map check.
 *
 * The check compares the app's generated component map with what the config
 * declares, and must read the config as the boot did: a plugin's `setup` may
 * add, rename or replace plugins, and the boot's resolution is the one that
 * decides what runs. Keeping the boot's own resolved list is what makes the
 * check and the generator (which resolves through the same steps) agree.
 *
 * Pinned to `globalThis`, as the widget registry is, so a development reload
 * that re-evaluates this module finds the list the boot left.
 *
 * @module domains/widgets/declaration/component-map-store
 */

import type { PluginDefinition } from "../../../plugins/plugin-context";

const STORE_KEY = "__nextly_admin_component_plugins";

type Holder = Record<string, readonly PluginDefinition[] | undefined>;

/** Records the plugins the boot resolved. Called by the boot's reset. */
export function setAdminComponentPlugins(
  plugins: readonly PluginDefinition[]
): void {
  (globalThis as unknown as Holder)[STORE_KEY] = plugins;
}

/** The plugins the last boot resolved, or `undefined` before any boot. */
export function adminComponentPlugins():
  | readonly PluginDefinition[]
  | undefined {
  return (globalThis as unknown as Holder)[STORE_KEY];
}
