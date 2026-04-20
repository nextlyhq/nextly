/**
 * Admin Authorization Module
 *
 * Utility functions for filtering sidebar navigation items and dynamic
 * content based on the current user's AdminCapabilities.
 *
 * Used by:
 * - SidebarNavigation (static items)
 * - DynamicCollectionNav (dynamic collection items)
 * - DynamicSingleNav (dynamic single items)
 * - DynamicPluginNav (plugin collection items)
 */

import type { NavigationItem } from "../../constants/navigation";
import type { AdminCapabilities } from "../../types/permissions";

/**
 * Minimal collection shape for authorization filtering.
 * Matches the data returned by useCollections().
 */
interface FilterableCollection {
  name: string;
  slug?: string;
  admin?: {
    hidden?: boolean;
    isPlugin?: boolean;
    group?: string;
    order?: number;
    sidebarGroup?: string;
  };
}

/**
 * Minimal single shape for authorization filtering.
 * Matches the data returned by useSingles().
 */
interface FilterableSingle {
  slug: string;
  admin?: {
    hidden?: boolean;
    order?: number;
    sidebarGroup?: string;
  };
}

/**
 * Filter static sidebar navigation items based on user capabilities.
 *
 * - Items without `requiredPermission` are always visible (e.g., Dashboard)
 * - Super-admin sees everything
 * - For accordion items, sub-items are not filtered individually
 *   (the parent permission controls visibility of the whole group)
 *
 * @param items - Navigation items (may include requiredPermission)
 * @param capabilities - Current user's admin capabilities
 * @returns Filtered navigation items the user has permission to see
 */
export function filterNavigationItems(
  items: NavigationItem[],
  capabilities: AdminCapabilities
): NavigationItem[] {
  if (capabilities.isSuperAdmin) return items;

  return items.filter(item => {
    // Items without requiredPermission are always visible
    if (!item.requiredPermission) return true;

    // Check against the user's permission set
    return hasCapabilityForPermission(item.requiredPermission, capabilities);
  });
}

/**
 * Filter dynamic collection items based on per-collection read permission.
 *
 * A collection is visible if the user has `read-{slug}` permission.
 * This runs AFTER the existing `admin.hidden` / `admin.isPlugin` filters.
 *
 * @param collections - Collections already filtered by hidden/plugin flags
 * @param capabilities - Current user's admin capabilities
 * @returns Collections the user has read permission for
 */
export function filterCollectionItems<T extends FilterableCollection>(
  collections: T[],
  capabilities: AdminCapabilities
): T[] {
  if (capabilities.isSuperAdmin) return collections;

  return collections.filter(collection => {
    const slug = collection.slug || collection.name;
    const collectionCaps = capabilities.collections[slug];
    return collectionCaps?.canRead === true;
  });
}

/**
 * Filter dynamic single items based on per-single read permission.
 *
 * A single is visible if the user has `read-{slug}` permission.
 * This runs AFTER the existing `admin.hidden` filter.
 *
 * @param singles - Singles already filtered by hidden flag
 * @param capabilities - Current user's admin capabilities
 * @returns Singles the user has read permission for
 */
export function filterSingleItems<T extends FilterableSingle>(
  singles: T[],
  capabilities: AdminCapabilities
): T[] {
  if (capabilities.isSuperAdmin) return singles;

  return singles.filter(single => {
    const collectionCaps = capabilities.collections[single.slug];
    return collectionCaps?.canRead === true;
  });
}

/**
 * Check if a user has the capability corresponding to a permission slug.
 *
 * Maps well-known permission slugs to AdminCapabilities boolean flags.
 * Falls back to checking the permission slug against the capabilities
 * collections map for dynamic collection permissions.
 */
function hasCapabilityForPermission(
  permission: string,
  capabilities: AdminCapabilities
): boolean {
  // Map well-known permissions to capability flags
  switch (permission) {
    case "read-users":
      return capabilities.canViewUsers;
    case "read-roles":
      return capabilities.canViewRoles;
    case "read-media":
    case "manage-media":
      return capabilities.canViewMedia;
    case "manage-settings":
      return capabilities.canViewSettings;
    case "create-users":
    case "update-users":
      return capabilities.canManageUsers;
    case "create-roles":
    case "update-roles":
      return capabilities.canManageRoles;
    case "manage-email-providers":
      return capabilities.canManageEmailProviders;
    case "manage-email-templates":
      return capabilities.canManageEmailTemplates;
    default: {
      // For dynamic permissions like "read-posts", parse and check collections
      const dashIdx = permission.indexOf("-");
      if (dashIdx === -1) return false;

      const action = permission.slice(0, dashIdx);
      const resource = permission.slice(dashIdx + 1);
      const collectionCaps = capabilities.collections[resource];

      if (!collectionCaps) return false;

      switch (action) {
        case "read":
          return collectionCaps.canRead;
        case "create":
          return collectionCaps.canCreate;
        case "update":
          return collectionCaps.canUpdate;
        case "delete":
          return collectionCaps.canDelete;
        default:
          return false;
      }
    }
  }
}
