/**
 * A handler is told which job it is running, and how many times.
 *
 * Delivery is at-least-once, and the fence that protects the jobs table cannot
 * reach an email already sent. The documented remedy is an idempotent handler,
 * which needs a key that survives a retry, and the context carried none: a
 * handler could see its input and the clock and nothing that identified the
 * queued row. The advice had no mechanism behind it.
 */

import { describe, expect, it } from "vitest";

import { JobRegistry, defineJob, type JobContext } from "../job-registry";
import type { JobRow } from "../jobs-repository";
import { runJobs, type JobsStore } from "../run-jobs";

const NOW = new Date("2026-09-10T12:00:00.000Z");

function row(id: string, attemptCount = 0): JobRow {
  return {
    id,
    slug: "test:capture",
    input: null,
    state: "pending",
    runAt: null,
    runAsUserId: null,
    dedupeKey: null,
    attemptCount,
    nextAttemptAt: null,
    lockedBy: null,
    lockedUntil: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** Hands out each row once, so a pass cannot loop forever. */
function store(rows: JobRow[]): JobsStore {
  let handed = false;
  return {
    findDue: async () => {
      if (handed) return [];
      handed = true;
      return rows;
    },
    claim: async id => rows.find(r => r.id === id) ?? null,
    markAttempt: async () => true,
    renewLease: async () => true,
    finalize: async () => true,
  };
}

const noContentApi = new Proxy({} as never, {
  get: (_t, name) => () => {
    throw new Error(
      `content.${String(name)} called by a test that does not stub it`
    );
  },
});

async function contextsFrom(rows: JobRow[]): Promise<JobContext[]> {
  const seen: JobContext[] = [];

  const registry = new JobRegistry();
  registry.register(
    defineJob({
      slug: "test:capture",
      handler: async (_input, context) => {
        seen.push(context);
      },
    })
  );

  await runJobs({
    store: store(rows),
    registry,
    runAs: {
      findUser: async () => ({ id: "u1", isActive: true }),
      listRoleSlugs: async () => ["editor"],
    },
    now: () => NOW,
    maxDurationMs: 20_000,
    contentApi: noContentApi,
  });

  return seen;
}

describe("the idempotency key a handler is given", () => {
  it("is the id of the row this invocation is running", async () => {
    const [context] = await contextsFrom([row("job-a")]);

    expect(context?.jobId).toBe("job-a");
  });

  it("distinguishes the jobs in one pass", async () => {
    /*
     * The control. A key that is any single constant satisfies "a handler
     * receives a key" perfectly, and would de-duplicate two unrelated jobs into
     * one side effect: the failure mode is worse than having no key at all.
     */
    const contexts = await contextsFrom([row("job-a"), row("job-b")]);

    expect(contexts.map(c => c.jobId)).toEqual(["job-a", "job-b"]);
  });

  it("does not change when the job is attempted again", async () => {
    // The whole point. A key that varied per attempt would let the second run
    // through the provider that was meant to reject it.
    const [first] = await contextsFrom([row("job-a", 0)]);
    const [retry] = await contextsFrom([row("job-a", 3)]);

    expect(retry?.jobId).toBe(first?.jobId);
  });
});

describe("the attempt number a handler is given", () => {
  it("counts from 1 on a job that has never been attempted", async () => {
    // Not the raw stored count, which is 0 here. A handler asking "which
    // attempt is this" is asking about the run it is inside.
    const [context] = await contextsFrom([row("job-a", 0)]);

    expect(context?.attempt).toBe(1);
  });

  it("is one past the attempts already recorded", async () => {
    const [context] = await contextsFrom([row("job-a", 3)]);

    expect(context?.attempt).toBe(4);
  });

  it("is PERSISTED before the handler starts, not after it finishes", async () => {
    /*
     * 🔴 What makes `attempt` mean anything after a crash, and the reason the
     * documentation can say a handler that dies part-way still leaves the count
     * advanced. Recorded afterwards, a process that died mid-handler would
     * leave the row untouched and the next run would be numbered as if it were
     * the first, so a reader could not use it to tell a retry from a first run
     * at all.
     */
    const order: string[] = [];
    const rows = [row("job-a", 0)];
    let handed = false;
    const store: JobsStore = {
      findDue: async () => {
        if (handed) return [];
        handed = true;
        return rows;
      },
      claim: async id => rows.find(r => r.id === id) ?? null,
      markAttempt: async (_id, _runner, attemptCount) => {
        order.push(`markAttempt(${String(attemptCount)})`);
        return true;
      },
      renewLease: async () => true,
      finalize: async () => true,
    };

    const registry = new JobRegistry();
    registry.register(
      defineJob({
        slug: "test:capture",
        handler: async () => {
          order.push("handler");
        },
      })
    );

    await runJobs({
      store,
      registry,
      runAs: {
        findUser: async () => ({ id: "u1", isActive: true }),
        listRoleSlugs: async () => ["editor"],
      },
      now: () => NOW,
      maxDurationMs: 20_000,
      contentApi: noContentApi,
    });

    expect(order).toEqual(["markAttempt(1)", "handler"]);
  });
});
