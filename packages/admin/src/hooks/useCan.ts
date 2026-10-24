import { useCurrentUserPermissions } from "./useCurrentUserPermissions";

/**
 * @experimental Returns `true` if the current user may do what `permission`
 * names (D36). Returns `false` while that is still loading — the gate stays
 * closed until access is known, a safe default for UX gating. Client-side UX
 * only; the server still enforces every request.
 *
 * `permission` is a permission slug (`${action}-${resource}`, e.g.
 * `"manage-seo"`) — assignable from `PermissionSlug` (`@nextlyhq/plugin-sdk`).
 * A read, create, update, delete, publish or unpublish of a collection or
 * Single (`"update-posts"`) is answered as the server decides it for that
 * entity, its code access rules included, so it can be `false` for a role
 * that holds the permission. Any other slug, a plugin's own permissions
 * included, is answered from the permissions the user's roles hold, a
 * super-admin holding all of them.
 *
 * Typed as `string` (not nextly's `PermissionSlug`) because admin's bundled
 * d.ts cannot reference nextly's barrel types; `PermissionSlug` is `string`
 * until codegen narrows it (D47/P6).
 */
export function useCan(permission: string): boolean {
  const { can } = useCurrentUserPermissions();
  return can(permission);
}
