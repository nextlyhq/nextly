/**
 * `markDynamic` — opt the current render out of Next's Data/Full Route Cache.
 *
 * `next/cache` is resolved lazily (opaque to bundlers) so importing this module
 * never forces `next` at load, and it is a no-op off a Next runtime. Calling
 * `unstable_noStore()` marks the render dynamic — the piece that keeps an
 * uncached read from being frozen as a build-time prerender or a route-cached
 * page (bypassing `unstable_cache` alone does not opt out the route cache).
 *
 * @module runtime/routing/mark-dynamic
 */
import { createRequire } from "node:module";

let cachedNoStore: (() => void) | null | undefined;

/** Mark the current render dynamic (best-effort; a no-op outside Next). */
export function markDynamic(): void {
  if (cachedNoStore === undefined) {
    try {
      const require = createRequire(import.meta.url);
      const mod = require("next/cache") as { unstable_noStore?: () => void };
      cachedNoStore =
        typeof mod.unstable_noStore === "function"
          ? mod.unstable_noStore
          : null;
    } catch {
      cachedNoStore = null;
    }
  }
  cachedNoStore?.();
}
