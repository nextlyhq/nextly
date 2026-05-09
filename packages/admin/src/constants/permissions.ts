import type { ContentTypePermissions } from "../types/ui/form";

/**
 * Default action to use when permission slug doesn't follow expected pattern
 */
export const DEFAULT_PERMISSION_ACTION: keyof ContentTypePermissions["permissions"] =
  "view";

/**
 * Available permission categories
 */
export const PERMISSION_CATEGORIES = [
  "collection-types",
  "single-types",
  "settings",
] as const;

/**
 * Type for permission categories
 */
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

/**
 * Initialize empty permission categories structure
 */
export function initializePermissionCategories(): Record<
  string,
  ContentTypePermissions[]
> {
  return {
    "collection-types": [],
    "single-types": [],
    settings: [],
  };
}
