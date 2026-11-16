"use client";

import { useState, useEffect } from "react";

import { forgetEntryBehind, recordPushFrom } from "@admin/lib/admin-history";
import {
  resolveRoute,
  startRouteCode,
  type RouteResult,
} from "@admin/lib/routing";

import { useHydration } from "./useHydration";

interface RouterState {
  route: RouteResult | null;
  outside: boolean;
  pathname: string;
  /**
   * When the browser arrived at `pathname`, in `Date.now()` milliseconds, or
   * `null` before the first route is resolved. A screen's loading states time
   * themselves from here, so a part mounted late in the same visit (the screen
   * once the session is confirmed) continues the wait rather than starting it
   * again. A change of query string alone keeps it.
   */
  routedAt: number | null;
}

export function useRouter(): {
  isHydrated: boolean;
  route: RouteResult | null;
  outside: boolean;
  pathname: string;
  routedAt: number | null;
} {
  const [routerState, setRouterState] = useState<RouterState>({
    route: null,
    outside: false,
    pathname: "",
    routedAt: null,
  });
  const isHydrated = useHydration();

  useEffect(() => {
    if (!isHydrated) return;

    let mounted = true;

    const handleLocationChange = () => {
      if (!mounted) return;

      const pathname = window.location.pathname;

      // Handle non-admin paths
      if (!pathname.startsWith("/admin")) {
        setRouterState({
          route: null,
          outside: true,
          pathname,
          routedAt: null,
        });
        return;
      }

      // Resolve admin routes (keep full path with /admin)
      const resolved = resolveRoute(pathname, window.location.search);
      // The screen's code is fetched from here, beside the session check: a
      // private screen renders only once the server confirms the session, and
      // its page would otherwise start downloading after that answer.
      startRouteCode(resolved);
      // Read here, in the handler, so rendering stays free of the clock.
      const now = Date.now();
      setRouterState(previous => ({
        route: resolved,
        outside: false,
        pathname,
        routedAt:
          previous.pathname === pathname && previous.routedAt !== null
            ? previous.routedAt
            : now,
      }));
    };

    // Initial route resolution after hydration
    handleLocationChange();

    // Set up event listeners
    // A jump through history lands on an entry whose own predecessor the
    // admin never saw, so what lies behind it is no longer known.
    const handleHistoryJump = () => forgetEntryBehind();
    window.addEventListener("popstate", handleHistoryJump);
    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("locationchange", handleLocationChange);

    // Patch history API to detect pushState/replaceState
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalPushState = window.history.pushState;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalReplaceState = window.history.replaceState;

    // Defer the locationchange dispatch one microtask so the consequent
    // setState in `handleLocationChange` doesn't fire inside a caller's
    // `useInsertionEffect`. Style-injection libraries (Sonner, Radix,
    // CSS-in-JS) call replaceState during their insertion phase; React
    // forbids state updates there. The URL is already updated by the
    // time the microtask runs, so route resolution still sees the
    window.history.pushState = function (
      data: unknown,
      unused: string,
      url?: string | URL | null
    ) {
      // The page being left is the entry a push puts behind the new one.
      recordPushFrom(window.location.pathname);
      const result = originalPushState.apply(this, [
        data as Parameters<History["pushState"]>[0],
        unused,
        url,
      ]);
      queueMicrotask(() => window.dispatchEvent(new Event("locationchange")));
      return result;
    };

    window.history.replaceState = function (
      data: unknown,
      unused: string,
      url?: string | URL | null
    ) {
      const result = originalReplaceState.apply(this, [
        data as Parameters<History["replaceState"]>[0],
        unused,
        url,
      ]);
      queueMicrotask(() => window.dispatchEvent(new Event("locationchange")));
      return result;
    };

    return () => {
      mounted = false;
      window.removeEventListener("popstate", handleHistoryJump);
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("locationchange", handleLocationChange);

      // Restore original history methods
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, [isHydrated]);

  return { ...routerState, isHydrated };
}
