import type { PluginMenuItemMeta, PluginMetadata } from "@admin/types/branding";

const DEFAULT_ORDER = 100;

/**
 * Filter a menu tree by RBAC and sort siblings by `order`. An item with a
 * `requiredPermission` the user lacks is removed along with its subtree; an
 * item without a permission stays even if some children are filtered (it is
 * itself a link). Recurses one level into `children` (D20).
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
 * Collect every enabled plugin's `contributes.admin.menu` (D20) from the
 * admin-meta plugin list, RBAC-gated by `can` (typically
 * `useCurrentUserPermissions().hasPermission`, which is super-admin-aware and
 * stays closed until permissions load) and ordered by `order`.
 */
export function resolveVisibleMenuItems(
  plugins: PluginMetadata[] | undefined,
  can: (permission: string) => boolean
): PluginMenuItemMeta[] {
  if (!plugins || plugins.length === 0) return [];
  const all = plugins.flatMap(plugin => plugin.menu ?? []);
  return filterAndSort(all, can);
}
