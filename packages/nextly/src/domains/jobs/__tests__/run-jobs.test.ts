/**
 * One drain pass: what it runs, what it defers, and what it refuses.
 *
 * Driven against a fake store rather than a database. What is under test here
 * is the DECISION sequence — claim, establish identity, run, record — and the
 * repository's own guarantees (the lease, the fence, the unique index) are
 * proved against a real database in `jobs-repository.integration.test.ts`.
 *
 * @module domains/jobs/__tests__/run-jobs.test
 */
import { describe, expect, it, vi } from "vitest";

import type { JobRow } from "../jobs-repository";
import { JobRegistry, defineJob } from "../job-registry";
import type { RunAsDeps } from "../resolve-run-as";
import { runJobs, type JobsStore } from "../run-jobs";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function row(over: Partial<JobRow> = {}): JobRow {
  return {
    id: "j1",
    slug: "test:noop",
    input: { n: 1 },
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

/** A store that hands out each row once, so a pass cannot loop forever. */
function store(rows: JobRow[]): JobsStore & { finalized: unknown[] } {
  let handed = false;
  const finalized: unknown[] = [];
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

const runAs = (over: Partial<RunAsDeps> = {}): RunAsDeps => ({
  findUser: async () => ({ id: "u1", isActive: true }),
  listRoleSlugs: async () => ["editor"],
  ...over,
});

function registryWith(...defs: ReturnType<typeof defineJob>[]): JobRegistry {
  const registry = new JobRegistry();
  for (const d of defs) registry.register(d);
  return registry;
}

describe("runJobs", () => {
  it("runs a due job and records it done", async () => {
    const handler = vi.fn(async () => {});
    const s = store([row()]);
    const result = await runJobs({
      store: s,
      registry: registryWith(defineJob({ slug: "test:noop", handler })),
      runAs: runAs(),
      now: () => NOW,
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      claimed: 1,
      done: 1,
      failed: 0,
      retried: 0,
    });
    expect(s.finalized).toEqual([expect.objectContaining({ outcome: "done" })]);
  });

  it("hands the handler the RESOLVED identity, roles included", async () => {
    // The reason resolve-run-as exists at all: the handler must act as the
    // person, so the context it receives has to be the full one.
    let seen: unknown;
    const s = store([row({ runAsUserId: "u1" })]);
    await runJobs({
      store: s,
      registry: registryWith(
        defineJob({
          slug: "test:noop",
          handler: async (_input, ctx) => {
            seen = ctx.user;
          },
        })
      ),
      runAs: runAs(),
      now: () => NOW,
    });
    expect(seen).toEqual({ id: "u1", roles: ["editor"] });
  });

  it("fails a job whose identity is gone TERMINALLY, never retrying it", async () => {
    // Retrying cannot help — a deleted user does not come back next pass — and
    // retrying would also keep an unrunnable row cycling forever.
    const handler = vi.fn(async () => {});
    const s = store([row({ runAsUserId: "ghost" })]);
    const result = await runJobs({
      store: s,
      registry: registryWith(defineJob({ slug: "test:noop", handler })),
      runAs: runAs({ findUser: async () => null }),
      now: () => NOW,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1, retried: 0 });
    expect(s.finalized).toEqual([
      expect.objectContaining({
        outcome: "failed",
        lastError: "JOB_IDENTITY_UNRESOLVABLE",
      }),
    ]);
  });

  it("retries a handler that throws while its budget lasts", async () => {
    const s = store([row({ attemptCount: 0 })]);
    const result = await runJobs({
      store: s,
      registry: registryWith(
        defineJob({
          slug: "test:noop",
          handler: async () => {
            throw new Error("receiver down");
          },
          retry: { maxAttempts: 3 },
        })
      ),
      runAs: runAs(),
      now: () => NOW,
    });
    expect(result).toMatchObject({ retried: 1, failed: 0 });
    expect(s.finalized[0]).toMatchObject({ outcome: "retry" });
  });

  it("fails a handler that throws once its budget is spent", async () => {
    // The control for the case above: an implementation that always retried
    // would satisfy it while never giving up on anything.
    const s = store([row({ attemptCount: 2 })]);
    const result = await runJobs({
      store: s,
      registry: registryWith(
        defineJob({
          slug: "test:noop",
          handler: async () => {
            throw new Error("still down");
          },
          retry: { maxAttempts: 3 },
        })
      ),
      runAs: runAs(),
      now: () => NOW,
    });
    expect(result).toMatchObject({ failed: 1, retried: 0 });
  });

  it("records a row whose job type no longer exists instead of skipping it", async () => {
    // A slug deleted from the code while rows were still queued. Skipping it
    // silently means the row is passed over on every drain forever, and a queue
    // that never drains looks exactly like an empty one. Treated as a normal
    // failure so a temporary deploy skew recovers on a later pass, while a
    // genuinely deleted type gives up when its budget runs out and says why.
    const s = store([row({ slug: "gone:type", attemptCount: 0 })]);
    const result = await runJobs({
      store: s,
      registry: registryWith(
        defineJob({ slug: "test:noop", handler: async () => {} })
      ),
      runAs: runAs(),
      now: () => NOW,
    });
    expect(result.claimed).toBe(1);
    expect(s.finalized[0]).toMatchObject({
      lastError: expect.stringContaining("gone:type"),
    });
  });

  it("does not count a job another runner claimed first", async () => {
    const s: JobsStore & { finalized: unknown[] } = {
      ...store([row()]),
      claim: async () => null,
    };
    const result = await runJobs({
      store: s,
      registry: registryWith(
        defineJob({ slug: "test:noop", handler: async () => {} })
      ),
      runAs: runAs(),
      now: () => NOW,
    });
    expect(result).toMatchObject({ claimed: 0, done: 0 });
  });

  it("stops claiming once the wall-clock budget is spent", async () => {
    // A serverless cron tick is killed by its platform at a fixed limit. The
    // pass has to return before that on its own; the rows it did not reach are
    // durable and the next tick continues.
    let clock = NOW.getTime();
    const rows = Array.from({ length: 50 }, (_, i) => row({ id: `j${i}` }));
    const s = store(rows);
    const result = await runJobs({
      store: s,
      registry: registryWith(
        defineJob({
          slug: "test:noop",
          handler: async () => {
            clock += 10_000;
          },
        })
      ),
      runAs: runAs(),
      now: () => new Date(clock),
      maxDurationMs: 25_000,
    });
    expect(result.claimed).toBeGreaterThan(0);
    expect(result.claimed).toBeLessThan(50);
  });
});
