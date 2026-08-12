import { ROUTES, buildRoute } from "@admin/constants/routes";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import type { PluginMetadata } from "@admin/types/branding";

import type { MainMenuItem } from "../sidebar-types";

// Why: collections / singles primary-icon clicks navigate to the section
// landing page smart-redirect routes pick the most-recently-
// created record server-side). Plugins follows the same convention and lands
// on the installed list; that list's empty state is what routes onward to the
// directory, so an install with nothing installed still has somewhere to go.
// Standalone plugins jump to their first registered collection. Extracted to a
// pure helper so the routing logic is unit-testable without mounting the full
// DualSidebar tree.
export function resolveItemHref(
  item: MainMenuItem,
  visibleStandalonePlugins: PluginMetadata[],
  // The first settings subpage the user can actually open. The default settings
  // href (/admin/settings) is guarded by `manage-settings`, so a user whose only
  // settings access is API Keys or Webhooks would be redirected away; the caller
  // resolves this to a reachable subpage for them.
  settingsHref?: string
): string {
  if (item.id === "collections") return ROUTES.COLLECTIONS;
  if (item.id === "singles") return ROUTES.SINGLES;
  if (item.id === "plugins") return ROUTES.PLUGINS;
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
