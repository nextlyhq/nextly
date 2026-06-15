import type { ReactNode } from "react";

import { useCan } from "../../hooks/useCan";

export interface CanProps {
  /**
   * Permission slug required to render `children` (`${action}-${resource}`,
   * e.g. `"manage-seo"`). Assignable from `PermissionSlug` (`@nextlyhq/plugin-sdk`);
   * typed `string` because admin's bundled d.ts cannot reference nextly types.
   */
  permission: string;
  /** Rendered when the user lacks the permission (default: nothing). */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * @experimental Renders `children` only if the current user holds `permission`
 * (D36); otherwise renders `fallback` (default: nothing). The fallback also
 * shows while permissions are loading. Client-side UX gating only — the server
 * still enforces access via `requirePermission`.
 */
export function Can({ permission, fallback = null, children }: CanProps) {
  return useCan(permission) ? <>{children}</> : <>{fallback}</>;
}
