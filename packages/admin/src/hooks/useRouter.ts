import { useState, useEffect } from "react";

import { resolveRoute, type RouteResult } from "@admin/lib/routing";

import { useHydration } from "./useHydration";

interface RouterState {
  route: RouteResult | null;
  outside: boolean;
  pathname: string;
}

export function useRouter() {
  const [routerState, setRouterState] = useState<RouterState>({
    route: null,
    outside: false,
    pathname: "",
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
        setRouterState({ route: null, outside: true, pathname });
        return;
      }

      // Resolve admin routes (keep full path with /admin)
      const resolved = resolveRoute(pathname, window.location.search);
      setRouterState({ route: resolved, outside: false, pathname });
    };

    // Initial route resolution after hydration
    handleLocationChange();

    // Set up event listeners
    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("locationchange", handleLocationChange);

    // Patch history API to detect pushState/replaceState
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalPushState = window.history.pushState;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function (
      data: unknown,
      unused: string,
      url?: string | URL | null  
    ) {
      const result = originalPushState.apply(this, [
        data as Parameters<History["pushState"]>[0],
        unused,
        url,
      ]);
      window.dispatchEvent(new Event("locationchange"));
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
      window.dispatchEvent(new Event("locationchange"));
      return result;
    };

    return () => {
      mounted = false;
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("locationchange", handleLocationChange);

      // Restore original history methods
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, [isHydrated]);

  return { ...routerState, isHydrated };
}
