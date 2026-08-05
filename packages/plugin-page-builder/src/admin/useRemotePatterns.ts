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
 * Only entries that are patterns in FULL survive.
 *
 * The config arrives as JSON, and the TypeScript declaration constrains the
 * host that wrote it rather than the bytes that arrive — a JavaScript host, a
 * hand-edited config or an older plugin version all reach here unchecked. So
 * every field is checked, not just the required one. A half-valid entry is
 * worse than a missing one: `protocol: 1` reaches `.replace` and `pathname:
 * null` reaches picomatch, and each throws inside the matcher, taking the
 * editor down instead of refusing a host.
 *
 * Dropping is the safe direction. A pattern that never arrives refuses media;
 * one that arrives malformed decides nothing and crashes.
 */
function isPattern(value: unknown): value is RemotePattern {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  if (typeof p.hostname !== "string" || p.hostname === "") return false;
  // The union the matcher compares against; anything else would be silently
  // unmatchable rather than an error, which is a worse failure than refusing.
  if (
    p.protocol !== undefined &&
    p.protocol !== "http" &&
    p.protocol !== "https"
  )
    return false;
  for (const key of ["port", "pathname", "search"] as const) {
    if (p[key] !== undefined && typeof p[key] !== "string") return false;
  }
  return true;
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
