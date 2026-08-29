import type { ContentTypePermissions } from "../types/ui/form";

/**
 * The resources Nextly builds in, in the order the permissions page shows them.
 *
 * ## Why the admin restates core's list at all
 *
 * These modules run in the BROWSER. Importing core's schema barrel to read
 * `SYSTEM_RESOURCES` would pull server code into the client bundle, so the admin
 * keeps its own client-safe copy and a parity test holds the two together.
 *
 * ## Why there is now ONE copy rather than four
 *
 * There were four: the role matrix, the capability builder, and the permissions
 * page's membership set and display order. Each decides how a permission is
 * PRESENTED — which tab of the role editor grants it, whether it maps to a
 * dedicated capability flag or to per-collection access, which bucket it renders
 * under — so a resource missing from one is silently miscategorised rather than
 * missing. Nothing throws.
 *
 * That is what happened when core added `content-releases`: three copies stayed
 * at nine entries and the permission was filed under Collections. The parity
 * test catches the divergence only when the ADMIN suite runs, and the change
 * that causes it lands in core — so a package-scoped gate never runs the guard.
 *
 * One ordered definition, three derived views. The remaining drift risk is
 * between this list and core's, which is the one the parity test is actually
 * positioned to catch.
 *
 * ORDER IS MEANINGFUL: it groups by what an administrator is doing — people and
 * access, then the editorial surfaces, then delivery and integration plumbing.
 * `content-releases` sits with `media` because it is a tool an editor reaches
 * daily, not infrastructure.
 *
 * The name is `content-releases`, NOT `releases`. Registering a system resource
 * reserves its name against collections and Singles, and a press-releases
 * collection is among the most common on a corporate site. See the note beside
 * `SYSTEM_RESOURCES` in `packages/nextly/src/schemas/_zod/rbac.ts` before
 * renaming it here.
 */
export const SYSTEM_RESOURCES_IN_DISPLAY_ORDER = [
  "users",
  "roles",
  "permissions",
  "media",
  "content-releases",
  "settings",
  "email-providers",
  "email-templates",
  "api-keys",
  "webhooks",
] as const;

/**
 * Membership, derived from the ordered list.
 *
 * A Set because every consumer asks "is this resource built in?" and none of
 * them cares about position — deriving it is what stops a tenth entry being
 * added to one and not the other.
 */
export const SYSTEM_RESOURCE_SET: ReadonlySet<string> = new Set(
  SYSTEM_RESOURCES_IN_DISPLAY_ORDER
);

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
