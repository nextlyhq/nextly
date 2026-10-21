import { describe, expect, it } from "vitest";

import type { RateLimitStore } from "../../../middleware/rate-limit";
import { readAuthRateLimit } from "../deps-bridge";

/**
 * Which store the auth limits are handed for an app's own store of the
 * earlier contract: the guarded copy the container registered, so the
 * second-factor fallback, which reads `store`, is held to the same time as
 * the rest of core's limits.
 */

const store = (): RateLimitStore => ({
  increment: async () => ({ count: 1, resetTime: 0 }),
  reset: async () => {},
});

describe("readAuthRateLimit with an app's own store", () => {
  it("hands out the container's guarded copy as both store and counts", () => {
    const raw = store();
    const guarded = store();
    const services: Record<string, unknown> = {
      config: { rateLimit: { store: raw } },
      coreRateLimitStore: guarded,
    };

    const read = readAuthRateLimit(name => services[name]);

    expect(read.store).toBe(guarded);
    expect(read.counts).toBe(guarded);
  });

  it("hands out the app's store as configured where the container has none", () => {
    const raw = store();
    const read = readAuthRateLimit(name =>
      name === "config" ? { rateLimit: { store: raw } } : undefined
    );

    expect(read.store).toBe(raw);
    expect(read.counts).toBe(raw);
  });
});
