/**
 * Webhook delivery running on the shared job runner.
 *
 * The point of this suite is not that the drain works — 23 files already prove
 * that. It is that routing it through the runner does not CHANGE it: the same
 * drain, invoked the same way, with the runner supplying the claim and the
 * bookkeeping around it.
 *
 * @module domains/webhooks/__tests__/webhook-drain-job.test
 */
import { describe, expect, it, vi } from "vitest";

import { JobRegistry } from "../../jobs/job-registry";
import type { JobRow } from "../../jobs/jobs-repository";
import { runJobs, type JobsStore } from "../../jobs/run-jobs";
import { WEBHOOK_DRAIN_JOB, createWebhookDrainJob } from "../webhook-drain-job";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function jobRow(over: Partial<JobRow> = {}): JobRow {
  return {
    id: "drain-1",
    slug: WEBHOOK_DRAIN_JOB,
    input: null,
    state: "pending",
    runAt: null,
    runAsUserId: null,
    dedupeKey: null,
    attemptCount: 0,
    nextAttemptAt: null,
    lockedBy: null,
    lockedUntil: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function store(rows: JobRow[]): JobsStore & { finalized: any[] } {
  let handed = false;
  const finalized: any[] = [];
  return {
    finalized,
    findDue: async () => {
      if (handed) return [];
      handed = true;
      return rows;
    },
    claim: async id => rows.find(r => r.id === id) ?? null,
    markAttempt: async () => {},
    finalize: async input => {
      finalized.push(input);
      return true;
    },
  };
}

/** A drain that records that it ran, standing in for the real engine. */
const fakeAdapter = () =>
  ({
    select: vi.fn(async () => []),
    update: vi.fn(async () => []),
    transaction: vi.fn(async (fn: any) =>
      fn({ select: async () => [], update: async () => [] })
    ),
  }) as any;

const fakeRegistry = () =>
  ({ getEnabledEndpointsFresh: vi.fn(async () => []) }) as any;

describe("the webhook drain as a job", () => {
  it("registers under a stable slug", () => {
    // The slug is stored in every queued row. Renaming it orphans every row
    // already in the table, which the runner would then report as an unknown
    // job type — recoverable, but only because nothing is silently skipped.
    expect(WEBHOOK_DRAIN_JOB).toBe("webhooks:drain");
    expect(createWebhookDrainJob(fakeAdapter(), fakeRegistry()).slug).toBe(
      "webhooks:drain"
    );
  });

  it("does NOT retry the pass — the outbox rows carry their own retry state", () => {
    // A drain is a sweep, not a unit of work. Re-running the sweep would
    // re-attempt deliveries that already recorded an outcome and restart their
    // backoff from the wrong clock.
    expect(
      createWebhookDrainJob(fakeAdapter(), fakeRegistry()).retry.maxAttempts
    ).toBe(1);
  });

  it("runs the drain when the runner claims its row, and records it done", async () => {
    const registry = new JobRegistry();
    const adapter = fakeAdapter();
    registry.register(createWebhookDrainJob(adapter, fakeRegistry()));

    const s = store([jobRow()]);
    const result = await runJobs({
      store: s,
      registry,
      runAs: { findUser: async () => null, listRoleSlugs: async () => [] },
      now: () => NOW,
    });

    expect(result).toMatchObject({ claimed: 1, done: 1, failed: 0 });
    // The drain actually reached the database rather than the job merely being
    // marked done — the assertion that distinguishes "ran" from "recorded".
    expect(adapter.select).toHaveBeenCalled();
  });

  it("runs as NOBODY, and that is not the same as running as the system", async () => {
    // Webhook delivery reads nothing access-controlled, so it is one of the
    // few jobs legitimately queued with no identity. It must therefore reach
    // the handler rather than being refused — the identity rule refuses a
    // MISSING user, not an ABSENT one.
    let sawUser: unknown = "unset";
    const registry = new JobRegistry();
    const adapter = fakeAdapter();
    const job = createWebhookDrainJob(adapter, fakeRegistry());
    registry.register({
      ...job,
      handler: async (input, ctx) => {
        sawUser = ctx.user;
        await job.handler(input, ctx);
      },
    });

    const result = await runJobs({
      store: store([jobRow({ runAsUserId: null })]),
      registry,
      // A resolver that would REFUSE any id, proving the null path is distinct.
      runAs: { findUser: async () => null, listRoleSlugs: async () => [] },
      now: () => NOW,
    });

    expect(sawUser).toBeNull();
    expect(result).toMatchObject({ done: 1, failed: 0 });
  });
});
