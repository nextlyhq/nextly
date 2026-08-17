import type { ActiveNavSection } from "@admin/constants/nav-sections";
import { ROUTES } from "@admin/constants/routes";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import { isUnder } from "@admin/lib/routing";
import type { RouteSectionContext } from "@admin/types/route-section";

/**
 * Re-exported so the sidebar's callers have one import site for the decision
 * and its inputs. The definitions live in `types/route-section` because the
 * ROUTE registry names them too, and a registry importing a sidebar
 * component's types would invert the dependency.
 */
export type {
  RouteSectionContext as ActiveSectionContext,
  StandalonePluginSummary,
} from "@admin/types/route-section";

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
  ctx: RouteSectionContext
): ActiveNavSection {
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
    const standaloneId: ActiveNavSection = `standalone-${slug}`;
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
