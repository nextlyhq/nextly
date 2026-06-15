import type { PermissionSlug } from "nextly";

import { useCurrentUserPermissions } from "./useCurrentUserPermissions";

/**
 * @experimental Returns `true` if the current user holds `permission` (D36).
 * Super-admin always passes (delegated to `hasPermission`). Returns `false`
 * while permissions are still loading — the gate stays closed until access is
 * known, a safe default for UX gating. Client-side UX only; the server still
 * enforces via `requirePermission`.
 */
export function useCan(permission: PermissionSlug): boolean {
  const { hasPermission } = useCurrentUserPermissions();
  return hasPermission(permission);
}
