"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";

import { ROUTES } from "@admin/constants/routes";
import { isAuthenticated } from "@admin/lib/auth/session";
import { checkSetupStatus } from "@admin/lib/auth/setup-status";
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
      // `checkSetupStatus` swallows its own failures and fail-safes to
      // "setup complete," so no try/catch is needed here -- the only way
      // this function returns is with a definitive boolean.
      const isSetup = await checkSetupStatus();
      if (!mountedRef.current) return;

      const currentPath = window.location.pathname;
      const isOnSetupPage = currentPath === ROUTES.SETUP;

      if (!isSetup) {
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

        // Redirect authenticated users to dashboard
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

  // While the auth check is pending, render an empty themed container so
  // the layout doesn't flash a mismatched background.
  if (isChecking) {
    return <div className="min-h-screen bg-background" />;
  }

  return <>{children}</>;
}
