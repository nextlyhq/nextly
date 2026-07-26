/**
 * Process-level webhook recording activation: the audit seam and the
 * synchronously-read, out-of-band-refreshed endpoint-presence flag.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  endpointsPresent,
  isWebhookAuditEnabled,
  refreshEndpointPresence,
  resetWebhookActivation,
  setActivationClock,
  setEndpointPresenceRefresher,
  setWebhookAuditEnabled,
  shouldRecordEvent,
} from "../recording-activation";

afterEach(() => resetWebhookActivation());

const flush = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 0));

describe("shouldRecordEvent", () => {
  it("never records when the collection opted out, regardless of endpoints/audit", () => {
    expect(
      shouldRecordEvent({
        collectionAllows: false,
        auditEnabled: true,
        hasEndpoints: true,
      })
    ).toBe(false);
  });
  it("records when an endpoint exists", () => {
    expect(
      shouldRecordEvent({
        collectionAllows: true,
        auditEnabled: false,
        hasEndpoints: true,
      })
    ).toBe(true);
  });
  it("records when audit is on even with no endpoints", () => {
    expect(
      shouldRecordEvent({
        collectionAllows: true,
        auditEnabled: true,
        hasEndpoints: false,
      })
    ).toBe(true);
  });
  it("skips when allowed but no endpoints and audit off", () => {
    expect(
      shouldRecordEvent({
        collectionAllows: true,
        auditEnabled: false,
        hasEndpoints: false,
      })
    ).toBe(false);
  });
});

describe("audit flag", () => {
  it("defaults to false", () => {
    expect(isWebhookAuditEnabled()).toBe(false);
  });
  it("is settable and reset clears it", () => {
    setWebhookAuditEnabled(true);
    expect(isWebhookAuditEnabled()).toBe(true);
    resetWebhookActivation();
    expect(isWebhookAuditEnabled()).toBe(false);
  });
});

describe("endpoint presence flag", () => {
  it("fails open before it is primed", () => {
    expect(endpointsPresent()).toBe(true);
  });

  it("reflects the refresher after a refresh", async () => {
    const refresher = vi.fn().mockResolvedValue(false);
    setEndpointPresenceRefresher(refresher);
    await refreshEndpointPresence();
    expect(endpointsPresent()).toBe(false);

    refresher.mockResolvedValue(true);
    await refreshEndpointPresence();
    expect(endpointsPresent()).toBe(true);
  });

  it("keeps a known-positive value when a refresh throws (a blip must not disable delivery)", async () => {
    const refresher = vi.fn().mockResolvedValue(true);
    setEndpointPresenceRefresher(refresher);
    await refreshEndpointPresence();

    refresher.mockRejectedValue(new Error("db down"));
    await refreshEndpointPresence();
    expect(endpointsPresent()).toBe(true);
  });

  it("drops a cached negative to fail-open when its refresh fails", async () => {
    const refresher = vi.fn().mockResolvedValue(false);
    setEndpointPresenceRefresher(refresher);
    await refreshEndpointPresence();
    expect(endpointsPresent()).toBe(false);

    // A cross-process endpoint create whose presence re-read fails must not keep
    // dropping events on a stale `false`; the unknown state fails open.
    refresher.mockRejectedValue(new Error("db down"));
    await refreshEndpointPresence();
    expect(endpointsPresent()).toBe(true);
  });

  it("coalesces a refresh requested while one is in flight", async () => {
    const resolvers: Array<(v: boolean) => void> = [];
    const refresher = vi.fn(
      () => new Promise<boolean>(res => resolvers.push(res))
    );
    setEndpointPresenceRefresher(refresher);

    const first = refreshEndpointPresence();
    // Requested during the in-flight refresh (e.g. endpoint CRUD): must not be
    // discarded, so the active refresh runs once more afterward.
    const second = refreshEndpointPresence();
    expect(refresher).toHaveBeenCalledTimes(1);

    resolvers[0](false);
    await flush();
    expect(refresher).toHaveBeenCalledTimes(2);

    resolvers[1](true);
    await first;
    await second;
    expect(endpointsPresent()).toBe(true);
  });

  it("serves the last value synchronously and schedules a background refresh when stale", async () => {
    let clock = 1000;
    setActivationClock(() => clock);
    const refresher = vi.fn().mockResolvedValue(true);
    setEndpointPresenceRefresher(refresher);
    await refreshEndpointPresence();
    expect(refresher).toHaveBeenCalledTimes(1);

    // The endpoint set changed but the flag is now stale (past the TTL).
    refresher.mockResolvedValue(false);
    clock = 1000 + 30_001;

    // The stale read returns the last known value with no await, and schedules
    // a background reload that lands on the next tick.
    expect(endpointsPresent()).toBe(true);
    await flush();
    expect(refresher).toHaveBeenCalledTimes(2);
    expect(endpointsPresent()).toBe(false);
  });
});
