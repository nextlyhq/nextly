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

import { buildUserContext } from "../../../auth/user-context";
import type { JobRow } from "../jobs-repository";
import { JobRegistry, defineJob } from "../job-registry";
import type { RunAsDeps } from "../../../shared/lib/resolve-run-as";
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
    markAttempt: async () => true,
    renewLease: async () => true,
    finalize: async input => {
      finalized.push(input);
      return true;
    },
  };
}

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
      contentApi: noContentApi,
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
      contentApi: noContentApi,
      now: () => NOW,
    });
    expect(seen).toEqual(
      buildUserContext({
        id: "u1",
        name: undefined,
        email: undefined,
        roles: ["editor"],
      })
    );
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
      contentApi: noContentApi,
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
      contentApi: noContentApi,
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
      contentApi: noContentApi,
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
      contentApi: noContentApi,
      now: () => NOW,
    });
    expect(result.claimed).toBe(1);
    expect(s.finalized[0]).toMatchObject({
      outcome: "retry",
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
      contentApi: noContentApi,
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
      contentApi: noContentApi,
      now: () => new Date(clock),
      maxDurationMs: 25_000,
    });
    expect(result.claimed).toBeGreaterThan(0);
    expect(result.claimed).toBeLessThan(50);
  });

  it("records a transient identity-lookup FAILURE as a retryable attempt, not as an aborted pass", async () => {
    // A failed lookup is not the same as a missing user. Letting it throw would
    // abort the whole drain after the row was claimed: the row keeps its lease
    // until expiry, the candidates behind it are never reached, and a
    // persistent lookup failure on an early row aborts every scheduled pass
    // rather than exhausting one job's budget.
    const s = store([row({ runAsUserId: "u1", attemptCount: 0 })]);
    const result = await runJobs({
      store: s,
      registry: registryWith(
        defineJob({ slug: "test:noop", handler: async () => {} })
      ),
      runAs: {
        findUser: async () => {
          throw new Error("rbac database unreachable");
        },
        listRoleSlugs: async () => [],
      },
      contentApi: noContentApi,
      now: () => NOW,
    });

    expect(result).toMatchObject({ retried: 1, failed: 0 });
    expect(s.finalized[0]).toMatchObject({
      outcome: "retry",
      lastError: expect.stringContaining("unreachable"),
    });
  });

  it("does not count an outcome the fence refused to record", async () => {
    // A lease reclaimed before finalization means the write did not land. It
    // must be reported as unrecorded and NOT also as done, or the same attempt
    // is counted twice and completed work is overstated.
    const s: JobsStore & { finalized: unknown[] } = {
      ...store([row()]),
      finalize: async () => false,
    };
    const result = await runJobs({
      store: s,
      registry: registryWith(
        defineJob({ slug: "test:noop", handler: async () => {} })
      ),
      runAs: runAs(),
      contentApi: noContentApi,
      now: () => NOW,
    });

    expect(result).toMatchObject({ claimed: 1, unrecorded: 1, done: 0 });
  });

  it("extends the lease while a handler is still working", async () => {
    // The lease is otherwise a wall-clock guess about how long the work takes,
    // and a handler that outruns it is reclaimed and run a second time
    // CONCURRENTLY. The fence refuses the stale runner's write but cannot undo
    // what it already did outside the database.
    const renewals: string[] = [];
    const s: JobsStore & { finalized: unknown[] } = {
      ...store([row()]),
      renewLease: async (_id, runnerId) => {
        renewals.push(runnerId);
        return true;
      },
    };

    await runJobs({
      store: s,
      registry: registryWith(
        defineJob({
          slug: "test:noop",
          handler: async () => {
            await new Promise(resolve => setTimeout(resolve, 40));
          },
        })
      ),
      runAs: runAs(),
      contentApi: noContentApi,
      now: () => NOW,
      runnerId: "runner-a",
      renewIntervalMs: 5,
    });

    expect(renewals.length).toBeGreaterThan(0);
    expect(renewals.every(r => r === "runner-a")).toBe(true);
  });

  it("stops renewing once the lease is no longer this runner's", async () => {
    // Continuing would issue writes that can never apply, against a job another
    // runner has already taken over.
    let calls = 0;
    const s: JobsStore & { finalized: unknown[] } = {
      ...store([row()]),
      renewLease: async () => {
        calls += 1;
        return false;
      },
    };

    await runJobs({
      store: s,
      registry: registryWith(
        defineJob({
          slug: "test:noop",
          handler: async () => {
            await new Promise(resolve => setTimeout(resolve, 60));
          },
        })
      ),
      runAs: runAs(),
      contentApi: noContentApi,
      now: () => NOW,
      renewIntervalMs: 5,
    });

    // One refusal is enough to stop it; without that check this would be ~12.
    expect(calls).toBeLessThanOrEqual(2);
  });

  it("refuses to start the handler when the lease lapsed while the identity was resolving", async () => {
    // `markAttempt` fences the row, but resolving the identity is two database
    // reads and renewal does not begin until the handler is already running.
    // A lease that expires in that window is claimed by a successor, and this
    // runner would otherwise wake up and do the work a second time — the fence
    // it passed describes a lease it no longer holds.
    const handler = vi.fn(async () => {});
    const s: JobsStore & { finalized: unknown[] } = {
      ...store([row({ runAsUserId: "u1" })]),
      // Refuse from the first call: the successor took the row during the
      // identity reads below.
      renewLease: async () => false,
    };

    const result = await runJobs({
      store: s,
      registry: registryWith(defineJob({ slug: "test:noop", handler })),
      runAs: runAs({
        listRoleSlugs: async () => {
          // Stand in for identity reads slow enough to outlive the lease.
          await new Promise(resolve => setTimeout(resolve, 5));
          return ["editor"];
        },
      }),
      contentApi: noContentApi,
      now: () => NOW,
    });

    expect(handler).not.toHaveBeenCalled();
    // Nothing is written either: the row belongs to whoever holds it now, and
    // a finalize from this runner would overwrite their outcome.
    expect(s.finalized).toEqual([]);
    expect(result).toMatchObject({ claimed: 1, done: 0 });
  });

  it("does not let a THROWN lease fence abort the rest of the drain", async () => {
    // The fence sits between the two failure boundaries in `runOne`, so a
    // transient adapter error there escaped `runJobs` entirely: the row stayed
    // leased and every later candidate in the batch was skipped. One unlucky
    // write would stop the whole drain.
    const handler = vi.fn(async () => {});
    const s: JobsStore & { finalized: unknown[] } = {
      ...store([row({ id: "j1" }), row({ id: "j2" })]),
      renewLease: async () => {
        throw new Error("adapter blew up");
      },
    };

    const result = await runJobs({
      store: s,
      registry: registryWith(defineJob({ slug: "test:noop", handler })),
      runAs: runAs(),
      contentApi: noContentApi,
      now: () => NOW,
    });

    // Both rows were claimed and both were RECORDED, rather than the pass
    // dying on the first one.
    expect(result.claimed).toBe(2);
    expect(s.finalized).toHaveLength(2);
    // Charged as an ordinary attempt, so the job comes back on its own backoff.
    expect(handler).not.toHaveBeenCalled();
    expect((s.finalized[0] as { lastError?: string }).lastError).toContain(
      "adapter blew up"
    );
  });

  it("hands the handler a content client already bound to the resolved user", async () => {
    // The identity is only real if it reaches the CALLS. The Direct API
    // defaults to overrideAccess: true, so a handler importing `nextly`
    // directly would run every scheduled operation with trusted-system
    // authority while the resolved user sat unused in its context.
    const find = vi.fn(async (_args: Record<string, unknown>) => ({
      items: [],
    }));
    await runJobs({
      store: store([row({ runAsUserId: "u1" })]),
      registry: registryWith(
        defineJob({
          slug: "test:noop",
          handler: async (_input, ctx) => {
            // No cast: the bound client carries the Direct API's own
            // signatures, so a handler calls it the way it calls `nextly`.
            await ctx.content.find({ collection: "posts" });
          },
        })
      ),
      runAs: runAs(),
      contentApi: { find } as never,
      now: () => NOW,
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        overrideAccess: false,
        user: buildUserContext({
          id: "u1",
          name: undefined,
          email: undefined,
          roles: ["editor"],
        }),
      })
    );
  });

  it("does NOT run the handler when the attempt fence says the lease is gone", async () => {
    // markAttempt is fenced on locked_by, so `false` means a successor took the
    // job between the claim and that write. Running the handler anyway would do
    // the work twice — and the finalize fence would refuse to record it either
    // way, so the second run would be invisible as well as duplicated.
    const handler = vi.fn(async () => {});
    const s: JobsStore & { finalized: unknown[] } = {
      ...store([row()]),
      markAttempt: async () => false,
    };

    const result = await runJobs({
      store: s,
      registry: registryWith(defineJob({ slug: "test:noop", handler })),
      runAs: runAs(),
      contentApi: noContentApi,
      now: () => NOW,
    });

    expect(handler).not.toHaveBeenCalled();
    expect(s.finalized).toEqual([]);
    expect(result).toMatchObject({ claimed: 1, unrecorded: 1, done: 0 });
  });

  it("does NOT charge an attempt for a slug this instance does not know", async () => {
    // A rolling deployment leaves old instances without a type the new ones
    // already enqueue. If that costs the job an attempt, the old workers can
    // exhaust its budget before a new one gets a turn — and the job fails
    // permanently for a reason that had already fixed itself.
    const marked: number[] = [];
    const s: JobsStore & { finalized: unknown[] } = {
      ...store([row({ slug: "gone:type", attemptCount: 0 })]),
      markAttempt: async (_id, _runner, attemptCount) => {
        marked.push(attemptCount);
        return true;
      },
    };

    await runJobs({
      store: s,
      registry: registryWith(
        defineJob({ slug: "test:noop", handler: async () => {} })
      ),
      runAs: runAs(),
      contentApi: noContentApi,
      now: () => NOW,
    });

    expect(marked).toEqual([]);
  });
});
