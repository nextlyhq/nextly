/**
 * `nextly.jobs.queue` — the queue facade.
 *
 * These assert what reaches the REPOSITORY, because that is the whole job of a
 * facade: every field a caller omits still has to arrive as something the
 * storage layer can store, and `undefined` is not that something.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueue = vi.fn(async (_row: Record<string, unknown>) => ({
  id: "job-1",
  deduped: false,
}));
let registered = true;

vi.mock("../../../di/container", () => ({
  container: {
    has: () => registered,
    get: () => ({ enqueue }),
  },
}));

const { createJobsNamespace } = await import("../jobs");

/** The single argument the facade handed the repository. */
function enqueued(): Record<string, unknown> {
  const [row] = enqueue.mock.calls[0] ?? [];
  expect(row, "the facade never reached the repository").toBeDefined();
  return row as Record<string, unknown>;
}

beforeEach(() => {
  enqueue.mockClear();
  registered = true;
});

describe("nextly.jobs.queue", () => {
  it("queues under the task's slug", async () => {
    await createJobsNamespace().queue({
      task: "email:welcome",
      input: { userId: "u1" },
    });

    expect(enqueued().slug).toBe("email:welcome");
    expect(enqueued().input).toEqual({ userId: "u1" });
  });

  it("returns the row id and whether it deduped", async () => {
    enqueue.mockResolvedValueOnce({ id: "existing", deduped: true });

    const result = await createJobsNamespace().queue({
      task: "t",
      input: null,
      dedupeKey: "k",
    });

    // `deduped` is the only way a caller can tell "queued" from "already
    // queued"; dropping it would make an idempotent enqueue indistinguishable
    // from a fresh one.
    expect(result).toEqual({ id: "existing", deduped: true });
  });

  it("turns every omitted option into an explicit null", async () => {
    // The storage layer's contract is `X | null`, never `undefined`. A facade
    // that passed the absence through would ask the adapter to interpret a
    // missing field, and the three dialects need not agree on what that means.
    await createJobsNamespace().queue({ task: "t", input: null });

    const row = enqueued();
    expect(row.runAt).toBeNull();
    expect(row.runAsUserId).toBeNull();
    expect(row.dedupeKey).toBeNull();
  });

  it("passes a supplied runAt and runAs through", async () => {
    const runAt = new Date("2026-09-01T03:00:00.000Z");

    await createJobsNamespace().queue({
      task: "t",
      input: null,
      runAt,
      runAs: "u9",
    });

    expect(enqueued().runAt).toBe(runAt);
    // `runAs` is the id the runner reconstructs an identity from; the queue
    // stores it as `runAsUserId`, and the rename is this facade's job.
    expect(enqueued().runAsUserId).toBe("u9");
  });

  it("refuses an empty task slug rather than storing an unrunnable row", async () => {
    // `defineJob` trims and refuses a blank slug; `enqueue` used to check only
    // the MAXIMUM length. The gap did not produce a rejected write, it produced
    // an accepted one — a row whose slug no registry lookup can match, deferred
    // by every drain forever while looking pending.
    const { JobsRepository } = await import(
      "../../../domains/jobs/jobs-repository"
    );
    const repo = new JobsRepository({} as never);

    await expect(
      repo.enqueue({
        slug: "   ",
        input: null,
        runAt: null,
        runAsUserId: null,
        dedupeKey: null,
        now: new Date(),
      })
    ).rejects.toThrow(/non-empty slug/);
  });

  it("refuses rather than silently dropping work before the runtime is up", async () => {
    // A queue call that resolved without a row would be the worst outcome: the
    // caller believes the work is scheduled and nothing ever runs it.
    registered = false;

    await expect(
      createJobsNamespace().queue({ task: "t", input: null })
    ).rejects.toThrow();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
