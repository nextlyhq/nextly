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

import { pruneAuditDataSafely } from "../prune";
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

/**
 * The two trails have independent windows and independent budgets. Independent
 * failures are what make that real: one try around both meant a role holding
 * DELETE on one table and not the other lost retention on BOTH, every interval,
 * silently.
 */
describe("pruneAuditDataSafely", () => {
  it("prunes the auth trail when the activity trail fails", async () => {
    const adapter = {
      select: async <T>(table: string): Promise<T[]> => {
        if (table === "activity_log") {
          throw new Error("permission denied for table activity_log");
        }
        return [{ id: "a" }] as T[];
      },
      delete: async (): Promise<number> => 1,
    };

    const result = await pruneAuditDataSafely(
      { adapter },
      resolveAuditRetentionConfig(),
      1
    );

    expect(result.activity).toBe(0);
    expect(result.auth).toBe(1);
  });
});

/**
 * A budget bounds the work a pass does; a deadline bounds the time it takes,
 * and only the second is what a serverless invocation is killed for. The drain
 * makes a wall-clock promise to a cron route, so a pass it starts has to stop
 * within it rather than spending a full budget past it.
 */
describe("pruneAuditDataSafely — deadline", () => {
  it("stops between batches once the deadline passes", async () => {
    let reads = 0;
    const adapter = {
      select: async <T>(): Promise<T[]> => {
        reads += 1;
        // A full batch every time, so nothing but the deadline can end this.
        return Array.from({ length: 500 }, (_, i) => ({
          id: `r-${reads}-${i}`,
        })) as T[];
      },
      delete: async (): Promise<number> => 500,
    };

    // Time advances one minute per reading, so the deadline lands after the
    // first batch of each trail.
    let ticks = 0;
    const start = new Date("2026-08-04T00:00:00.000Z");
    const now = (): Date => new Date(start.getTime() + ticks++ * 60_000);

    const result = await pruneAuditDataSafely(
      { adapter, now, deadline: new Date(start.getTime() + 90_000) },
      resolveAuditRetentionConfig()
    );

    // Far short of the 20-batch budget each trail was allowed.
    expect(reads).toBeLessThan(6);
    expect(result.activity + result.auth).toBeGreaterThan(0);
  });
});
