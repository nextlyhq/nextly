import { describe, expect, it } from "vitest";

import { deriveLeaseTimings } from "../lease-timings";

describe("lease timings", () => {
  it("derives every timing from the TTL", () => {
    // The migration lock's shipped values, which this must reproduce exactly.
    expect(deriveLeaseTimings(120, 8)).toEqual({
      ttlSeconds: 120,
      renewIntervalMs: 15_000,
      lossAfterMs: 90_000,
      renewMarginSeconds: 90,
    });
  });

  it("leaves two renewal intervals of lease in hand at the loss deadline", () => {
    // 🔴 The property, not the arithmetic. A holder must be told it is losing the claim while it is
    // still protected; a deadline that landed ON expiry would tell it afterwards.
    for (const [ttl, divisor] of [
      [120, 8],
      [150, 10],
      [300, 30],
    ] as const) {
      const t = deriveLeaseTimings(ttl, divisor);
      expect(
        t.ttlSeconds * 1000 - t.lossAfterMs,
        `ttl=${ttl} divisor=${divisor}`
      ).toBe(2 * t.renewIntervalMs);
      expect(
        t.lossAfterMs,
        `ttl=${ttl} is protected at its deadline`
      ).toBeLessThan(t.ttlSeconds * 1000);
    }
  });

  it("keeps the margin and the loss deadline in the same units", () => {
    // These are read by different callers — one compares milliseconds, one writes a SQL interval in
    // seconds — and a mismatch here is a lease that looks renewed and is not.
    const t = deriveLeaseTimings(150, 10);
    expect(t.renewMarginSeconds * 1000).toBe(t.lossAfterMs);
  });
});
