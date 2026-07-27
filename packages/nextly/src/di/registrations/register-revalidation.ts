/**
 * Cache-revalidation DI registration.
 *
 * Registers the `cacheRevalidator` singleton the write path flushes intents to.
 * The default is a no-op, so core stays framework-neutral and a write never has
 * to null-check the sink; a framework adapter (the Next cache adapter) replaces
 * this registration with an implementation that calls `revalidateTag`.
 */
import { createDefaultRevalidator } from "../../revalidation/default-revalidator";
import type { CacheRevalidator } from "../../revalidation/types";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerRevalidationServices(_ctx: RegistrationContext): void {
  // Only register the default when nothing else has claimed the slot, so a
  // framework adapter registered earlier (or a test's fake) is never clobbered.
  // `createDefaultRevalidator` returns the framework adapter when one installed
  // its factory (a Next app), else the no-op — so a reboot after clearServices()
  // re-seeds the adapter instead of silently falling back to the no-op.
  if (!container.has("cacheRevalidator")) {
    container.registerSingleton<CacheRevalidator>("cacheRevalidator", () =>
      createDefaultRevalidator()
    );
  }
}
