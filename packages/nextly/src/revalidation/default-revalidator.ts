/**
 * The factory the DI layer uses to seed the default `cacheRevalidator` on every
 * service boot.
 *
 * A framework adapter (the Next cache adapter) installs its factory here once,
 * at module startup. Because this lives in module scope — not the DI container —
 * it survives `clearServices()` / `shutdownServices()`, which clear only the
 * container. So when services reboot in the same process (HMR, a test harness),
 * the reboot re-seeds the adapter rather than falling back to the no-op default.
 * The adapter's own registration hook (`instrumentation.ts` /
 * `createDynamicHandlers`) runs only once at startup and would not re-run on a
 * reboot, which is why the container alone cannot carry it.
 *
 * @module revalidation/default-revalidator
 */
import { NoopRevalidator } from "./noop-revalidator";
import type { CacheRevalidator } from "./types";

let installedFactory: (() => CacheRevalidator) | null = null;

/**
 * Install the factory used to build the default revalidator (or pass `null` to
 * clear it and fall back to the no-op). Called by the Next adapter's
 * registration one-liner.
 */
export function setDefaultRevalidatorFactory(
  factory: (() => CacheRevalidator) | null
): void {
  installedFactory = factory;
}

/**
 * Build the default revalidator for a freshly (re)booted container: the
 * installed adapter when one is present, otherwise the no-op.
 */
export function createDefaultRevalidator(): CacheRevalidator {
  return installedFactory ? installedFactory() : new NoopRevalidator();
}
