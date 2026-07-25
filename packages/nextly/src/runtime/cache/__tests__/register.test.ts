/**
 * `registerNextCacheRevalidator` installs the Next adapter as the active
 * `cacheRevalidator`, and must keep working across a container reinitialisation:
 * a module-level "already registered" flag would go stale after the container is
 * cleared and re-seeded with the no-op default, silently leaving revalidation
 * off.
 */
import { describe, expect, it } from "vitest";

import { container } from "../../../di/container";
import { NoopRevalidator } from "../../../revalidation/noop-revalidator";
import type { CacheRevalidator } from "../../../revalidation/types";
import { NextCacheRevalidator } from "../next-cache-revalidator";
import { registerNextCacheRevalidator } from "../register";

describe("registerNextCacheRevalidator", () => {
  it("installs the Next adapter as the active revalidator", () => {
    registerNextCacheRevalidator();
    expect(container.get<CacheRevalidator>("cacheRevalidator")).toBeInstanceOf(
      NextCacheRevalidator
    );
  });

  it("re-installs after the container is re-seeded with the no-op default", () => {
    registerNextCacheRevalidator();
    // Simulate a clearServices() + boot cycle: the default no-op is registered
    // again over a fresh container.
    container.register<CacheRevalidator>(
      "cacheRevalidator",
      () => new NoopRevalidator()
    );
    expect(container.get<CacheRevalidator>("cacheRevalidator")).toBeInstanceOf(
      NoopRevalidator
    );

    // A stale "already registered" flag would make this a no-op and leave the
    // no-op default in place; driving off the container re-installs the adapter.
    registerNextCacheRevalidator();
    expect(container.get<CacheRevalidator>("cacheRevalidator")).toBeInstanceOf(
      NextCacheRevalidator
    );
  });
});
