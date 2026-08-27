/**
 * Disabling the PUBLIC limiter must not disarm the one in front of credentials.
 *
 * `rateLimit` carries two unrelated things: whether the REST limiter runs, and
 * where the window lives. The second is read by the AUTH limiter too, so
 * dropping the whole block when a user disables the first takes the credential
 * limiter's shared store with it — silently, and only on the deployments that
 * need it.
 */
import { describe, expect, it } from "vitest";

import type {
  RateLimitRecord,
  RateLimitStore,
} from "../../../middleware/rate-limit";
import { sanitizeConfig } from "../config";

const store: RateLimitStore = {
  increment(): Promise<RateLimitRecord> {
    return Promise.resolve({ count: 1, resetTime: 0 });
  },
  reset(): Promise<void> {
    return Promise.resolve();
  },
};

describe("sanitized rate-limit config", () => {
  it("keeps the store when the REST limiter is switched off", async () => {
    const sanitized = await sanitizeConfig({
      rateLimit: { enabled: false, store },
    } as Parameters<typeof sanitizeConfig>[0]);

    expect(sanitized.rateLimit?.store).toBe(store);
  });

  it("reports that the REST limiter is off, rather than omitting the block", async () => {
    // The block's ABSENCE used to be the only signal, and `routeHandler`
    // defaults `enabled: true` when it spreads nothing — so an omitted block
    // meant limiting stayed ON despite the user disabling it.
    const sanitized = await sanitizeConfig({
      rateLimit: { enabled: false, store },
    } as Parameters<typeof sanitizeConfig>[0]);

    expect(sanitized.rateLimit).toBeDefined();
    expect(sanitized.rateLimit?.enabled).toBe(false);
  });

  it("still reports enabled when nothing is configured", async () => {
    // The control. Without it, both assertions above would hold just as well
    // if `enabled` were hardcoded `false`, which would disable rate limiting
    // for every deployment that never mentioned it.
    const sanitized = await sanitizeConfig(
      {} as Parameters<typeof sanitizeConfig>[0]
    );

    expect(sanitized.rateLimit?.enabled).toBe(true);
    expect(sanitized.rateLimit?.store).toBeUndefined();
  });
});
