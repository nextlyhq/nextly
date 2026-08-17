import type {
  ActiveNavSection,
  NavSection,
} from "@admin/constants/nav-sections";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import type { RouteSectionContext } from "@admin/types/route-section";

/**
 * Section resolvers for the routes whose rail entry is not fixed by the route
 * alone.
 *
 * Each is a DECLARATION a route makes about how to decide, rather than logic
 * the sidebar applies to every URL it sees. A route that needs none of these
 * declares a plain section name instead.
 *
 * @module lib/navigation/section-resolvers
 */

/**
 * The rail entry a `from` search param names, if it names one.
 *
 * `from` records which rail the user navigated out of, so a schema page opened
 * from Collections keeps Collections selected rather than jumping to Builders.
 * A repeated param parses to an array, which names nothing and is ignored.
 */
function sectionFromParam(
  from: string | string[] | undefined
): NavSection | undefined {
  if (from === "builders") return "builders";
  if (from === "collections") return "collections";
  if (from === "singles") return "singles";
  return undefined;
}

/**
 * A fixed section that an explicit `from` may override.
 *
 * Which routes honour `from` was previously decided by where each URL check
 * happened to sit relative to the `from` check, so it was a property of the
 * ordering rather than a choice. Naming it per route makes it a decision:
 * Dashboard declares a bare section and is not overridable, while the content
 * and settings routes declare this and are.
 */
export function overridableBy(
  fallback: NavSection
): (context: RouteSectionContext) => ActiveNavSection {
  return context => sectionFromParam(context.from) ?? fallback;
}

/**
 * Which rail entry owns a schema-management URL.
 *
 * Builders is hidden in production by default. Reached by deep link while
 * hidden, the per-kind panel is surfaced instead so there is somewhere to
 * navigate to rather than an empty sub-sidebar.
 */
export function builderSection(
  whenHidden: NavSection
): (context: RouteSectionContext) => ActiveNavSection {
  return context => {
    const fromParam = sectionFromParam(context.from);
    if (fromParam) return fromParam;
    return context.showBuilder ? "builders" : whenHidden;
  };
}

/**
 * Which rail entry owns a collection's CONTENT url.
 *
 * A collection's URL is always `/admin/collections/<name>`, so the URL cannot
 * answer this: the same shape belongs to Collections, to Plugins, to Settings,
 * or to a standalone plugin's own entry depending on who owns the collection
 * and where that owner placed it. Ownership is therefore consulted before the
 * generic answer, and `from` is consulted only after — a plugin that placed a
 * collection under Settings means it, whatever rail the user came from.
 */
export function collectionContentSection(
  context: RouteSectionContext
): ActiveNavSection {
  const { pathname, collections, getCollectionPlacement, standalonePlugins } =
    context;

  for (const plugin of standalonePlugins) {
    const owns = (plugin.collections ?? []).some(name =>
      pathname.includes(`/admin/collections/${name}`)
    );
    if (owns) return `standalone-${pluginSlug(plugin.name)}`;
  }

  const pluginCollections = (collections ?? []).filter(c => c.admin?.isPlugin);
  const owner = pluginCollections.find(collection =>
    pathname.includes(`/admin/collections/${collection.name}`)
  );

  if (owner) {
    const placement = getCollectionPlacement(owner);
    // User management is rendered inside the Settings sub-sidebar, so a
    // collection placed there highlights Settings rather than an entry of
    // its own.
    if (placement === "users" || placement === "settings") return "settings";
    if (placement === "collections") return "collections";
    if (placement === "singles") return "singles";
    // Declared "plugins", or nothing at all, both belong to Plugins.
    return "plugins";
  }

  return sectionFromParam(context.from) ?? "collections";
}
