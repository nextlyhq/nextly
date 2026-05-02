"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";

import { ROUTES } from "@admin/constants/routes";
import { publicApi } from "@admin/lib/api/publicApi";
import { isAuthenticated } from "@admin/lib/auth/session";
import { navigateTo } from "@admin/lib/navigation";

interface PublicRouteProps {
  children: React.ReactNode;
}

export function PublicRoute({ children }: PublicRouteProps) {
  const [isChecking, setIsChecking] = useState(true);
  // Track whether this component instance is still mounted.
  // Prevents stale async callbacks from calling navigateTo after
  // the component has been unmounted by a route change, which was
  // causing an infinite redirect loop between guards.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const checkAuth = async () => {
      try {
        // Check if initial setup has been completed
        const setupStatus = await publicApi.get<{ isSetupComplete: boolean }>(
          "/auth/setup-status"
        );

        if (!mountedRef.current) return;

        const currentPath = window.location.pathname;
        const isOnSetupPage = currentPath === ROUTES.SETUP;

        if (!setupStatus.isSetupComplete) {
          // No users exist yet — redirect to setup page (unless already there)
          if (!isOnSetupPage) {
            navigateTo(ROUTES.SETUP);
            return;
          }
        } else {
          // Setup is complete — block access to the setup page
          if (isOnSetupPage) {
            navigateTo(ROUTES.LOGIN);
            return;
          }

          // Existing behavior: redirect authenticated users to dashboard
          const authenticated = await isAuthenticated();
          if (!mountedRef.current) return;
          if (authenticated) {
            navigateTo(ROUTES.DASHBOARD);
            return;
          }
        }
      } catch {
        if (!mountedRef.current) return;
        // If setup-status fails, fall back to existing auth check behavior
        const authenticated = await isAuthenticated();
        if (!mountedRef.current) return;
        if (authenticated) {
          navigateTo(ROUTES.DASHBOARD);
          return;
        }
      }

      if (mountedRef.current) {
        setIsChecking(false);
      }
    };

    void checkAuth();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-none h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
