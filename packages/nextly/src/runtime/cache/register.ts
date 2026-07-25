/**
 * Registers the Next.js cache adapter as the `cacheRevalidator` the write path
 * flushes to. Call once when your app boots inside Next (the admin route wiring
 * does this for you — see `createDynamicHandlers`); after that, every content
 * write busts the Next cache tags a read carries.
 *
 * @module runtime/cache/register
 */
import { container } from "../../di/container";
import type { CacheRevalidator } from "../../revalidation/types";

import { NextCacheRevalidator } from "./next-cache-revalidator";

let registered = false;

/**
 * Register {@link NextCacheRevalidator} as the active `cacheRevalidator`,
 * replacing the no-op default. Idempotent.
 *
 * Uses a plain factory (not a memoised singleton) so the registration wins even
 * if the no-op default was already resolved once during boot — the write path
 * resolves the revalidator lazily at flush time, so a later registration is
 * honored. The adapter is stateless (its `next/cache` resolution is memoised at
 * module scope), so a fresh instance per resolve costs nothing.
 */
export function registerNextCacheRevalidator(): void {
  if (registered) return;
  container.register<CacheRevalidator>(
    "cacheRevalidator",
    () => new NextCacheRevalidator()
  );
  registered = true;
}
