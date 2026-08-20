"use client";

import type React from "react";
import { useEffect } from "react";

import { ROUTES } from "@admin/constants/routes";
import { useAuthSession } from "@admin/hooks/queries/useAuthSession";
import { navigateTo } from "@admin/lib/navigation";

interface PrivateRouteProps {
  children: React.ReactNode;
}

/**
 * Where an unusable session has to send the visitor, or `null` when it is
 * usable.
 *
 * One answer, read by both the effect that navigates and the placeholder that
 * says where it is going. They used to decide separately from the same fields,
 * which is two implementations of one question: a change to either could send
 * someone to setup while telling them they were going to login.
 */
function redirectFor(session: {
  isSetup: boolean;
  isAuthenticated: boolean;
}): { path: string; destination: string } | null {
  if (!session.isSetup) return { path: ROUTES.SETUP, destination: "setup" };
  if (!session.isAuthenticated)
    return { path: ROUTES.LOGIN, destination: "login" };
  return null;
}

/** The themed placeholder shown for the moment before the browser moves. */
function RedirectNotice({ destination }: { destination: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-muted-foreground dark:text-muted-foreground">
        Redirecting to {destination}...
      </p>
    </div>
  );
}

export function PrivateRoute({ children }: PrivateRouteProps) {
  // The shared session query, not a second verification of the same fact. The
  // data providers read this same key, so a session is fetched once and every
  // reader of it agrees.
  const { data, status } = useAuthSession();

  // Only acted on once the query has DEFINITIVELY resolved with data. In React
  // Query v5 `isLoading` can be false while data is still undefined — an error
  // state, or a transient one during a route transition — and redirecting from
  // there sends the visitor to LOGIN on a result that never arrived, which
  // loops against PublicRoute.
  const settled = status === "success" && data !== undefined;
  const redirect = settled ? redirectFor(data) : null;

  useEffect(() => {
    if (redirect) navigateTo(redirect.path);
  }, [redirect]);

  // Nothing decided yet: an empty themed container, so the layout does not
  // flash a mismatched background.
  if (!settled) return <div className="min-h-screen bg-background" />;
  if (redirect) return <RedirectNotice destination={redirect.destination} />;

  return <>{children}</>;
}
