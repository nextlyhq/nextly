/**
 * Resolving the configured retention windows.
 *
 * A window that is neither a positive finite number nor `false` has to read as
 * unset. `Infinity` is the case that matters: it is a positive number, so it
 * passes a naive check, then yields an Invalid Date cutoff that the pass
 * swallows as a failure — retention that looks configured and silently never
 * runs, which is the same shape as having no retention at all.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ACTIVITY_MAX_AGE_MS,
  DEFAULT_AUDIT_MAX_BATCHES_PER_RUN,
  DEFAULT_AUDIT_RETENTION_INTERVAL_MS,
  DEFAULT_AUTH_MAX_AGE_MS,
  resolveAuditRetentionConfig,
} from "../retention-config";

describe("resolveAuditRetentionConfig", () => {
  it("falls back when a window is not a finite positive number", () => {
    for (const bad of [Infinity, -Infinity, NaN, 0, -1]) {
      const resolved = resolveAuditRetentionConfig({
        activityMaxAgeMs: bad,
        authMaxAgeMs: bad,
        intervalMs: bad,
      });
      expect(resolved.activityMaxAgeMs).toBe(DEFAULT_ACTIVITY_MAX_AGE_MS);
      expect(resolved.authMaxAgeMs).toBe(DEFAULT_AUTH_MAX_AGE_MS);
      expect(resolved.intervalMs).toBe(DEFAULT_AUDIT_RETENTION_INTERVAL_MS);
    }
  });

  it("keeps `false`, which is how keeping forever is expressed", () => {
    const resolved = resolveAuditRetentionConfig({
      activityMaxAgeMs: false,
      authMaxAgeMs: false,
    });
    expect(resolved.activityMaxAgeMs).toBe(false);
    expect(resolved.authMaxAgeMs).toBe(false);
  });

  it("resolves a batch count to a whole number of batches", () => {
    expect(
      resolveAuditRetentionConfig({ maxBatchesPerRun: 2.7 }).maxBatchesPerRun
    ).toBe(2);
    expect(
      resolveAuditRetentionConfig({ maxBatchesPerRun: 0.4 }).maxBatchesPerRun
    ).toBe(DEFAULT_AUDIT_MAX_BATCHES_PER_RUN);
    expect(
      resolveAuditRetentionConfig({ maxBatchesPerRun: Infinity })
        .maxBatchesPerRun
    ).toBe(DEFAULT_AUDIT_MAX_BATCHES_PER_RUN);
  });

  it("disables both windows when the block itself is false", () => {
    const resolved = resolveAuditRetentionConfig(false);
    expect(resolved.activityMaxAgeMs).toBe(false);
    expect(resolved.authMaxAgeMs).toBe(false);
  });
});
