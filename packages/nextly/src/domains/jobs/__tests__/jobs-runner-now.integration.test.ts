/**
 * Running one job, or one sweep, now — against a REAL database.
 *
 * `runJobNow` and `runSweepNow` are another trigger for the runner, not a
 * second runner: the row is claimed under the same lease a pass takes, so a
 * job another runner holds is never run beside it. That exclusion is the
 * database's (the claim's row lock and its lease columns), which is why these
 * cases run against one rather than a fake store.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { JobRegistry, defineJob } from "../job-registry";
import { JobsRepository } from "../jobs-repository";
import { runJobNow, runSweepNow, sweepDedupeKey } from "../jobs-runner";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "posts",
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

const NOW = new Date("2026-01-01T00:00:00.000Z");
const LEASE_MS = 30_000;
const TASK = "test:task";
const SWEEP = "test:sweep";

/** A registry whose handlers record the row each run was handed. */
function recordingRegistry(): { registry: JobRegistry; ran: string[] } {
  const ran: string[] = [];
  const registry = new JobRegistry();
  registry.register(
    defineJob({
      slug: TASK,
      handler: async (_input, context) => {
        ran.push(context.jobId);
      },
    })
  );
  registry.register(
    defineJob({
      slug: SWEEP,
      sweep: true,
      handler: async (_input, context) => {
        ran.push(context.jobId);
      },
    })
  );
  return { registry, ran };
}

function enqueueTask(
  repo: JobsRepository,
  runAt: Date | null = null
): Promise<{ id: string }> {
  return repo.enqueue({
    slug: TASK,
    input: {},
    runAt,
    runAsUserId: null,
    dedupeKey: null,
    now: NOW,
  });
}

/** The sweep's row as a pass would queue it: under its one dedupe key. */
function enqueueSweep(repo: JobsRepository): Promise<{ id: string }> {
  return repo.enqueue({
    slug: SWEEP,
    input: null,
    runAt: null,
    runAsUserId: null,
    dedupeKey: sweepDedupeKey(SWEEP),
    now: NOW,
  });
}

describe.each(getConfiguredTestDialects())("runJobNow (%s)", dialect => {
  it("runs the named job and leaves every other due job alone", async () => {
    const app = await boot(dialect);
    const repo = new JobsRepository(app.adapter);
    const { registry, ran } = recordingRegistry();
    const named = await enqueueTask(repo);
    const other = await enqueueTask(repo);

    const result = await runJobNow(app.adapter, registry, named.id, {
      now: () => NOW,
    });

    expect(result).toMatchObject({ claimed: 1, done: 1 });
    expect(ran).toEqual([named.id]);
    // Still due, untouched: running one job now is not a pass over the queue.
    const due = await repo.findDue({ now: NOW, limit: 10 });
    expect(due.map(job => job.id)).toEqual([other.id]);
  });

  it("claims nothing while another runner holds the job, and runs it once the lease lapses", async () => {
    const app = await boot(dialect);
    const repo = new JobsRepository(app.adapter);
    const { registry, ran } = recordingRegistry();
    const { id } = await enqueueTask(repo);
    expect(await repo.claim(id, "another-runner", NOW, LEASE_MS)).not.toBe(
      null
    );

    const held = await runJobNow(app.adapter, registry, id, {
      now: () => NOW,
    });
    expect(held.claimed).toBe(0);
    expect(ran).toEqual([]);

    // The control: the same row IS runnable once that lease has lapsed, so
    // the refusal above was the lease and not a row this could never run.
    const later = new Date(NOW.getTime() + 2 * LEASE_MS);
    const lapsed = await runJobNow(app.adapter, registry, id, {
      now: () => later,
    });
    expect(lapsed).toMatchObject({ claimed: 1, done: 1 });
    expect(ran).toEqual([id]);
  });

  it("claims nothing for a job that is not due yet", async () => {
    const app = await boot(dialect);
    const repo = new JobsRepository(app.adapter);
    const { registry, ran } = recordingRegistry();
    const runAt = new Date(NOW.getTime() + 60_000);
    const { id } = await enqueueTask(repo, runAt);

    const early = await runJobNow(app.adapter, registry, id, {
      now: () => NOW,
    });
    expect(early.claimed).toBe(0);
    expect(ran).toEqual([]);

    // The control, at its time: then it runs.
    const onTime = await runJobNow(app.adapter, registry, id, {
      now: () => runAt,
    });
    expect(onTime).toMatchObject({ claimed: 1, done: 1 });
  });
});

describe.each(getConfiguredTestDialects())("runSweepNow (%s)", dialect => {
  it("queues the sweep when none is outstanding, and runs it", async () => {
    const app = await boot(dialect);
    const repo = new JobsRepository(app.adapter);
    const { registry, ran } = recordingRegistry();

    const result = await runSweepNow(app.adapter, registry, SWEEP, {
      now: () => NOW,
    });

    expect(result).toMatchObject({ claimed: 1, done: 1 });
    const rows = await repo.listRecent({ limit: 10, slug: SWEEP });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("done");
    expect(ran).toEqual([rows[0]?.id]);
  });

  it("runs the sweep row already outstanding rather than queueing a second", async () => {
    const app = await boot(dialect);
    const repo = new JobsRepository(app.adapter);
    const { registry, ran } = recordingRegistry();
    const outstanding = await enqueueSweep(repo);

    const result = await runSweepNow(app.adapter, registry, SWEEP, {
      now: () => NOW,
    });

    expect(result).toMatchObject({ claimed: 1, done: 1 });
    expect(ran).toEqual([outstanding.id]);
    expect(await repo.listRecent({ limit: 10, slug: SWEEP })).toHaveLength(1);
  });

  it("runs nothing while another runner holds the sweep", async () => {
    // What makes a sweep run on demand safe beside a scheduled pass: the two
    // contend for ONE row, and the loser runs nothing rather than a copy.
    const app = await boot(dialect);
    const repo = new JobsRepository(app.adapter);
    const { registry, ran } = recordingRegistry();
    const outstanding = await enqueueSweep(repo);
    await repo.claim(outstanding.id, "another-runner", NOW, LEASE_MS);

    const result = await runSweepNow(app.adapter, registry, SWEEP, {
      now: () => NOW,
    });

    expect(result.claimed).toBe(0);
    expect(ran).toEqual([]);
    const rows = await repo.listRecent({ limit: 10, slug: SWEEP });
    expect(rows.map(row => row.id)).toEqual([outstanding.id]);
    expect(rows[0]?.state).toBe("pending");
  });
});
