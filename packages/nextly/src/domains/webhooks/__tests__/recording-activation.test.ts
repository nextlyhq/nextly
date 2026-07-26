/**
 * Process-level webhook recording activation: the audit seam, the fail-open
 * endpoint-presence resolver, and the pure gate predicate.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  endpointsPresent,
  isWebhookAuditEnabled,
  resetWebhookActivation,
  setEndpointPresenceProvider,
  setWebhookAuditEnabled,
  shouldRecordEvent,
} from "../recording-activation";

afterEach(() => resetWebhookActivation());

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

describe("endpointsPresent (fail-open)", () => {
  it("returns true when no provider is set", async () => {
    expect(await endpointsPresent()).toBe(true);
  });
  it("returns true when the provider throws", async () => {
    setEndpointPresenceProvider(() => Promise.reject(new Error("db down")));
    expect(await endpointsPresent()).toBe(true);
  });
  it("returns the provider's answer when it resolves", async () => {
    const provider = vi.fn().mockResolvedValue(false);
    setEndpointPresenceProvider(provider);
    expect(await endpointsPresent()).toBe(false);
    provider.mockResolvedValue(true);
    expect(await endpointsPresent()).toBe(true);
  });
});
