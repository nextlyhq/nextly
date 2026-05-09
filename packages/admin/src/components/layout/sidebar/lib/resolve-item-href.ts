import { ROUTES, buildRoute } from "@admin/constants/routes";
import type { PluginMetadata } from "@admin/types/branding";

import type { MainMenuItem } from "../sidebar-types";

// Why: collections / singles primary-icon clicks navigate to the section
// landing page smart-redirect routes pick the most-recently-
// created record server-side). Plugins remain pure sub-sidebar openers
// (no landing-page convention yet). Standalone plugins jump to their
// first registered collection. Extracted to a pure helper so the routing
// logic is unit-testable without mounting the full DualSidebar tree.
export function resolveItemHref(
  item: MainMenuItem,
  visibleStandalonePlugins: PluginMetadata[]
): string {
  if (item.id === "collections") return ROUTES.COLLECTIONS;
  if (item.id === "singles") return ROUTES.SINGLES;
  if (item.id === "plugins") return "#";
  if (item.id.startsWith("standalone-")) {
    const slug = item.id.replace("standalone-", "");
    const sp = visibleStandalonePlugins.find(
      p =>
        p.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") === slug
    );
    const firstCol = sp?.collections?.[0];
    return firstCol
      ? buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: firstCol })
      : "#";
  }
  return item.href;
}
