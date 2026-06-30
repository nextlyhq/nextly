/**
 * Core version source for the plugin resolver.
 *
 * The running core version is needed by `resolvePlugins` to validate each
 * plugin's `nextly` compatibility range. We obtain it from a build-time /
 * test-time injected constant (`__NEXTLY_CORE_VERSION__`, set via the tsup and
 * vitest `define` blocks reading `package.json`), falling back to reading our
 * own `package.json` at runtime (Node only) so the value is always available.
 *
 * @module plugins/core-version
 */

import { createRequire } from "module";

declare const __NEXTLY_CORE_VERSION__: string | undefined;

let cached: string | undefined;

/**
 * Resolve the concrete running `nextly` core version (e.g. "0.0.2-alpha.21").
 * Never throws; never returns an empty string.
 */
export function getCoreVersion(): string {
  if (cached) return cached;

  // Build-time / test-time injected constant (tsup + vitest `define`).
  const injected =
    typeof __NEXTLY_CORE_VERSION__ !== "undefined"
      ? __NEXTLY_CORE_VERSION__
      : undefined;
  if (injected && injected.length > 0) {
    cached = injected;
    return cached;
  }

  // Runtime fallback: read our own package.json relative to this module.
  try {
    const req = createRequire(import.meta.url);
    const pkg = req("../../package.json") as { version?: string };
    if (pkg.version && pkg.version.length > 0) {
      cached = pkg.version;
      return cached;
    }
  } catch {
    // Ignore — fall through to the last-resort sentinel below.
  }

  cached = "0.0.0";
  return cached;
}
