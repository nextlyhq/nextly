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
  section?: ActiveNavSection
): PluginMenuItemMeta[] {
  if (!plugins || plugins.length === 0) return [];
  const all = plugins.flatMap(plugin => {
    const items = plugin.menu ?? [];
    if (section === undefined) return items;
    const slug = pluginSlug(plugin.name);
    return items.filter(
      item =>
        pluginSurfaceSection(item.section, plugin.placement, slug) === section
    );
  });
  return filterAndSort(all, can);
}
