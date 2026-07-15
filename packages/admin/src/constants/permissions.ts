import type { ContentTypePermissions } from "../types/ui/form";

/**
 * Available permission categories.
 *
 * `plugins` holds permissions a plugin declared. They are known by their
 * provenance rather than guessed from the resource name: a plugin names its
 * own resource, and that name matches no collection or single, so inferring
 * from it invents a content type that does not exist.
 */
export const PERMISSION_CATEGORIES = [
  "collection-types",
  "single-types",
  "plugins",
  "settings",
] as const;

/**
 * Type for permission categories
 */
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

/** Heading per category, for the tab strip. */
export const PERMISSION_CATEGORY_LABELS: Record<PermissionCategory, string> = {
  "collection-types": "Collection Types",
  "single-types": "Single Types",
  plugins: "Plugins",
  settings: "Settings",
};

/**
 * Initialize empty permission categories structure
 */
export function initializePermissionCategories(): Record<
  string,
  ContentTypePermissions[]
> {
  return Object.fromEntries(PERMISSION_CATEGORIES.map(c => [c, []]));
}

/**
 * The order actions appear in as columns.
 *
 * Names the verbs the framework seeds so they read in the order people expect
 * rather than alphabetically — create before read, delete after update.
 * Anything absent is a verb we do not ship (a plugin's, or a later addition)
 * and sorts alphabetically after these, so plugins adding verbs needs no
 * maintenance here.
 */
const ACTION_ORDER = [
  "create",
  "read",
  "update",
  "delete",
  "manage",
  "publish",
] as const;

/**
 * The columns a set of rows needs: every action any of them has, deduplicated
 * and ordered.
 *
 * Derived rather than fixed, so a resource whose verb is outside CRUD gets a
 * column instead of being dropped. Sparse columns are the intended outcome —
 * `publish` shows for the content types that have it and is blank for the
 * rest. A column blank on some rows is honest; a permission with no column is
 * not.
 */
export function actionsForContentTypes(
  contentTypes: ContentTypePermissions[]
): string[] {
  const seen = new Set<string>();
  for (const contentType of contentTypes) {
    for (const action of Object.keys(contentType.permissions)) {
      seen.add(action);
    }
  }

  const rank = (action: string): number => {
    const index = ACTION_ORDER.indexOf(action as (typeof ACTION_ORDER)[number]);
    return index === -1 ? ACTION_ORDER.length : index;
  };

  return [...seen].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * A column's heading: the action itself, capitalised.
 *
 * Not a lookup table. An action is whatever the database recorded, so a
 * plugin's verb has to render without this file having heard of it — and a
 * label that renames the action is what let a column headed "Update" grant
 * `manage`.
 */
export function actionLabel(action: string): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}
