/**
 * Registers the Next.js cache adapter as the `cacheRevalidator` the write path
 * flushes to. Call once when your app boots inside Next (the admin route wiring
 * does this for you — see `createDynamicHandlers`); after that, every content
 * write busts the Next cache tags a read carries.
 *
 * @module runtime/cache/register
 */
import { container } from "../../di/container";
import { setDefaultRevalidatorFactory } from "../../revalidation/default-revalidator";
import type { CacheRevalidator } from "../../revalidation/types";

import { NextCacheRevalidator } from "./next-cache-revalidator";

const nextRevalidatorFactory = (): CacheRevalidator =>
  new NextCacheRevalidator();

/**
 * Register {@link NextCacheRevalidator} as the active `cacheRevalidator`,
 * replacing the no-op default. Safe to call any number of times.
 *
 * Installs the factory as the DI layer's default revalidator (so every service
 * boot — including a reboot after `clearServices()` / `shutdownServices()` in
 * the same process — re-seeds the adapter rather than the no-op), and also
 * (re)installs it on the current container so it takes effect immediately even
 * if the no-op default was already resolved once during boot. The write path
 * resolves the revalidator lazily at flush time, so a later registration is
 * honored. The adapter is stateless (its `next/cache` resolution is memoised at
 * module scope), so a fresh instance per resolve costs nothing.
 */
export function registerNextCacheRevalidator(): void {
  setDefaultRevalidatorFactory(nextRevalidatorFactory);
  container.register<CacheRevalidator>(
    "cacheRevalidator",
    nextRevalidatorFactory
  );
}
