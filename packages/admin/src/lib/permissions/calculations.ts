import {
  DEFAULT_PERMISSION_ACTION,
  initializePermissionCategories,
} from "../../constants/permissions";
import type { ContentTypePermissions, Permission } from "../../types/ui/form";

/**
 * Organize permissions by content type and action
 * Extracted from PermissionMatrix component for better testability and reusability
 */
export function organizePermissions(
  permissions: Permission[]
): Record<string, ContentTypePermissions[]> {
  const contentTypeMap = new Map<string, ContentTypePermissions>();

  // Process permissions to organize them by content type and action
  for (const permission of permissions) {
    if (!permission.slug) {
      continue;
    }
    const parts = permission.slug.split(".");

    let contentTypeId: string;
    let action: keyof ContentTypePermissions["permissions"];
    let category = "collection-types"; // Default category

    if (parts.length >= 3) {
      // Format: {category}.{contentType}.{action}
      const [cat, contentType, act] = parts;
      contentTypeId = `${cat}.${contentType}`;
      action = act as keyof ContentTypePermissions["permissions"];

      // Determine category
      if (cat === "content-types") {
        category = "collection-types";
      } else if (cat === "single-types") {
        category = "single-types";
      } else if (cat === "plugins" || cat.includes("plugin")) {
        // Skip plugins category since we're not working on plugins yet
        continue;
      } else if (cat === "settings" || cat.includes("setting")) {
        category = "settings";
      }
    } else if (parts.length === 2) {
      // Format: {contentType}.{action}
      const [contentType, act] = parts;
      contentTypeId = contentType;
      action = act as keyof ContentTypePermissions["permissions"];

      // Infer category from contentType
      if (contentType.includes("settings")) {
        category = "settings";
      } else if (contentType.includes("plugin")) {
        // Skip plugins category since we're not working on plugins yet
        continue;
      }
    } else {
      // Just use the slug as content type ID if it doesn't follow the pattern
      contentTypeId = permission.slug;
      action = DEFAULT_PERMISSION_ACTION;
    }

    // Use the permission's explicit category if set — this overrides slug-based
    // inference and ensures correctly categorized permissions from useRoleForm
    // (collection-types, single-types, settings) are placed in the right tab.
    if (permission.category) {
      category = permission.category;
    }

    // Get or initialize the content type
    let contentType = contentTypeMap.get(contentTypeId);
    if (!contentType) {
      contentType = {
        id: contentTypeId,
        name: contentTypeId.split(".").pop() || contentTypeId,
        category,
        permissions: {
          create: null,
          view: null,
          edit: null,
          delete: null,
        },
      };
      contentTypeMap.set(contentTypeId, contentType);
    }

    // Map API actions to internal UI actions
    // read -> view
    // update -> edit
    // manage -> edit (settings-style permissions)
    let mappedAction = action;
    if ((action as string) === "read") {
      mappedAction = "view";
    } else if ((action as string) === "update") {
      mappedAction = "edit";
    } else if ((action as string) === "manage") {
      mappedAction = "edit";
    }

    // Assign the permission to the appropriate action
    if (mappedAction in contentType.permissions) {
      if (contentTypeId === "api-keys" && mappedAction === "delete") {
        continue;
      }
      contentType.permissions[mappedAction] = permission;
    }
  }

  // Convert to array and organize by category
  const result = initializePermissionCategories();

  // Add content types to their categories
  for (const contentType of contentTypeMap.values()) {
    const category = contentType.category;
    if (category === "plugins") {
      // Skip plugins category since we're not working on plugins yet
      continue;
    }
    if (category in result) {
      result[category].push(contentType);
    } else {
      // If category doesn't match our predefined ones, add to collection types
      result["collection-types"].push(contentType);
    }
  }

  // Sort each category alphabetically by name
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

/**
 * Check if all permissions for a content type are selected
 */
export function isAllSelected(
  contentType: ContentTypePermissions,
  value: string[]
): boolean {
  const permissionIds = Object.values(contentType.permissions)
    .filter((permission): permission is Permission => permission !== null)
    .map(permission => permission.id);

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
  const permissionIds = Object.values(contentType.permissions)
    .filter((permission): permission is Permission => permission !== null)
    .map(permission => permission.id);

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
  action: keyof ContentTypePermissions["permissions"],
  value: string[]
): boolean {
  const permissionIds = contentTypes
    .map(ct => ct.permissions[action])
    .filter((permission): permission is Permission => permission !== null)
    .map(permission => permission.id);

  return (
    permissionIds.length > 0 && permissionIds.every(id => value.includes(id))
  );
}

/**
 * Check if any permissions for a specific action across all content types are selected (but not all)
 */
export function isPartiallySelectedForAction(
  contentTypes: ContentTypePermissions[],
  action: keyof ContentTypePermissions["permissions"],
  value: string[]
): boolean {
  const permissionIds = contentTypes
    .map(ct => ct.permissions[action])
    .filter((permission): permission is Permission => permission !== null)
    .map(permission => permission.id);

  return (
    permissionIds.some(id => value.includes(id)) &&
    !isAllSelectedForAction(contentTypes, action, value)
  );
}
