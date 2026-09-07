import { describe, expect, it, vi } from "vitest";

import { DOCUMENT_LOCK_SWEEP_JOB, createDocumentLockSweepJob } from "..";

describe("the document-lock sweep job", () => {
  it("is declared as a sweep, or nothing would ever enqueue it", () => {
    // A claim lapses at an instant with no request attached, and the editor
    // whose claim it was has by definition stopped asking. Registered without
    // this the handler exists and never runs, which looks exactly like a table
    // with nothing to clean up.
    const job = createDocumentLockSweepJob({
      service: { sweepExpired: vi.fn() } as never,
    });

    expect(job.sweep).toBe(true);
    expect(job.slug).toBe(DOCUMENT_LOCK_SWEEP_JOB);
  });

  it("sweeps when it runs", () => {
    const sweepExpired = vi.fn().mockResolvedValue(undefined);
    const job = createDocumentLockSweepJob({
      service: { sweepExpired } as never,
    });

    void job.handler(null as never, {} as never);

    expect(sweepExpired).toHaveBeenCalledTimes(1);
  });
});
