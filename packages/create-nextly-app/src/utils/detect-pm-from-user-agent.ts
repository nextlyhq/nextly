import { EXACT_VERSION } from "../lib/exact-version";
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

/**
 * The `packageManager` value the launching command's user agent names,
 * `<name>@<version>`, for pnpm and Yarn when the version is exact: Corepack
 * runs that version, and with no field falls back to its own default (Yarn
 * 1.22.22 under Yarn 4.9.2). npm and Bun, and a user agent naming no exact
 * version, give null, so nothing is recorded for them.
 */
export function packageManagerFromUserAgent(
  userAgent: string | undefined | null
): string | null {
  const manager = detectPmFromUserAgent(userAgent);
  if (manager !== "pnpm" && manager !== "yarn") return null;
  // "yarn/4.9.2 npm/? node/v24.21.0 darwin arm64" -> "4.9.2"
  const version = (userAgent ?? "").split(" ")[0]?.slice(manager.length + 1);
  return version && EXACT_VERSION.test(version)
    ? `${manager}@${version}`
    : null;
}
