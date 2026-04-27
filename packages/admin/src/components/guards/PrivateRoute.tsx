import { useQuery } from "@tanstack/react-query";
import React, { useEffect } from "react";

import { ROUTES } from "@admin/constants/routes";
import { publicApi } from "@admin/lib/api/publicApi";
import { isAuthenticated as checkIsAuthenticated } from "@admin/lib/auth/session";
import { navigateTo } from "@admin/lib/navigation";

// ─── Setup status cache (survives across renders, cleared on session end) ──
let setupStatusCache: boolean | null = null;

async function checkSetupStatus(): Promise<boolean> {
  if (setupStatusCache !== null) return setupStatusCache;
  try {
    const result = await publicApi.get<{ isSetupComplete: boolean }>(
      "/auth/setup-status"
    );
    setupStatusCache = result.isSetupComplete;
    return setupStatusCache;
  } catch {
    // If setup-status fails (e.g. 429), assume setup is complete and cache it
    // so we don't hammer the endpoint on every re-render.
    setupStatusCache = true;
    return setupStatusCache;
  }
}

/** Reset setup cache (call after setup or logout) */
export function resetSetupStatusCache(): void {
  setupStatusCache = null;
}

async function verifyAuth(): Promise<{
  isSetupComplete: boolean;
  isAuthenticated: boolean;
}> {
  const isSetupComplete = await checkSetupStatus();
  if (!isSetupComplete) {
    return { isSetupComplete: false, isAuthenticated: false };
  }
  const authenticated = await checkIsAuthenticated();
  return { isSetupComplete: true, isAuthenticated: authenticated };
}

interface PrivateRouteProps {
  children: React.ReactNode;
}

export function PrivateRoute({ children }: PrivateRouteProps) {
  const { data, status } = useQuery({
    queryKey: ["auth", "session"],
    queryFn: verifyAuth,
    staleTime: 5 * 60 * 1000, // 5 min — don't re-verify on every navigation
    gcTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false, // Trust the cache within staleTime
  });

  // Only redirect when the query has DEFINITIVELY resolved with data.
  // In React Query v5, `isLoading` (isPending && isFetching) can be false
  // while data is still undefined (e.g. error state, or transient states
  // during route transitions). Using `status === 'success'` ensures we
  // only act on confirmed auth results — never during pending, error,
  // or any intermediate state that could trigger a premature redirect
  // to LOGIN and cause an infinite loop with PublicRoute.
  useEffect(() => {
    if (status !== "success") return;

    if (!data.isSetupComplete) {
      navigateTo(ROUTES.SETUP);
      return;
    }

    if (!data.isAuthenticated) {
      navigateTo(ROUTES.LOGIN);
    }
  }, [data, status]);

  if (status !== "success" || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Verifying authentication...</p>
        </div>
      </div>
    );
  }

  if (!data.isSetupComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <p className="text-gray-600 dark:text-gray-400">
          Redirecting to setup...
        </p>
      </div>
    );
  }

  if (!data.isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <p className="text-gray-600 dark:text-gray-400">
          Redirecting to login...
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
