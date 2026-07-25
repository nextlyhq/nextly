/**
 * The factory the DI layer uses to seed the default `cacheRevalidator` on every
 * service boot.
 *
 * A framework adapter (the Next cache adapter) installs its factory here once,
 * at module startup. Because this lives outside the DI container, it survives
 * `clearServices()` / `shutdownServices()`, which clear only the container — so
 * when services reboot in the same process (HMR, a test harness), the reboot
 * re-seeds the adapter rather than falling back to the no-op default. The
 * adapter's own registration hook (`instrumentation.ts` / `createDynamicHandlers`)
 * runs only once at startup and would not re-run on a reboot, which is why the
 * container alone cannot carry it.
 *
 * Stored on `globalThis` (like the DI container itself) so it survives ESM
 * module duplication in Next.js/Turbopack, which can instantiate the same module
 * in separate server layers — a module-local variable would be `null` in the
 * copy that later reboots services.
 *
 * @module revalidation/default-revalidator
 */
import { NoopRevalidator } from "./noop-revalidator";
import type { CacheRevalidator } from "./types";

const globalForRevalidator = globalThis as unknown as {
  __nextly_default_revalidator_factory?: (() => CacheRevalidator) | null;
};

/**
 * Install the factory used to build the default revalidator (or pass `null` to
 * clear it and fall back to the no-op). Called by the Next adapter's
 * registration one-liner.
 */
export function setDefaultRevalidatorFactory(
  factory: (() => CacheRevalidator) | null
): void {
  globalForRevalidator.__nextly_default_revalidator_factory = factory;
}

/**
 * Build the default revalidator for a freshly (re)booted container: the
 * installed adapter when one is present, otherwise the no-op.
 */
export function createDefaultRevalidator(): CacheRevalidator {
  const factory = globalForRevalidator.__nextly_default_revalidator_factory;
  return factory ? factory() : new NoopRevalidator();
}
