"use client";

import { useQuery } from "@tanstack/react-query";
import type React from "react";
import { useEffect } from "react";

import { ROUTES } from "@admin/constants/routes";
import { isAuthenticated as checkIsAuthenticated } from "@admin/lib/auth/session";
import { checkSetupStatus } from "@admin/lib/auth/setup-status";
import { navigateTo } from "@admin/lib/navigation";

async function verifyAuth(): Promise<{
  isSetup: boolean;
  isAuthenticated: boolean;
}> {
  const isSetup = await checkSetupStatus();
  if (!isSetup) {
    return { isSetup: false, isAuthenticated: false };
  }
  const authenticated = await checkIsAuthenticated();
  return { isSetup: true, isAuthenticated: authenticated };
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

    if (!data.isSetup) {
      navigateTo(ROUTES.SETUP);
      return;
    }

    if (!data.isAuthenticated) {
      navigateTo(ROUTES.LOGIN);
    }
  }, [data, status]);

  // While auth verification is pending, render an empty themed container so
  // the layout doesn't flash a mismatched background.
  if (status !== "success" || !data) {
    return <div className="min-h-screen bg-background" />;
  }

  if (!data.isSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground dark:text-muted-foreground">
          Redirecting to setup...
        </p>
      </div>
    );
  }

  if (!data.isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground dark:text-muted-foreground">
          Redirecting to login...
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
