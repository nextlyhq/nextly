/**
 * `markDynamic` — opt the current render out of Next's Data/Full Route Cache.
 *
 * `next/cache` is loaded through {@link loadNextModule}, so importing this
 * module never forces `next` at load, and it is a no-op where Next.js is not
 * installed (a context, not a version). Calling
 * `unstable_noStore()` marks the render dynamic — the piece that keeps an
 * uncached read from being frozen as a build-time prerender or a route-cached
 * page (bypassing `unstable_cache` alone does not opt out the route cache).
 *
 * @module runtime/routing/mark-dynamic
 */
import { loadNextModule, requireNextApi } from "../next-api";

let cachedNoStore: (() => void) | null | undefined;

/** Mark the current render dynamic (a no-op where Next.js is not installed). */
export function markDynamic(): void {
  if (cachedNoStore === undefined) {
    const mod = loadNextModule("next/cache");
    cachedNoStore = mod
      ? requireNextApi<() => void>(mod, "next/cache", "unstable_noStore")
      : null;
  }
  cachedNoStore?.();
}
