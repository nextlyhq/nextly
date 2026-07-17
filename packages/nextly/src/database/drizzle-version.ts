// Single source of truth (runtime side) for the required Drizzle version.
// MUST match scripts/drizzle-version.cjs — the zero-legacy gate asserts the
// two stay equal. Used by the boot-time mismatch guard: a user app that
// installs a different drizzle-orm gets a plain-English error instead of
// opaque cross-instance `is()` failures deep inside Drizzle.
import { createRequire } from "node:module";

export const REQUIRED_DRIZZLE_VERSION = "1.0.0-rc.4";

/**
 * Compare the drizzle-orm version resolvable from the consumer app's root
 * against the version Nextly requires. Returns an error message when they
 * mismatch, null when they match or when the app has no own drizzle-orm
 * (the transitive copy from Nextly's exact pin is then the only instance —
 * the safe default).
 */

export function checkConsumerDrizzleVersion(appRoot: string): string | null {
  try {
    // Resolve from the APP's dependency graph, not Nextly's — that is
    // exactly the copy a user's custom queries would import.
    const appRequire = createRequire(`${appRoot}/package.json`);
    const pkg = appRequire("drizzle-orm/package.json") as { version?: string };
    if (pkg.version && pkg.version !== REQUIRED_DRIZZLE_VERSION) {
      return (
        `drizzle-orm version mismatch: your app resolves drizzle-orm@` +
        `${pkg.version}, but Nextly requires exactly ` +
        `${REQUIRED_DRIZZLE_VERSION}. Mixed versions break Drizzle's ` +
        `cross-instance is() checks (tables stop being recognized as ` +
        `tables). Fix: pnpm add drizzle-orm@${REQUIRED_DRIZZLE_VERSION}`
      );
    }
    return null;
  } catch {
    // No resolvable drizzle-orm at the app root — only Nextly's pinned
    // transitive copy exists, which is the safe configuration.
    return null;
  }
}
