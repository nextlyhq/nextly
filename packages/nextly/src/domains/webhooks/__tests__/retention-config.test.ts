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
  MAX_BATCH_SIZE,
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

  it("carries keep-forever from the webhook window into the audit window", () => {
    // The two windows were independent while nothing recorded an audit-class
    // row. They cannot be now: a row admitted by BOTH the audit seam and an
    // endpoint is labelled `audit`, so an audit window shorter than the webhook
    // one prunes it earlier than the webhook setting allows — irreversibly, and
    // in a supported configuration. The label promises the longest retention the
    // row needs, so resolution has to make that true rather than assume it.
    //
    // The cost is over-retention for a row that is audit-only, which is the safe
    // direction to be wrong in for an audit trail. Telling the two apart would
    // need the row to record that it was dual-purpose, which it does not.
    const policy = resolveWebhookRetentionConfig({ eventsMaxAgeMs: false });
    expect(policy?.eventsMaxAgeMs).toBe(false);
    expect(policy?.auditEventsMaxAgeMs).toBe(false);
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

  it("honours an explicit keep-forever for deliveries", () => {
    // `false` is a request, not a bound to be normalised away. Rewriting it to
    // the event window would prune attempt logs the user asked to keep.
    const policy = resolveWebhookRetentionConfig({
      eventsMaxAgeMs: 1_000,
      auditEventsMaxAgeMs: 5_000,
      deliveriesMaxAgeMs: false,
    });
    expect(policy?.deliveriesMaxAgeMs).toBe(false);
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

  it("reads an infinite window as keeping everything", () => {
    // An operator writing `Infinity` has spelled "keep forever" the strongest
    // way the type allows, and this used to fall back to a default that DELETES
    // after 30 days. Nothing in this file covered it, which is how it shipped.
    const policy = resolveWebhookRetentionConfig({
      eventsMaxAgeMs: Number.POSITIVE_INFINITY,
      auditEventsMaxAgeMs: Number.POSITIVE_INFINITY,
      deliveriesMaxAgeMs: Number.POSITIVE_INFINITY,
    });
    expect(policy?.eventsMaxAgeMs).toBe(false);
    expect(policy?.auditEventsMaxAgeMs).toBe(false);
    expect(policy?.deliveriesMaxAgeMs).toBe(false);
  });

  it("clamps a window past the storable range instead of producing a bad cutoff", () => {
    // This resolver had no upper bound at all, so `MAX_SAFE_INTEGER` resolved
    // to roughly 285,000 years and the cutoff derived from it was a date no
    // column can hold — a pass that fails every run and is swallowed, leaving
    // the ledger unpruned while the configuration reads as accepted.
    const policy = resolveWebhookRetentionConfig({
      eventsMaxAgeMs: Number.MAX_SAFE_INTEGER,
    });
    expect(policy?.eventsMaxAgeMs).toBe(false);
  });

  it("still lets an operator ask to keep nothing", () => {
    // Zero is a real position for a delivery ledger, and it must survive the
    // move to the shared resolver: the row exists to make a redelivery
    // possible, so an operator who does not want addresses stored at all is
    // deciding rather than mistyping.
    const policy = resolveWebhookRetentionConfig({ deliveriesMaxAgeMs: 0 });
    expect(policy?.deliveriesMaxAgeMs).toBe(0);
  });

  it("clamps an oversized batch to the portable bind-parameter limit", () => {
    // Above this a pass exceeds SQLite's parameter cap and fails every time,
    // and the safe runner swallows it, so retention would stop making progress
    // with nothing visible to explain why.
    const policy = resolveWebhookRetentionConfig({ batchSize: 100_000 });
    expect(policy?.batchSize).toBe(MAX_BATCH_SIZE);
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

/**
 * The class a row carries is decided from why it was recorded, but the windows
 * are configured independently — so an audit window shorter than the webhook
 * one would prune a dual-purpose row earlier than the webhook setting allows.
 * The class promises the LONGEST retention the row needs, so the resolved audit
 * window can never be the shorter of the two.
 */
describe("audit window never undercuts the webhook window", () => {
  it("keeps audit rows forever when webhook rows are kept forever", () => {
    const policy = resolveWebhookRetentionConfig({
      eventsMaxAgeMs: false,
      auditEventsMaxAgeMs: 90 * 24 * 60 * 60 * 1000,
    });

    expect(policy?.auditEventsMaxAgeMs).toBe(false);
  });

  it("raises a shorter audit window to the webhook window", () => {
    const twoHundredDays = 200 * 24 * 60 * 60 * 1000;
    const policy = resolveWebhookRetentionConfig({
      eventsMaxAgeMs: twoHundredDays,
      auditEventsMaxAgeMs: 90 * 24 * 60 * 60 * 1000,
    });

    expect(policy?.auditEventsMaxAgeMs).toBe(twoHundredDays);
  });

  it("leaves a longer audit window alone", () => {
    const policy = resolveWebhookRetentionConfig({
      eventsMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
      auditEventsMaxAgeMs: 90 * 24 * 60 * 60 * 1000,
    });

    expect(policy?.auditEventsMaxAgeMs).toBe(90 * 24 * 60 * 60 * 1000);
  });
});
