/**
 * `registerNextCacheRevalidator` installs the Next adapter as the active
 * `cacheRevalidator`, and — crucially — keeps it installed across a container
 * clear + reboot in the same process. Its instrumentation / handler hook runs
 * only once at startup, so the registration has to persist through
 * `clearServices()` on its own; otherwise `registerServices()` re-seeds the
 * no-op default and writes silently stop invalidating caches.
 */
import { afterEach, describe, expect, it } from "vitest";

import { container } from "../../../di/container";
import { registerRevalidationServices } from "../../../di/registrations/register-revalidation";
import type { RegistrationContext } from "../../../di/registrations/types";
import { setDefaultRevalidatorFactory } from "../../../revalidation/default-revalidator";
import { NoopRevalidator } from "../../../revalidation/noop-revalidator";
import type { CacheRevalidator } from "../../../revalidation/types";
import { NextCacheRevalidator } from "../next-cache-revalidator";
import { registerNextCacheRevalidator } from "../register";

// registerRevalidationServices ignores its context (it only touches the
// container), so a bare stub is all the reboot simulation needs.
const ctx = {} as RegistrationContext;

describe("registerNextCacheRevalidator", () => {
  afterEach(() => {
    // The installed factory is module-scoped, so reset it (and the container)
    // to keep this suite from leaking a Next adapter default into others.
    setDefaultRevalidatorFactory(null);
    container.clear();
  });

  it("installs the Next adapter as the active revalidator", () => {
    registerNextCacheRevalidator();
    expect(container.get<CacheRevalidator>("cacheRevalidator")).toBeInstanceOf(
      NextCacheRevalidator
    );
  });

  it("survives a container clear + reboot without being re-called", () => {
    registerNextCacheRevalidator();

    // Simulate clearServices()/shutdownServices() followed by a fresh
    // registerServices() — WITHOUT calling registerNextCacheRevalidator again
    // (its startup hook does not re-run on a reboot).
    container.clear();
    registerRevalidationServices(ctx);

    // The factory persisted in module scope, so the reboot re-seeds the adapter
    // instead of the no-op default.
    expect(container.get<CacheRevalidator>("cacheRevalidator")).toBeInstanceOf(
      NextCacheRevalidator
    );
  });

  it("falls back to the no-op when no adapter installed its factory", () => {
    // A bare boot with no Next adapter registered uses the no-op.
    registerRevalidationServices(ctx);
    expect(container.get<CacheRevalidator>("cacheRevalidator")).toBeInstanceOf(
      NoopRevalidator
    );
  });
});
