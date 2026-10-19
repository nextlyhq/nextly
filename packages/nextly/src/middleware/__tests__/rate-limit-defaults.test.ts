/**
 * The REST limit's defaults have one source. Two copies once disagreed: an app
 * configured through `defineConfig` got 100 reads a minute while a limiter
 * built without values got 600, and a spec sized a budget from the wrong one.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_RATE_LIMIT_CONFIG,
  sanitizeConfig,
} from "../../shared/types/config";
import {
  InMemoryRateLimitStore,
  RATE_LIMIT_DEFAULTS,
  type RateLimitConfig,
} from "../rate-limit";
import { createRateLimiter } from "../rest-limits";

/** How many of `times` requests one client is admitted, reads or writes. */
async function admitted(
  config: RateLimitConfig,
  method: string,
  times: number
): Promise<number> {
  const check = createRateLimiter({
    ...config,
    keyGenerator: () => "one-client",
    store: new InMemoryRateLimitStore(),
  });
  let count = 0;
  for (let i = 0; i < times; i++) {
    const refused = await check(
      new Request("http://localhost/api/posts", { method })
    );
    if (refused === null) count++;
  }
  return count;
}

describe("the REST limit's defaults", () => {
  it("are one object, the sanitized config's being the limiter's", () => {
    expect(DEFAULT_RATE_LIMIT_CONFIG).toBe(RATE_LIMIT_DEFAULTS);
  });

  it.each([
    ["GET", "readLimit"],
    ["POST", "writeLimit"],
  ] as const)(
    "admit an app with no rateLimit exactly as many %s requests as a limiter built with no values",
    async (method, limit) => {
      const sanitized = sanitizeConfig({ collections: [] }).rateLimit;
      expect(sanitized).toBeDefined();
      const times = RATE_LIMIT_DEFAULTS[limit] + 5;
      const fromApp = await admitted(
        { ...sanitized!, enabled: true },
        method,
        times
      );
      const bare = await admitted({ enabled: true }, method, times);
      expect(fromApp).toBe(RATE_LIMIT_DEFAULTS[limit]);
      expect(bare).toBe(fromApp);
    }
  );
});
