"use client";

import { Spinner } from "@nextlyhq/ui";
import type React from "react";
import { useEffect, useState } from "react";

import { ROUTES } from "@admin/constants/routes";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import {
  DEFAULT_MARK_PATHS,
  DEFAULT_MARK_VIEWBOX,
} from "@admin/lib/branding/default-mark";
import { navigateTo } from "@admin/lib/navigation";
import { cn } from "@admin/lib/utils";

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
  const { hasPermission, isLoading: permissionsLoading } =
    useCurrentUserPermissions();
  const [isForceLoading, setIsForceLoading] = useState(false);
  const hasAccess = hasPermission(requiredPermission);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("debug_loading") === "true") {
        setIsForceLoading(true);
      }
    }
  }, []);

  const isLoading = permissionsLoading || isForceLoading;

  useEffect(() => {
    if (!isLoading && !hasAccess) {
      navigateTo(ROUTES.DASHBOARD);
    }
  }, [hasAccess, isLoading]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] h-[60vh] w-full animate-fade-in relative">
        {/* Ambient glowing background decoration */}
        <div className="absolute w-[280px] h-[280px] rounded-full bg-primary/5 dark:bg-primary/10 blur-[80px] pointer-events-none -z-10 animate-brand-pulse" />

        {/* Premium glassmorphic container card */}
        <div className="flex flex-col items-center text-center p-8 md:p-12 rounded-none border border-black/5 dark:border-white/5 bg-card/40 backdrop-blur-xl shadow-soft-primary max-w-sm w-full mx-auto relative overflow-hidden transition-all duration-300">
          {/* Brand Mark Orbiter Loader */}
          <div className="relative w-20 h-20 mb-8 flex items-center justify-center">
            {/* Shared UI Spinner component */}
            <Spinner className="absolute inset-0 w-full h-full text-primary/80" />

            {/* Inner branding prisms */}
            <div className="w-8 h-8 animate-brand-pulse flex items-center justify-center z-10">
              <svg
                viewBox={DEFAULT_MARK_VIEWBOX}
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full text-primary fill-current"
                role="img"
                aria-label="Nextly Logo"
              >
                {DEFAULT_MARK_PATHS.map((d, index) => (
                  <path
                    key={index}
                    d={d}
                    className={cn(
                      "transition-all duration-700 ease-premium",
                      index === 0
                        ? "opacity-100 dark:opacity-95"
                        : "opacity-85 dark:opacity-80"
                    )}
                  />
                ))}
              </svg>
            </div>
          </div>

          <h2 className="text-base font-semibold tracking-tight text-foreground mb-1.5">
            Setting up your workspace
          </h2>
          <p className="text-xs text-muted-foreground dark:text-muted-foreground font-medium leading-relaxed">
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
