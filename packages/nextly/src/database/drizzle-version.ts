// Single source of truth (runtime side) for the required Drizzle version.
// MUST match scripts/drizzle-version.cjs — the zero-legacy gate asserts the
// two stay equal. Used by the boot-time mismatch guard: a user app that
// installs a different drizzle-orm gets a plain-English error instead of
// opaque cross-instance `is()` failures deep inside Drizzle.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export const REQUIRED_DRIZZLE_VERSION = "1.0.0-rc.4";

/**
 * Resolve the version of the drizzle-orm the consumer app would import, WITHOUT
 * going through the `drizzle-orm/package.json` subpath. Older lines (e.g.
 * 0.45.2) don't list `./package.json` in their `exports` map, so
 * `require("drizzle-orm/package.json")` throws ERR_PACKAGE_PATH_NOT_EXPORTED —
 * which is exactly the mismatched-version case this guard exists to catch.
 * Instead resolve the package's main entry (always exported) and walk up to the
 * nearest package.json on disk, reading it with fs so the exports map can't
 * hide it.
 *
 * Returns the version string, or null when drizzle-orm is not installed at the
 * app root (only Nextly's pinned transitive copy exists — the safe default).
 */
function resolveConsumerDrizzleVersion(appRoot: string): string | null {
  const appRequire = createRequire(`${appRoot}/package.json`);
  let entry: string;
  try {
    entry = appRequire.resolve("drizzle-orm");
  } catch {
    // Not resolvable from the app root — no own copy.
    return null;
  }
  // Walk up from the resolved entry file to the package's own package.json.
  let dir = dirname(entry);
  for (let i = 0; i < 20; i++) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8")
      ) as { name?: string; version?: string };
      if (pkg.name === "drizzle-orm") return pkg.version ?? null;
    } catch {
      // No package.json here (or unreadable) — keep climbing.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Compare the drizzle-orm version resolvable from the consumer app's root
 * against the version Nextly requires. Returns an error message when they
 * mismatch, null when they match or when the app has no own drizzle-orm
 * (the transitive copy from Nextly's exact pin is then the only instance —
 * the safe default).
 */
export function checkConsumerDrizzleVersion(appRoot: string): string | null {
  // Resolve from the APP's dependency graph, not Nextly's — that is exactly
  // the copy a user's custom queries would import.
  const version = resolveConsumerDrizzleVersion(appRoot);
  if (version && version !== REQUIRED_DRIZZLE_VERSION) {
    return (
      `drizzle-orm version mismatch: your app resolves drizzle-orm@` +
      `${version}, but Nextly requires exactly ` +
      `${REQUIRED_DRIZZLE_VERSION}. Mixed versions break Drizzle's ` +
      `cross-instance is() checks (tables stop being recognized as ` +
      `tables). Fix: pnpm add drizzle-orm@${REQUIRED_DRIZZLE_VERSION}`
    );
  }
  return null;
}
