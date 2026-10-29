import type { JSX, ReactNode } from "react";

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
 * @experimental Renders `children` only if the current user may do what
 * `permission` names, as `useCan` answers it: an action on a collection or
 * Single as the server decides it, any other slug from the user's permissions
 * (D36). Otherwise renders `fallback` (default: nothing). The fallback also
 * shows while access is loading. Client-side UX gating only — the server
 * still enforces every request.
 */
export function Can({
  permission,
  fallback = null,
  children,
}: CanProps): JSX.Element {
  return useCan(permission) ? <>{children}</> : <>{fallback}</>;
}
