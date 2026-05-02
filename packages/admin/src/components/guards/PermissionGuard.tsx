"use client";

import type React from "react";
import { useEffect } from "react";

import { ROUTES } from "@admin/constants/routes";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { navigateTo } from "@admin/lib/navigation";

interface PermissionGuardProps {
  /** Permission slug required to access this route (e.g., "read-users", "manage-settings") */
  requiredPermission: string;
  children: React.ReactNode;
}

/**
 * Route-level permission guard.
 *
 * Checks if the current user has the required permission before rendering
 * the protected page. Must be used inside `PrivateRoute` (auth is already verified).
 *
 * - Super-admin bypasses all permission checks
 * - While permissions are loading, shows a loading spinner
 * - If permission is denied, shows an access denied message with a link to Dashboard
 */
export function PermissionGuard({
  requiredPermission,
  children,
}: PermissionGuardProps) {
  const { hasPermission, isLoading } = useCurrentUserPermissions();
  const hasAccess = hasPermission(requiredPermission);

  useEffect(() => {
    if (!isLoading && !hasAccess) {
      navigateTo(ROUTES.DASHBOARD);
    }
  }, [hasAccess, isLoading]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] h-[60vh] w-full animate-fade-in">
        <div className="flex flex-col items-center text-center">
          <div className="relative mb-6">
            <div className="h-12 w-12 rounded-none border-t-2 border-r-2 border-primary animate-spin" />
            <div className="absolute inset-0 rounded-none border-2 border-primary/10" />
          </div>
          <p className="text-sm font-medium tracking-tight text-slate-900 dark:text-slate-100 mb-1">
            Setting up your workspace
          </p>
          <p className="text-xs text-muted-foreground">
            Verifying permissions and loading data...
          </p>
        </div>
      </div>
    );
  }

  if (!hasAccess) {
    return null;
  }

  return <>{children}</>;
}
