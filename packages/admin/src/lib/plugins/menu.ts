import type { ActiveNavSection } from "@admin/constants/nav-sections";
import { pluginSurfaceSection } from "@admin/lib/navigation/section-resolvers";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import type { PluginMenuItemMeta, PluginMetadata } from "@admin/types/branding";

const DEFAULT_ORDER = 100;

/**
 * Filter a menu tree by RBAC and sort siblings by `order`. An item with a
 * `requiredPermission` the user lacks is removed along with its subtree; an
 * item without a permission stays even if some children are filtered (it is
 * itself a link). Recurses one level into `children`.
 */
function filterAndSort(
  items: PluginMenuItemMeta[],
  can: (permission: string) => boolean
): PluginMenuItemMeta[] {
  return items
    .filter(item => !item.requiredPermission || can(item.requiredPermission))
    .map(item =>
      item.children
        ? { ...item, children: filterAndSort(item.children, can) }
        : item
    )
    .sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER));
}

/**
 * Collect every enabled plugin's `contributes.admin.menu` from the
 * admin-meta plugin list, RBAC-gated by `can` (typically
 * `useCurrentUserPermissions().hasPermission`, which is super-admin-aware and
 * stays closed until permissions load) and ordered by `order`.
 *
 * `section` selects which sidebar group is asking. Each item is attributed
 * through the same deferral chain a plugin's pages use — the item's own
 * declaration, then its plugin's placement, then Plugins — so an item and a
 * page contributed by one plugin cannot disagree about where that plugin
 * lives. Callers that pass nothing get every item regardless of section.
 */
export function resolveVisibleMenuItems(
  plugins: PluginMetadata[] | undefined,
  can: (permission: string) => boolean,
  section?: ActiveNavSection,
  hasPanel?: (section: ActiveNavSection) => boolean
): PluginMenuItemMeta[] {
  if (!plugins || plugins.length === 0) return [];
  const all = plugins.flatMap(plugin => {
    const items = plugin.menu ?? [];
    if (section === undefined) return items;
    const slug = pluginSlug(plugin.name);
    return items.filter(item =>
      listedIn(
        pluginSurfaceSection(item.section, plugin.placement, slug),
        section,
        hasPanel
      )
    );
  });
  return filterAndSort(all, can);
}

/**
 * Whether an item attributed to `attributed` is listed in `section`'s panel:
 * its own section's, or, where that section draws no panel (the dashboard,
 * or media while its folder tree is hidden), the Plugins panel's, so every
 * item has somewhere it can be reached. Without `hasPanel`, each item is
 * listed in its own section alone.
 */
function listedIn(
  attributed: ActiveNavSection,
  section: ActiveNavSection,
  hasPanel: ((section: ActiveNavSection) => boolean) | undefined
): boolean {
  if (attributed === section) return true;
  return (
    section === "plugins" && hasPanel !== undefined && !hasPanel(attributed)
  );
}

/**
 * The menu items a sidebar search matches: an item whose label contains the
 * search, ignoring case, with all its children; or one with a child that
 * does, with those children alone. An empty search matches everything, so a
 * panel that searches its other entries filters these the same way.
 */
export function menuItemsMatching(
  items: readonly PluginMenuItemMeta[],
  search: string
): PluginMenuItemMeta[] {
  const term = search.trim().toLowerCase();
  if (term === "") return [...items];
  const matches = (item: PluginMenuItemMeta) =>
    item.label.toLowerCase().includes(term);
  return items.flatMap(item => {
    if (matches(item)) return [item];
    const children = (item.children ?? []).filter(matches);
    return children.length > 0 ? [{ ...item, children }] : [];
  });
}
