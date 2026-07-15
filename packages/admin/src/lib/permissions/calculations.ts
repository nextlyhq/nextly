import { initializePermissionCategories } from "../../constants/permissions";
import type { ContentTypePermissions, Permission } from "../../types/ui/form";

/**
 * Group permissions into one row per resource, keyed by the action each
 * permission actually has.
 *
 * Reads `resource` and `action` off the permission rather than parsing them
 * back out of a slug the caller composed from those same two fields.
 *
 * Actions are kept as they are. Renaming them on the way in is what made a
 * column headed "Update" grant `manage`, and filing them into a fixed set of
 * slots is what dropped every verb outside CRUD — `publish` and `export` are
 * grantable through Select All, which reads the raw list, so the editor
 * granted permissions it could not display.
 */
export function organizePermissions(
  permissions: Permission[]
): Record<string, ContentTypePermissions[]> {
  const contentTypeMap = new Map<string, ContentTypePermissions>();

  for (const permission of permissions) {
    if (!permission.resource || !permission.action) {
      continue;
    }

    const contentTypeId = permission.resource;

    let contentType = contentTypeMap.get(contentTypeId);
    if (!contentType) {
      contentType = {
        id: contentTypeId,
        name: contentTypeId,
        category: permission.category || "collection-types",
        permissions: {},
      };
      contentTypeMap.set(contentTypeId, contentType);
    }

    contentType.permissions[permission.action] = permission;
  }

  const result = initializePermissionCategories();

  for (const contentType of contentTypeMap.values()) {
    const category = contentType.category;
    if (category in result) {
      result[category].push(contentType);
    } else {
      // An unrecognised category would otherwise vanish. Collection types is
      // the visible fallback: wrong tab beats no tab, since a permission the
      // editor cannot show is one it can still grant.
      result["collection-types"].push(contentType);
    }
  }

  for (const category in result) {
    result[category].sort((a, b) => a.name.localeCompare(b.name));
  }

  return result;
}

/**
 * Filter content types based on search term
 */
export function filterContentTypes(
  organizedPermissions: Record<string, ContentTypePermissions[]>,
  searchTerm: string
): Record<string, ContentTypePermissions[]> {
  if (!searchTerm) return organizedPermissions;

  const result = initializePermissionCategories();

  for (const category in organizedPermissions) {
    result[category] = organizedPermissions[category].filter(contentType =>
      contentType.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }

  return result;
}

/** Every permission id a row holds. */
export function permissionIdsForContentType(
  contentType: ContentTypePermissions
): string[] {
  return Object.values(contentType.permissions).map(
    (permission: Permission) => permission.id
  );
}

/** Every permission id a column holds, across the rows that have that action. */
export function permissionIdsForAction(
  contentTypes: ContentTypePermissions[],
  action: string
): string[] {
  return contentTypes
    .map(ct => ct.permissions[action])
    .filter((permission): permission is Permission => permission !== undefined)
    .map(permission => permission.id);
}

/**
 * Check if all permissions for a content type are selected
 */
export function isAllSelected(
  contentType: ContentTypePermissions,
  value: string[]
): boolean {
  const permissionIds = permissionIdsForContentType(contentType);

  return (
    permissionIds.length > 0 && permissionIds.every(id => value.includes(id))
  );
}

/**
 * Check if any permissions for a content type are selected (but not all)
 */
export function isPartiallySelected(
  contentType: ContentTypePermissions,
  value: string[]
): boolean {
  const permissionIds = permissionIdsForContentType(contentType);

  return (
    permissionIds.some(id => value.includes(id)) &&
    !isAllSelected(contentType, value)
  );
}

/**
 * Check if all permissions for a specific action across all content types are selected
 */
export function isAllSelectedForAction(
  contentTypes: ContentTypePermissions[],
  action: string,
  value: string[]
): boolean {
  const permissionIds = permissionIdsForAction(contentTypes, action);

  return (
    permissionIds.length > 0 && permissionIds.every(id => value.includes(id))
  );
}

/**
 * Check if any permissions for a specific action across all content types are selected (but not all)
 */
export function isPartiallySelectedForAction(
  contentTypes: ContentTypePermissions[],
  action: string,
  value: string[]
): boolean {
  const permissionIds = permissionIdsForAction(contentTypes, action);

  return (
    permissionIds.some(id => value.includes(id)) &&
    !isAllSelectedForAction(contentTypes, action, value)
  );
}
