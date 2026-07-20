/**
 * Retention policy resolution.
 *
 * The resolver is pure and total: it never throws, and it clamps rather than
 * rejecting, so a malformed value degrades to something safe instead of failing
 * a boot.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUDIT_EVENTS_MAX_AGE_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_DELIVERIES_MAX_AGE_MS,
  DEFAULT_EVENTS_MAX_AGE_MS,
  resolveWebhookRetentionConfig,
  windowForClass,
} from "../retention-config";

describe("resolveWebhookRetentionConfig", () => {
  it("enables retention at defaults when nothing is configured", () => {
    // The row is written on every content write whether or not the user asked
    // for webhooks, so an unconfigured install must not grow without bound.
    const policy = resolveWebhookRetentionConfig(undefined);
    expect(policy).not.toBeNull();
    expect(policy?.eventsMaxAgeMs).toBe(DEFAULT_EVENTS_MAX_AGE_MS);
    expect(policy?.auditEventsMaxAgeMs).toBe(DEFAULT_AUDIT_EVENTS_MAX_AGE_MS);
    expect(policy?.deliveriesMaxAgeMs).toBe(DEFAULT_DELIVERIES_MAX_AGE_MS);
    expect(policy?.batchSize).toBe(DEFAULT_BATCH_SIZE);
  });

  it("disables retention wholesale on `false`", () => {
    expect(resolveWebhookRetentionConfig(false)).toBeNull();
  });

  it("keeps a class forever when its window is `false`", () => {
    const policy = resolveWebhookRetentionConfig({ eventsMaxAgeMs: false });
    expect(policy?.eventsMaxAgeMs).toBe(false);
    // The other class keeps its own window.
    expect(policy?.auditEventsMaxAgeMs).toBe(DEFAULT_AUDIT_EVENTS_MAX_AGE_MS);
  });

  it("clamps the delivery window to the longest event window", () => {
    // Deliveries cascade from their event, so a longer delivery window is not
    // merely unhelpful — it cannot be honoured, and storing it would be a lie.
    const policy = resolveWebhookRetentionConfig({
      eventsMaxAgeMs: 1_000,
      auditEventsMaxAgeMs: 5_000,
      deliveriesMaxAgeMs: 60_000,
    });
    expect(policy?.deliveriesMaxAgeMs).toBe(5_000);
  });

  it("leaves the delivery window alone when events are kept forever", () => {
    const policy = resolveWebhookRetentionConfig({
      eventsMaxAgeMs: false,
      auditEventsMaxAgeMs: false,
      deliveriesMaxAgeMs: 60_000,
    });
    expect(policy?.deliveriesMaxAgeMs).toBe(60_000);
  });

  it("falls back to defaults for malformed values instead of throwing", () => {
    const policy = resolveWebhookRetentionConfig({
      eventsMaxAgeMs: Number.NaN,
      batchSize: -5,
      maxBatchesPerRun: 0,
      intervalMs: Number.POSITIVE_INFINITY,
    });
    expect(policy?.eventsMaxAgeMs).toBe(DEFAULT_EVENTS_MAX_AGE_MS);
    expect(policy?.batchSize).toBe(DEFAULT_BATCH_SIZE);
    expect(policy?.maxBatchesPerRun).toBeGreaterThan(0);
    expect(policy?.intervalMs).toBeGreaterThan(0);
  });

  it("routes each class to its own window", () => {
    const policy = resolveWebhookRetentionConfig({
      eventsMaxAgeMs: 10,
      auditEventsMaxAgeMs: 20,
    });
    expect(windowForClass(policy!, "webhook")).toBe(10);
    expect(windowForClass(policy!, "audit")).toBe(20);
  });
});
