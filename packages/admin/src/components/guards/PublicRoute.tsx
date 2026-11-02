"use client";

import type React from "react";
import { useEffect, useRef } from "react";

import { ROUTES } from "@admin/constants/routes";
import { isAuthenticated } from "@admin/lib/auth/session";
import { checkSetupStatus } from "@admin/lib/auth/setup-status";
import { navigateTo } from "@admin/lib/navigation";

interface PublicRouteProps {
  children: React.ReactNode;
}

/**
 * Draws the page at once and checks setup and the session behind it, moving the
 * visitor only if a check says they belong elsewhere.
 *
 * The checks used to come first, behind an empty page, and on a server that is
 * starting they take a minute: the login form could not be seen until the
 * server could also answer it. Drawn first, the form is there to read and fill
 * while the server catches up.
 */
export function PublicRoute({ children }: PublicRouteProps): React.JSX.Element {
  // Track whether this component instance is still mounted.
  // Prevents stale async callbacks from calling navigateTo after
  // the component has been unmounted by a route change, which was
  // causing an infinite redirect loop between guards.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const checkAuth = async () => {
      // The two checks are independent requests, so the session probe starts
      // immediately rather than after setup-status answers. Awaited serially
      // they cost two full API round-trips before this guard can render
      // anything — the login screen stayed a blank themed div for both.
      // A server that cannot answer leaves the visitor where they are: the page
      // is already drawn, and nothing sends them anywhere on a non-answer.
      const sessionPromise = isAuthenticated().catch(() => false);
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

        // Redirect authenticated users to dashboard. `isAuthenticated`
        // resolves the promise started above; when setup-status was slow the
        // session answer is often already in hand here. On the !isSetup paths
        // the probe is simply never awaited — one request that also warms the
        // shared 5-minute session cache.
        const authenticated = await sessionPromise;
        if (!mountedRef.current) return;
        if (authenticated) {
          navigateTo(ROUTES.DASHBOARD);
        }
      }
    };

    void checkAuth();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  return <>{children}</>;
}
