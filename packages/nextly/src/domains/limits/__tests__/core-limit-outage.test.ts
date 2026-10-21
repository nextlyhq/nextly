import { afterEach, describe, expect, it, vi } from "vitest";

import type { RateLimitStore } from "../../../middleware/rate-limit";
import { setNextlyLogger } from "../../../observability/logger";
import { withRateLimitStoreDeadline } from "../call-deadline";
import {
  isLimitStoreDown,
  openWhileStoreIsDown,
  signInLimitUnavailable,
  watchCoreLimitOutage,
} from "../core-limit-outage";
import { limitStoreUnavailable } from "../limit-store";

/**
 * What core's own limits do while their store cannot answer: the general
 * limit lets requests through, the outage is logged once each way, and an
 * app's own store is held to the same time as the selected one.
 */

const logged = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
setNextlyLogger(logged as never);

afterEach(() => {
  vi.clearAllMocks();
});

/** A store that answers, or fails as unavailable, as `state.down` says. */
function switchable() {
  const state = { down: false };
  const store: RateLimitStore = {
    increment: async (_key, windowMs) => {
      if (state.down) throw limitStoreUnavailable("unreachable");
      return { count: 1, resetTime: Date.now() + windowMs };
    },
    reset: async () => {
      if (state.down) throw limitStoreUnavailable("unreachable");
    },
    consume: async (_key, limit, windowMs) => {
      if (state.down) throw limitStoreUnavailable("unreachable");
      return { count: 1, resetTime: Date.now() + windowMs, allowed: limit > 0 };
    },
  };
  return { state, store };
}

describe("watchCoreLimitOutage", () => {
  it("logs the outage once when it begins and once when the store answers again", async () => {
    const { state, store } = switchable();
    const watched = watchCoreLimitOutage(store);

    state.down = true;
    for (let i = 0; i < 3; i += 1) {
      await expect(watched.consume!("k", 3, 1000)).rejects.toSatisfy(
        isLimitStoreDown
      );
    }
    expect(logged.error).toHaveBeenCalledTimes(1);
    expect(logged.error.mock.calls[0][0]).toMatchObject({
      kind: "core-limit-store-unavailable",
    });

    state.down = false;
    await watched.consume!("k", 3, 1000);
    await watched.consume!("k", 3, 1000);
    expect(logged.info).toHaveBeenCalledTimes(1);
    expect(logged.info.mock.calls[0][0]).toMatchObject({
      kind: "core-limit-store-recovered",
    });

    // A second outage is logged again.
    state.down = true;
    await expect(watched.increment("k", 1000)).rejects.toSatisfy(
      isLimitStoreDown
    );
    expect(logged.error).toHaveBeenCalledTimes(2);
  });

  it("logs nothing for a failure that is not the store being away", async () => {
    const store: RateLimitStore = {
      increment: () => Promise.reject(new Error("a bug")),
      reset: () => Promise.resolve(),
    };
    await expect(
      watchCoreLimitOutage(store).increment("k", 1000)
    ).rejects.toThrow("a bug");
    expect(logged.error).not.toHaveBeenCalled();
  });
});

describe("openWhileStoreIsDown", () => {
  it("lets a request through while the store is away", async () => {
    const { state, store } = switchable();
    state.down = true;
    const open = openWhileStoreIsDown(store);

    expect((await open.consume!("k", 3, 1000)).allowed).toBe(true);
    expect((await open.increment("k", 1000)).count).toBe(0);
  });

  it("counts as usual once the store answers", async () => {
    const { store } = switchable();
    expect((await openWhileStoreIsDown(store).increment("k", 1000)).count).toBe(
      1
    );
  });

  it("passes on a failure that is not the store being away", async () => {
    const store: RateLimitStore = {
      increment: () => Promise.reject(new Error("a bug")),
      reset: () => Promise.resolve(),
    };
    await expect(
      openWhileStoreIsDown(store).increment("k", 1000)
    ).rejects.toThrow("a bug");
  });
});

describe("withRateLimitStoreDeadline", () => {
  it("answers a call an app's store never answers as unavailable, within the time", async () => {
    const hanging: RateLimitStore = {
      increment: () => new Promise(() => {}),
      reset: () => new Promise(() => {}),
      consume: () => new Promise(() => {}),
    };
    const started = Date.now();
    await expect(
      withRateLimitStoreDeadline(hanging, 50).consume!("k", 3, 1000)
    ).rejects.toSatisfy(isLimitStoreDown);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("answers an app's store's own failure as unavailable", async () => {
    const failing: RateLimitStore = {
      increment: () => Promise.reject(new Error("ECONNREFUSED")),
      reset: () => Promise.resolve(),
    };
    await expect(
      withRateLimitStoreDeadline(failing).increment("k", 1000)
    ).rejects.toSatisfy(isLimitStoreDown);
  });

  it("keeps a store without consume without one", () => {
    const plain: RateLimitStore = {
      increment: async () => ({ count: 1, resetTime: 0 }),
      reset: async () => {},
    };
    expect(withRateLimitStoreDeadline(plain).consume).toBeUndefined();
  });
});

describe("signInLimitUnavailable", () => {
  it("is a service-unavailable answer telling the caller to try again shortly", () => {
    const refusal = signInLimitUnavailable(limitStoreUnavailable("timeout"));
    expect(refusal.code).toBe("SERVICE_UNAVAILABLE");
    expect(refusal.publicMessage).toBe("Please try again shortly.");
  });
});
