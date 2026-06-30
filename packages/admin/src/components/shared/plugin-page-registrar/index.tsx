"use client";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { usePluginPageRegistration } from "@admin/hooks/usePluginPageRegistration";

/**
 * Side-effect-only component (renders nothing) that keeps the plugin page route
 * registry in sync with the admin-meta plugin list. Mounted inside
 * `BrandingProvider` so it can read `branding.plugins`.
 */
export function PluginPageRegistrar(): null {
  const branding = useBranding();
  usePluginPageRegistration(branding?.plugins);
  return null;
}
