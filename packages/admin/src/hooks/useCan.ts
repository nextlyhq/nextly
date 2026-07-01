import { useCurrentUserPermissions } from "./useCurrentUserPermissions";

/**
 * @experimental Returns `true` if the current user holds `permission` (D36).
 * Super-admin always passes (delegated to `hasPermission`). Returns `false`
 * while permissions are still loading — the gate stays closed until access is
 * known, a safe default for UX gating. Client-side UX only; the server still
 * enforces via `requirePermission`.
 *
 * `permission` is a permission slug (`${action}-${resource}`, e.g.
 * `"manage-seo"`) — assignable from `PermissionSlug` (`@nextlyhq/plugin-sdk`).
 * Typed as `string` (not nextly's `PermissionSlug`) because admin's bundled
 * d.ts cannot reference nextly's barrel types; `PermissionSlug` is `string`
 * until codegen narrows it (D47/P6).
 */
export function useCan(permission: string): boolean {
  const { hasPermission } = useCurrentUserPermissions();
  return hasPermission(permission);
}
