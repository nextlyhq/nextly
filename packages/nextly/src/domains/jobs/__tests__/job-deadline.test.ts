/**
 * A handler is told how long the tick is.
 *
 * `run-jobs` names two things that bound a RUNNING handler — the lease, and
 * "the handler itself being written to fit a tick" — and until now it told the
 * handler nothing about how long a tick is. Every handler that wanted to comply
 * had to be handed a budget out of band, which is a second description of a
 * number the runner already holds.
 */

import { describe, expect, it } from "vitest";

import { JobRegistry, defineJob, type JobContext } from "../job-registry";
import type { JobRow } from "../jobs-repository";
import { runJobs, type JobsStore } from "../run-jobs";

const NOW = new Date("2026-08-29T12:00:00.000Z");

function row(id: string): JobRow {
  return {
    id,
    slug: "test:capture",
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

/**
 * A content API that refuses to be called — these cases do not exercise content
 * operations, and a silent no-op would let one start using it without saying so.
 */
const noContentApi = new Proxy({} as never, {
  get: (_t, name) => () => {
    throw new Error(
      `content.${String(name)} called by a test that does not stub it`
    );
  },
});

/** Runs a pass and returns the contexts every handler invocation received. */
async function contextsFrom(
  ids: string[],
  maxDurationMs: number
): Promise<JobContext[]> {
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
    store: store(ids.map(row)),
    registry,
    runAs: {
      findUser: async () => ({ id: "u1", isActive: true }),
      listRoleSlugs: async () => ["editor"],
    },
    now: () => NOW,
    maxDurationMs,
    contentApi: noContentApi,
  });

  return seen;
}

describe("the deadline a handler is given", () => {
  it("reaches the handler on its context", async () => {
    const [context] = await contextsFrom(["a"], 20_000);

    expect(context?.deadline).toBeInstanceOf(Date);
  });

  it("is the pass's start plus its budget, not an arbitrary instant", async () => {
    // Asserted against the two inputs that produce it rather than a copied
    // constant: an expectation restating the number would keep passing after
    // the runner started computing a different one.
    const [context] = await contextsFrom(["a"], 20_000);

    expect(context?.deadline.getTime()).toBe(NOW.getTime() + 20_000);
  });

  it("moves when the budget moves", async () => {
    const [context] = await contextsFrom(["a"], 5_000);

    expect(context?.deadline.getTime()).toBe(NOW.getTime() + 5_000);
  });

  it("is the SAME instant for every job in one pass", async () => {
    // One pass, one deadline. A fresh budget per job would be a promise the
    // runner cannot keep — the invocation dies at one instant whatever a later
    // job was told, and a job starting late genuinely has less room.
    const contexts = await contextsFrom(["a", "b", "c"], 20_000);

    expect(contexts).toHaveLength(3);
    const instants = new Set(contexts.map(c => c.deadline.getTime()));
    expect(instants.size).toBe(1);
  });
});
