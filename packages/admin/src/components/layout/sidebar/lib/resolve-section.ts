import { ROUTES } from "@admin/constants/routes";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import { isUnder } from "@admin/lib/routing";
import type { ApiCollection } from "@admin/types/entities";

import type { MainMenuCategory } from "../sidebar-types";

/**
 * The subset of a standalone plugin's metadata that section resolution reads.
 *
 * Narrower than `PluginMetadata` so callers can supply a literal in a test
 * without constructing fields this decision never consults.
 */
export interface StandalonePluginSummary {
  name: string;
  collections?: string[];
}

/**
 * Everything the active-section decision depends on.
 *
 * Placement arrives as a FUNCTION rather than as resolved values because the
 * caller memoises it over plugin metadata, and re-deriving it here would be a
 * second implementation of a question that already has one.
 */
export interface ActiveSectionContext {
  pathname: string;
  /**
   * The `from` search param. Typed as the router reports it: a repeated param
   * parses to an array, which matches no section and therefore falls through.
   */
  from?: string | string[];
  collections: ApiCollection[] | undefined;
  getCollectionPlacement: (collection: ApiCollection) => string | undefined;
  standalonePlugins: readonly StandalonePluginSummary[];
  showBuilder: boolean;
}

/**
 * Which primary-rail category is active for the current location.
 *
 * The order of the checks is load-bearing and not merely stylistic. A plugin
 * collection placed in another section must be classified by its PLACEMENT
 * before any URL-shaped check runs, because its content URL is an ordinary
 * `/admin/collections/<name>` that would otherwise match the Collections arm
 * and hide the section its plugin actually chose.
 */
export function resolveActiveSection(
  ctx: ActiveSectionContext
): MainMenuCategory {
  const {
    pathname,
    from,
    collections,
    getCollectionPlacement,
    standalonePlugins,
    showBuilder,
  } = ctx;

  // A standalone plugin owns its own rail entry, so one of its collections
  // outranks every shared section below.
  for (const plugin of standalonePlugins) {
    const slug = pluginSlug(plugin.name);
    const standaloneId = `standalone-${slug}` as MainMenuCategory;
    const collectionSlugs = plugin.collections ?? [];
    if (
      collectionSlugs.some(name =>
        pathname.includes(`/admin/collections/${name}`)
      )
    ) {
      return standaloneId;
    }
  }

  const pluginCollections = (collections ?? []).filter(c => c.admin?.isPlugin);

  if (collections && pathname.includes("/admin/collections/")) {
    for (const collection of pluginCollections) {
      if (!pathname.includes(`/admin/collections/${collection.name}`)) continue;
      const placement = getCollectionPlacement(collection);
      // User management is rendered inside the Settings sub-sidebar, so it
      // highlights Settings rather than a rail entry of its own.
      if (placement === "users") return "settings";
      if (placement === "settings") return "settings";
      if (placement === "collections") return "collections";
      if (placement === "singles") return "singles";
    }
  }

  // A plugin collection with no placement, or one placed in "plugins",
  // belongs to the Plugins rail entry.
  const isPluginCollectionPath = pluginCollections.some(collection => {
    if (!pathname.includes(`/admin/collections/${collection.name}`))
      return false;
    const placement = getCollectionPlacement(collection);
    if (placement && placement !== "plugins") return false;
    return true;
  });

  // Compared against the route constants rather than their spellings. The
  // directory sits at its own top level so no plugin slug can shadow it, which
  // means Plugins is not one URL prefix and a literal would silently stop
  // covering it the next time either route moves.
  if (
    isUnder(pathname, ROUTES.PLUGINS) ||
    isUnder(pathname, ROUTES.PLUGIN_BROWSE) ||
    pathname.includes("/admin/forms") ||
    isPluginCollectionPath
  ) {
    return "plugins";
  }

  if (pathname === ROUTES.DASHBOARD) return "dashboard";

  // An explicit `from` records which rail the user navigated out of, so it
  // decides ahead of the URL for every section below.
  if (from === "builders") return "builders";
  if (from === "collections") return "collections";
  if (from === "singles") return "singles";

  // Schema-management URLs win over the content arms beneath them, so the
  // Builders panel stays selected while editing a schema.
  if (pathname.includes("/admin/builder/")) {
    if (showBuilder) return "builders";
    // Reached only by deep link when an admin-meta override hides the builder.
    // Surfacing the matching per-kind panel leaves somewhere to navigate to
    // instead of an empty sub-sidebar.
    if (pathname.includes("/admin/builder/collections")) return "collections";
    if (pathname.includes("/admin/builder/singles")) return "singles";
    if (pathname.includes("/admin/builder/field-groups")) return "collections";
  }

  if (pathname.includes("/admin/collections/")) return "collections";
  if (pathname.includes("/admin/singles/")) return "singles";
  if (pathname.includes("/admin/media")) return "media";
  if (
    pathname.includes("/admin/users") ||
    pathname.includes("/admin/security/roles")
  ) {
    return "settings";
  }
  if (pathname.includes("/admin/settings")) return "settings";

  return "dashboard";
}
