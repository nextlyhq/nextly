/**
 * The reads a plugin's admin page declares it makes as it opens
 * (`contributes.admin.pages[].startupReads`), resolved to the admin API paths
 * the page will ask for, and carried in the prebuilt admin page.
 *
 * The admin page is built once and is the same for every visitor, and its
 * startup request leaves before any of the admin's code, or a plugin's, has
 * loaded. So the admin layout writes, at build time, each plugin page's
 * address and the paths it reads into the page
 * (`<script type="application/json" id="nextly-admin-startup-screens">`), and
 * the startup request adds the paths of the page being opened. This is the
 * whole of it in core: which paths a page reads is the plugin's to say, and
 * each is answered by the plugin's own route with its own permission check.
 *
 * Imports nothing but other import-free modules and types, as the admin
 * layout and the admin's browser code both reach it through `nextly/config`.
 *
 * @module plugins/startup-reads
 */
import { isStartupPath } from "../route-handler/startup-path";

import type { PluginPageStartupRead } from "./admin-contributions";
import { foldedPanelCollections } from "./folded-panels";
import type { PluginDefinition } from "./plugin-context";
import { pluginAdminSlug, pluginPageAddress } from "./plugin-slug";
import { pluginRouteFullPath } from "./routes/route-path";

/** The most startup reads one plugin page may declare. */
export const MAX_PAGE_STARTUP_READS = 4;

/**
 * The id of the element the admin layout carries the plugin pages' startup
 * reads in, which the admin's startup request reads before any code loads.
 */
export const ADMIN_STARTUP_SCREENS_ELEMENT_ID = "nextly-admin-startup-screens";

/**
 * The admin API path one declared read asks for, or `null` when the startup
 * request cannot carry it: a route path that does not start with `/`, as
 * every route's does, or a resolved path the startup route would refuse.
 * Resolved by `pluginRouteFullPath`, the function `usePluginRoute` asks by,
 * so the part the startup request carries is the request the page makes.
 */
export function carriedStartupRead(
  pluginName: string,
  read: PluginPageStartupRead
): string | null {
  if (!read.path.startsWith("/")) return null;
  const path = pluginRouteFullPath(pluginName, read.path, read.mount);
  return isStartupPath(path) ? path : null;
}

/**
 * Each plugin page that declares startup reads, by its admin address
 * (`/admin/plugins/<slug>/<path>`), with the admin API paths it reads.
 *
 * Only what the startup request can carry: a path it would refuse, and any
 * read past {@link MAX_PAGE_STARTUP_READS}, are left out. Boot refuses both
 * (`validatePluginStartupReads`); this runs where the admin page is built,
 * which does not boot, so it keeps to the same rule rather than relying on
 * that.
 */
export function adminStartupScreens(
  plugins: readonly PluginDefinition[] | undefined
): Record<string, string[]> {
  const screens: Record<string, string[]> = {};
  for (const plugin of plugins ?? []) {
    const slug = pluginAdminSlug(plugin.name);
    for (const page of plugin.contributes?.admin?.pages ?? []) {
      const paths = (page.startupReads ?? [])
        .map(read => carriedStartupRead(plugin.name, read))
        .filter(path => path !== null)
        .slice(0, MAX_PAGE_STARTUP_READS);
      if (paths.length > 0) screens[pluginPageAddress(slug, page.path)] = paths;
    }
  }
  return screens;
}

/**
 * What the prebuilt admin page knows of its screens before any request has
 * answered, as the JSON the admin layout writes into the page, or `null` when
 * there is nothing to say: `reads`, each plugin page's startup reads by its
 * address (`adminStartupScreens`), and `foldedPanels`, the collections whose
 * document screens start with the rail's panel folded away
 * (`foldedPanelCollections`), so the admin's first frame is drawn as those
 * screens are. Every `<` is written as `\u003c`, so a path holding
 * `</script>` cannot end the element early.
 *
 * `const startupScreensJson = adminStartupScreensJson(config.plugins);`
 */
export function adminStartupScreensJson(
  plugins: readonly PluginDefinition[] | undefined
): string | null {
  const reads = adminStartupScreens(plugins);
  const foldedPanels = foldedPanelCollections(plugins);
  if (Object.keys(reads).length === 0 && foldedPanels.length === 0) {
    return null;
  }
  return JSON.stringify({ reads, foldedPanels }).replace(/</g, "\\u003c");
}
