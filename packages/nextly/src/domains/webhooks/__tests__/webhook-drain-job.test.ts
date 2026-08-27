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
import type { FinalizeInput, JobRow } from "../../jobs/jobs-repository";
import { runJobs, type JobsStore } from "../../jobs/run-jobs";
import type { DeliverTx } from "../deliver";
import type {
  WebhookDrainDatabase,
  WebhookDrainRegistry,
} from "../drain-runner";
import type { FanOutTx } from "../fan-out";
import { WEBHOOK_DRAIN_JOB, createWebhookDrainJob } from "../webhook-drain-job";

/**
 * The transaction context the drain's database surface hands its callback.
 *
 * `WebhookDrainDatabase` is `FanOutDatabase & DeliverDatabase`, so its
 * `transaction` is an INTERSECTION of two call signatures whose contexts differ
 * — fan-out needs `insertMany`, delivery does not. A fake satisfying only one
 * of them is what the previous `as any` was hiding: the cast made a fake that
 * cannot stand in for the real dependency compile as though it could.
 */
type WebhookDrainTx = FanOutTx & DeliverTx;

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

function store(rows: JobRow[]): JobsStore & { finalized: FinalizeInput[] } {
  let handed = false;
  const finalized: FinalizeInput[] = [];
  return {
    finalized,
    findDue: async () => {
      if (handed) return [];
      handed = true;
      return rows;
    },
    claim: async id => rows.find(r => r.id === id) ?? null,
    markAttempt: async () => true,
    renewLease: async () => true,
    finalize: async input => {
      finalized.push(input);
      return true;
    },
  };
}

/**
 * A drain that records that it ran, standing in for the real engine.
 *
 * `satisfies` rather than a cast. This fake stands at the boundary of the
 * production wiring, and a cast removes the structural check that makes it
 * stand there: a dependency the drain gains, or one misspelled here, would keep
 * compiling against the fake while the real call site broke.
 */
const fakeAdapter = () => {
  const empty = async (): Promise<never[]> => [];
  const tx: WebhookDrainTx = {
    select: empty,
    update: empty,
    insertMany: empty,
  };
  const transaction: WebhookDrainDatabase["transaction"] = <T>(
    fn: (ctx: never) => Promise<T>
  ): Promise<T> => fn(tx as never);
  return {
    select: vi.fn(empty),
    update: vi.fn(empty),
    // Not wrapped in vi.fn: `transaction` is an intersection of two call
    // signatures, and Mock<A & B> is not assignable to A & B. Nothing asserts
    // on it — the drain having reached the database is observed through
    // `select` — so wrapping it would cost the type check and buy nothing.
    transaction,
  } satisfies WebhookDrainDatabase;
};

const fakeRegistry = () =>
  ({
    getEnabledEndpointsFresh: vi.fn(async () => []),
  }) satisfies WebhookDrainRegistry;

/**
 * A content API that refuses to be called.
 *
 * These cases do not exercise content operations, and a silent no-op would let
 * one start using it without saying so — the assertion would then pass against
 * a handler whose reads returned nothing.
 */
const noContentApi = new Proxy({} as never, {
  get: (_target, name) => () => {
    throw new Error(
      `content.${String(name)} called by a test that does not stub it`
    );
  },
});

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

  it("IS retryable, so a transient failure does not strand the outbox", () => {
    // Repeating a sweep is safe: deliverDueDeliveries selects only due
    // pending/retrying rows whose lease is free, so a completed delivery is
    // already excluded and a deferred one stays deferred. A single attempt
    // meant a brief database outage failed the job terminally and left the
    // remaining outbox work to whenever some other trigger happened to fire.
    expect(
      createWebhookDrainJob(fakeAdapter(), fakeRegistry()).retry.maxAttempts
    ).toBeGreaterThan(1);
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
      contentApi: noContentApi,
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
      contentApi: noContentApi,
      now: () => NOW,
    });

    expect(sawUser).toBeNull();
    expect(result).toMatchObject({ done: 1, failed: 0 });
  });
});
