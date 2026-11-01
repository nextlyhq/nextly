/**
 * The job that finishes a media delete: it finishes the items it was queued
 * with, and is tried again while any of them is still due.
 */
import { describe, expect, it, vi } from "vitest";

import type { JobContext } from "../../jobs/job-registry";
import {
  createMediaFinalizeDeletesJob,
  MEDIA_FINALIZE_DELETES_JOB,
} from "../finalize-deletes-job";
import type { PendingMediaDeletes } from "../pending-delete";

const NOW = new Date("2026-11-01T10:00:00.000Z");

function context(): JobContext {
  return {
    jobId: "job-1",
    attempt: 1,
    user: null,
    now: NOW,
    content: {} as JobContext["content"],
    deadline: new Date(NOW.getTime() + 30_000),
  };
}

function pending(left: string[]) {
  const deletes = {
    finalizeMarked: vi.fn(async (ids: readonly string[]) => [...ids]),
    dueAmong: vi.fn(async () => left),
  };
  const build = vi.fn(async (_now: Date) => {
    return deletes as unknown as PendingMediaDeletes;
  });
  return { deletes, build };
}

describe("createMediaFinalizeDeletesJob", () => {
  it("is a core job, retried more than once", () => {
    const job = createMediaFinalizeDeletesJob(pending([]).build);
    expect(job.slug).toBe(MEDIA_FINALIZE_DELETES_JOB);
    expect(job.slug.startsWith("nextly:")).toBe(true);
    expect(job.retry.maxAttempts).toBeGreaterThan(1);
  });

  it("finishes the items it was queued with, judged at the run's own instant", async () => {
    const { deletes, build } = pending([]);
    const job = createMediaFinalizeDeletesJob(build);

    await job.handler({ ids: ["a", "b"] }, context());

    expect(build).toHaveBeenCalledWith(NOW);
    expect(deletes.finalizeMarked).toHaveBeenCalledWith(["a", "b"]);
    expect(deletes.dueAmong).toHaveBeenCalledWith(["a", "b"]);
  });

  it("fails the attempt while an item is still due, so the queue tries again", async () => {
    const { build } = pending(["b"]);
    const job = createMediaFinalizeDeletesJob(build);

    await expect(job.handler({ ids: ["a", "b"] }, context())).rejects.toThrow();
  });

  it("finishes nothing for an input that names no items", async () => {
    const { deletes, build } = pending([]);
    const job = createMediaFinalizeDeletesJob(build);

    await job.handler({ other: 1 } as never, context());

    expect(build).not.toHaveBeenCalled();
    expect(deletes.finalizeMarked).not.toHaveBeenCalled();
  });
});
