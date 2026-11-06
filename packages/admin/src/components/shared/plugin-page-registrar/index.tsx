"use client";

import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { usePluginPageRegistration } from "@admin/hooks/usePluginPageRegistration";

/**
 * Side-effect-only component (renders nothing) that keeps the plugin page route
 * registry in sync with the admin-meta plugin list. Mounted inside
 * `BrandingProvider` so it can read `branding.plugins`.
 */
export function PluginPageRegistrar(): null {
  const branding = useBranding();
  // The workspace half carries the plugin list; its settling, not the list's
  // presence, says whether plugin pages are known.
  const { isPending, isUnavailable } = useBrandingStatus();
  usePluginPageRegistration(branding?.plugins, !isPending && !isUnavailable);
  return null;
}
