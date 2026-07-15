"use client";

import type React from "react";
import { useEffect } from "react";

import { ROUTES } from "@admin/constants/routes";
import { useBranding } from "@admin/context/providers/BrandingProvider";
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
 */
export function BuilderGuard({ children }: BuilderGuardProps) {
  const branding = useBranding();
  // `undefined` means admin-meta is still in flight, not that the builder is
  // off — redirecting then would bounce people out of a legitimate page during
  // the load gap. Only an explicit `false` from the server is a decision.
  const isDisabled = branding.showBuilder === false;

  useEffect(() => {
    if (isDisabled) {
      navigateTo(ROUTES.DASHBOARD);
    }
  }, [isDisabled]);

  if (isDisabled) return null;

  return <>{children}</>;
}
