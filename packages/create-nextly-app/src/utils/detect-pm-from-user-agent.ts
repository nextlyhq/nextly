import type { PackageManager } from "../types";

/**
 * Detect the package manager that invoked `create-nextly-app` by reading
 * `process.env.npm_config_user_agent`. Every package manager (npm, pnpm,
 * yarn, bun) sets this env var when running a `create-*` command, so it's
 * the most reliable signal for fresh-scaffold contexts where no lockfile
 * exists yet in the target directory.
 *
 * Returns null when the var is missing or doesn't match a known PM —
 * callers can then fall back to lockfile detection. Mirrors the pattern
 * used by `create-next-app` and `create-vite`.
 *
 * Example UA strings:
 *   - "npm/10.9.0 node/v22.10.0 darwin arm64"
 *   - "pnpm/9.15.0 npm/? node/v22.10.0 darwin arm64"
 *   - "yarn/1.22.22 npm/? node/v22.10.0 darwin arm64"
 *   - "bun/1.1.30 npm/? node/v22.10.0 darwin arm64"
 */
export function detectPmFromUserAgent(
  userAgent: string | undefined | null
): PackageManager | null {
  if (!userAgent) return null;
  if (userAgent.startsWith("pnpm/")) return "pnpm";
  if (userAgent.startsWith("yarn/")) return "yarn";
  if (userAgent.startsWith("bun/")) return "bun";
  if (userAgent.startsWith("npm/")) return "npm";
  return null;
}
