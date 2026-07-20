import { describe, it, expect } from "vitest";

import {
  classifyResponse,
  decideDelivery,
  nextAttemptDelayMs,
  DEFAULT_MAX_ATTEMPTS,
} from "../delivery-policy";

describe("classifyResponse", () => {
  it("treats 2xx as delivered", () => {
    for (const s of [200, 201, 202, 204, 299]) {
      expect(classifyResponse(s)).toBe("delivered");
    }
  });

  it("treats 429 and 5xx as retry (transient)", () => {
    for (const s of [429, 500, 502, 503, 504]) {
      expect(classifyResponse(s)).toBe("retry");
    }
  });

  it("treats other 4xx and a not-followed 3xx as failed (permanent)", () => {
    for (const s of [301, 302, 400, 401, 403, 404, 410, 422]) {
      expect(classifyResponse(s)).toBe("failed");
    }
  });
});

describe("nextAttemptDelayMs", () => {
  it("grows exponentially with the attempt count (upper edge via random=~1)", () => {
    const random = () => 0.999999;
    const base = 1000;
    const d1 = nextAttemptDelayMs(1, { baseMs: base, random });
    const d2 = nextAttemptDelayMs(2, { baseMs: base, random });
    const d3 = nextAttemptDelayMs(3, { baseMs: base, random });
    // window is base * 2^(n-1): ~1000, ~2000, ~4000.
    expect(d1).toBeLessThan(1000);
    expect(d2).toBeGreaterThanOrEqual(1000);
    expect(d2).toBeLessThan(2000);
    expect(d3).toBeGreaterThanOrEqual(2000);
    expect(d3).toBeLessThan(4000);
  });

  it("caps the window", () => {
    const delay = nextAttemptDelayMs(30, {
      baseMs: 1000,
      capMs: 5000,
      random: () => 0.999999,
    });
    expect(delay).toBeLessThan(5000);
  });

  it("applies full jitter: 0 with random=0", () => {
    expect(nextAttemptDelayMs(5, { random: () => 0 })).toBe(0);
  });
});

describe("decideDelivery", () => {
  const backoff = { random: () => 0.5, baseMs: 1000 };

  it("returns delivered for a delivered outcome", () => {
    expect(decideDelivery({ outcome: "delivered", attemptCount: 1 })).toEqual({
      status: "delivered",
    });
  });

  it("returns failed for a permanent outcome with the reason", () => {
    expect(
      decideDelivery({ outcome: "failed", attemptCount: 1, reason: "HTTP 404" })
    ).toEqual({ status: "failed", reason: "HTTP 404" });
  });

  it("retries a transient outcome under the attempt limit", () => {
    const decision = decideDelivery({
      outcome: "retry",
      attemptCount: 2,
      backoff,
    });
    expect(decision.status).toBe("retrying");
    if (decision.status === "retrying") {
      expect(decision.delayMs).toBeGreaterThan(0);
    }
  });

  it("marks a transient outcome failed once the attempt limit is reached", () => {
    const decision = decideDelivery({
      outcome: "retry",
      attemptCount: DEFAULT_MAX_ATTEMPTS,
      backoff,
    });
    expect(decision.status).toBe("failed");
    if (decision.status === "failed") {
      expect(decision.reason).toContain("exhausted");
    }
  });
});
