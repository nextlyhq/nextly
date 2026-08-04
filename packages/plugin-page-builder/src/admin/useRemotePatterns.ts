"use client";

// The allowlist the host configured the plugin with, read where the editor
// runs. `pageBuilder({ remotePatterns })` is evaluated on the server when the
// host builds its config; the canvas is a browser component. `/api/admin-meta`
// is what crosses between them, and the SDK hook is how a plugin reads its own
// entry out of it.
import { usePluginClientConfig } from "@nextlyhq/plugin-sdk/admin";
import { useMemo } from "react";

import type { RemotePattern } from "../core/url-policy";

/** The plugin's package name, which is the key admin-meta is built on. */
const PLUGIN_NAME = "@nextlyhq/plugin-page-builder";

/**
 * Only entries that look like patterns survive.
 *
 * The config arrives as JSON that nothing has type-checked at the boundary, so
 * a malformed entry is dropped rather than handed to the matcher. Dropping is
 * the safe direction: a pattern that never arrives refuses a host, while one
 * with a missing `hostname` would be asked to match against `undefined`.
 */
function isPattern(value: unknown): value is RemotePattern {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { hostname?: unknown }).hostname === "string"
  );
}

/**
 * The remote patterns the editor should enforce, or an empty list.
 *
 * Empty is the fail-CLOSED default and stays that way: with no configuration
 * the canvas refuses every remote host, which hides media the published page
 * may show but can never display media the page would refuse.
 */
export function useRemotePatterns(): readonly RemotePattern[] {
  const config = usePluginClientConfig(PLUGIN_NAME);
  return useMemo(() => {
    const declared = config?.remotePatterns;
    if (!Array.isArray(declared)) return [];
    return declared.filter(isPattern);
  }, [config]);
}
