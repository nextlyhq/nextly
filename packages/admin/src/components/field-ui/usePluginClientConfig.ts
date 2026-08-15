"use client";

// Reads one plugin's own configuration out of the admin branding context. A
// plugin's factory runs on the server when the host builds its config, and its
// admin components run in the browser; `/api/admin-meta` is the only thing
// that crosses between them, so this is where a plugin component learns what
// the host configured it with.
import { useMemo } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";

/**
 * The `clientConfig` a plugin declared, or `undefined` when it declared none.
 *
 * Looked up by the plugin's package name, which is the key admin-meta is
 * built on, so a plugin asks for its own entry rather than indexing into a
 * shared array by position.
 *
 * The value is public — `/api/admin-meta` needs no authentication, so it
 * reaches anonymous callers — and is JSON, which the serializer enforces
 * rather than assumes. Returned as
 * `unknown` values so a caller narrows what it actually needs instead of
 * trusting a shape nothing checked at the boundary.
 */
export function usePluginClientConfig(
  pluginName: string
): Record<string, unknown> | undefined {
  const branding = useBranding();
  return useMemo(() => {
    // The installed list when it has arrived, the public channel otherwise.
    // Both carry `clientConfig`, and the gated one is the richer record — so
    // this prefers it rather than reading two sources and reconciling them.
    //
    // The fallback is what a plugin contributing to the SIGN-IN screen depends
    // on: there is no session yet, so the installed list cannot exist, and its
    // absence says nothing about whether the plugin declared a config.
    const declared = branding.plugins ?? branding.pluginClientConfigs;
    return declared?.find(p => p.name === pluginName)?.clientConfig;
  }, [branding.plugins, branding.pluginClientConfigs, pluginName]);
}
