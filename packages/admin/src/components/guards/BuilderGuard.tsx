"use client";

import type React from "react";
import { useEffect } from "react";

import { PageErrorFallback } from "@admin/components/shared/error-fallbacks/PageErrorFallback";
import { ROUTES } from "@admin/constants/routes";
import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { navigateTo } from "@admin/lib/navigation";

interface BuilderGuardProps {
  children: React.ReactNode;
}

/**
 * Route-level guard for the schema builder.
 *
 * The builder is off in production by default (see `admin.branding.showBuilder`),
 * where the sidebar already drops its links — but a bookmark or a pasted URL
 * would still land on the page. This sends those visits back to the dashboard
 * so the builder isn't reachable by address alone.
 *
 * The server refuses the schema writes regardless; this is about not showing a
 * page whose every action would fail.
 *
 * The page is shown only on the server's explicit `true`. `showBuilder` is
 * `undefined` in three cases that look alike here: the answer is in flight,
 * the session has not settled so the request has not started, and the request
 * failed. None of them says the builder is on, so none of them shows it.
 */
export function BuilderGuard({ children }: BuilderGuardProps) {
  const { showBuilder } = useBranding();
  const { isPending } = useBrandingStatus();
  const isDisabled = showBuilder === false;

  useEffect(() => {
    if (isDisabled) {
      navigateTo(ROUTES.DASHBOARD);
    }
  }, [isDisabled]);

  if (isDisabled) return null;

  if (showBuilder === true) return <>{children}</>;

  // The empty themed container `PrivateRoute` and `PublicRoute` hold a visit
  // on. It is sized to the content area, since the dashboard's frame is
  // already on screen around it.
  if (isPending) {
    return (
      <div
        data-slot="builder-guard-pending"
        aria-busy="true"
        className="min-h-[60vh] bg-background"
      />
    );
  }

  // Settled with no answer. Redirecting would read a failed request as "the
  // builder is off", which nothing said either.
  return (
    <PageErrorFallback
      title="The schema builder could not be loaded"
      description="The admin could not find out whether the schema builder is available on this server. Reload the page to try again."
    />
  );
}
