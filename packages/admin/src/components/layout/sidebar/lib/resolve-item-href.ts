import { ROUTES, buildRoute } from "@admin/constants/routes";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import type { PluginMetadata } from "@admin/types/branding";

import type { MainMenuItem } from "../sidebar-types";

// Why: collections / singles primary-icon clicks navigate to the section
// landing page smart-redirect routes pick the most-recently-
// created record server-side). Plugins follows the same convention and lands
// on the installed list, which today renders an empty table when nothing is
// installed. Standalone plugins jump to their first registered collection.
// Extracted to a pure helper so the routing logic is unit-testable without
// mounting the full DualSidebar tree.
export function resolveItemHref(
  item: MainMenuItem,
  visibleStandalonePlugins: PluginMetadata[],
  // The first settings subpage the user can actually open. The default settings
  // href (/admin/settings) is guarded by `manage-settings`, so a user whose only
  // settings access is API Keys or Webhooks would be redirected away; the caller
  // resolves this to a reachable subpage for them.
  settingsHref?: string,
  // Whether this user can open /admin/plugins, which is `manage-settings`
  // guarded in pages/registry.ts. The plugins ICON is shown more widely than
  // that: a user who can read a plugin-owned collection sees it in order to
  // reach that collection through the sub-sidebar. Navigating them to the
  // guarded page would bounce them to the dashboard and remove their only route
  // to content they are allowed to see, so for them the icon stays a
  // sub-sidebar opener.
  canOpenPluginsPage = false
): string {
  if (item.id === "collections") return ROUTES.COLLECTIONS;
  if (item.id === "singles") return ROUTES.SINGLES;
  if (item.id === "plugins") return canOpenPluginsPage ? ROUTES.PLUGINS : "#";
  if (item.id === "settings" && settingsHref) return settingsHref;
  if (item.id.startsWith("standalone-")) {
    const slug = item.id.replace("standalone-", "");
    const sp = visibleStandalonePlugins.find(p => pluginSlug(p.name) === slug);
    const firstCol = sp?.collections?.[0];
    return firstCol
      ? buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: firstCol })
      : "#";
  }
  return item.href;
}
