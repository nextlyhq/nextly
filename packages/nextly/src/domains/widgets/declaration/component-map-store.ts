/**
 * The plugins this boot resolved, and the site dashboard it registered, kept
 * for the admin's component-map check.
 *
 * The check compares the app's generated component map with what the config
 * declares, and must read the config as the boot did: a plugin's `setup` may
 * add, rename or replace plugins, and the boot's resolution is the one that
 * decides what runs. Keeping the boot's own resolved list is what makes the
 * check and the generator (which resolves through the same steps) agree. The
 * site's `admin.dashboard` is kept as the boot registered it too, after every
 * plugin's `setup()`, rather than read again from the config as written, where
 * a widget a setup adds is not.
 *
 * Pinned to `globalThis`, as the widget registry is, so a development reload
 * that re-evaluates this module finds the list the boot left.
 *
 * @module domains/widgets/declaration/component-map-store
 */

import type { PluginDefinition } from "../../../plugins/plugin-context";

const STORE_KEY = "__nextly_admin_component_plugins";

/** What the boot registered that draws through the component map. */
interface Registered {
  readonly plugins: readonly PluginDefinition[];
  /** The site config's `admin.dashboard` after every plugin's `setup()`. */
  readonly siteDashboard: unknown;
}

type Holder = Record<string, Registered | undefined>;

/**
 * Records the plugins the boot resolved and the site dashboard it registered.
 * Called by the boot's reset, and by a development reload.
 */
export function setAdminComponentPlugins(
  plugins: readonly PluginDefinition[],
  siteDashboard?: unknown
): void {
  (globalThis as unknown as Holder)[STORE_KEY] = { plugins, siteDashboard };
}

/** The plugins the last boot resolved, or `undefined` before any boot. */
export function adminComponentPlugins():
  | readonly PluginDefinition[]
  | undefined {
  return (globalThis as unknown as Holder)[STORE_KEY]?.plugins;
}

/** The site dashboard the last boot registered, after every plugin's `setup()`. */
export function adminSiteDashboard(): unknown {
  return (globalThis as unknown as Holder)[STORE_KEY]?.siteDashboard;
}
