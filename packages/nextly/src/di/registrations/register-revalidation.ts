/**
 * Cache-revalidation DI registration.
 *
 * Registers the `cacheRevalidator` singleton the write path flushes intents to.
 * The default is a no-op, so core stays framework-neutral and a write never has
 * to null-check the sink; a framework adapter (the Next cache adapter) replaces
 * this registration with an implementation that calls `revalidateTag`.
 */
import { NoopRevalidator } from "../../revalidation/noop-revalidator";
import type { CacheRevalidator } from "../../revalidation/types";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerRevalidationServices(_ctx: RegistrationContext): void {
  // Only register the no-op default when nothing else has claimed the slot, so a
  // framework adapter registered earlier (or a test's fake) is never clobbered.
  if (!container.has("cacheRevalidator")) {
    container.registerSingleton<CacheRevalidator>(
      "cacheRevalidator",
      () => new NoopRevalidator()
    );
  }
}
