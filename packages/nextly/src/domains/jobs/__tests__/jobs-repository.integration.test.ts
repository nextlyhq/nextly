/**
 * The job store against a REAL database.
 *
 * Three things only an integration test can establish, all of them about
 * behaviour the database owns rather than the code.
 *
 * First, that the table exists at all: it reaches a database through six
 * separate registries, and a miss in any one of them still leaves every unit
 * test passing. Booting a real instance and writing to it is what proves the
 * wiring.
 *
 * Second, that duplicate suppression is a CONSTRAINT. `enqueue` deliberately
 * does not read-then-write — two writers can interleave between the read and
 * the write and both be told they won, which is a defect already filed against
 * the Direct API. The rule is only real if the second INSERT is refused, and
 * only a real index refuses it.
 *
 * Third, that the lease actually excludes. A claim that looks exclusive in a
 * unit test with a mocked transaction proves nothing about two runners racing
 * on a real one.
 *
 * Runs against whichever dialect the integration run configures; CI covers
 * SQLite, Postgres and MySQL.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { JobsRepository } from "../jobs-repository";

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
        status: true,
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

const NOW = new Date("2026-01-01T00:00:00.000Z");

describe.each(getConfiguredTestDialects())("JobsRepository (%s)", dialect => {
  it("stores a job and reads it back as due", async () => {
    const app = await boot(dialect);
    const repo = new JobsRepository(app.adapter);

    const { id, deduped } = await repo.enqueue({
      slug: "test:noop",
      input: { hello: "world" },
      runAt: null,
      runAsUserId: null,
      dedupeKey: null,
      now: NOW,
    });

    expect(deduped).toBe(false);
    const due = await repo.findDue({ now: NOW, limit: 10 });
    expect(due.map(j => j.id)).toEqual([id]);
    expect(due[0]!.slug).toBe("test:noop");
  });

  it("does not report a job whose runAt is still in the future", async () => {
    const app = await boot(dialect);
    const repo = new JobsRepository(app.adapter);
    await repo.enqueue({
      slug: "test:later",
      input: {},
      runAt: new Date(NOW.getTime() + 60_000),
      runAsUserId: null,
      dedupeKey: null,
      now: NOW,
    });
    expect(await repo.findDue({ now: NOW, limit: 10 })).toEqual([]);
  });

  it("refuses a duplicate dedupe key AT THE DATABASE, and returns the row that won", async () => {
    const app = await boot(dialect);
    const repo = new JobsRepository(app.adapter);

    const first = await repo.enqueue({
      slug: "releases:apply",
      input: { releaseId: "r1" },
      runAt: null,
      runAsUserId: null,
      dedupeKey: "release:r1",
      now: NOW,
    });
    const second = await repo.enqueue({
      slug: "releases:apply",
      input: { releaseId: "r1" },
      runAt: null,
      runAsUserId: null,
      dedupeKey: "release:r1",
      now: NOW,
    });

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    // The SAME row, not a second one that happens to look alike.
    expect(second.id).toBe(first.id);
    expect(await repo.findDue({ now: NOW, limit: 10 })).toHaveLength(1);
  });

  it("still admits many jobs that name NO dedupe key", async () => {
    // The other half of the nullable-unique rule, and the reason it must be
    // asserted separately: making `dedupe_key` NOT NULL would make the test
    // above pass and silently collapse every un-deduplicated job into one.
    const app = await boot(dialect);
    const repo = new JobsRepository(app.adapter);
    for (const n of [1, 2, 3]) {
      await repo.enqueue({
        slug: `test:${n}`,
        input: {},
        runAt: null,
        runAsUserId: null,
        dedupeKey: null,
        now: NOW,
      });
    }
    expect(await repo.findDue({ now: NOW, limit: 10 })).toHaveLength(3);
  });

  it("lets only ONE of two concurrent runners claim a job", async () => {
    const app = await boot(dialect);
    const repo = new JobsRepository(app.adapter);
    const { id } = await repo.enqueue({
      slug: "test:noop",
      input: {},
      runAt: null,
      runAsUserId: null,
      dedupeKey: null,
      now: NOW,
    });

    const [a, b] = await Promise.all([
      repo.claim(id, "runner-a", NOW, 30_000),
      repo.claim(id, "runner-b", NOW, 30_000),
    ]);

    expect([a, b].filter(row => row !== null)).toHaveLength(1);
  });

  it("refuses to record an outcome once the lease has been reclaimed", async () => {
    // The fence. Runner A is slow, its lease expires, runner B takes the job
    // over. A must NOT be able to write its stale outcome across B's work.
    const app = await boot(dialect);
    const repo = new JobsRepository(app.adapter);
    const { id } = await repo.enqueue({
      slug: "test:noop",
      input: {},
      runAt: null,
      runAsUserId: null,
      dedupeKey: null,
      now: NOW,
    });

    const claimed = await repo.claim(id, "runner-a", NOW, 1);
    expect(claimed).not.toBeNull();

    const later = new Date(NOW.getTime() + 10_000);
    const reclaimed = await repo.claim(id, "runner-b", later, 30_000);
    expect(reclaimed).not.toBeNull();

    const wrote = await repo.finalize({
      id,
      runnerId: "runner-a",
      outcome: "done",
      nextAttemptAt: null,
      lastError: null,
      now: later,
    });
    expect(wrote).toBe(false);

    // And the row still belongs to B, not to A's stale "done".
    const stillHeld = await repo.findDue({ now: later, limit: 10 });
    expect(stillHeld).toEqual([]);
  });

  it("lets the CURRENT lease holder record its outcome", async () => {
    // The positive control for the fence above: if `finalize` returned false
    // for everyone, the previous test would pass while the runner could never
    // record anything at all.
    const app = await boot(dialect);
    const repo = new JobsRepository(app.adapter);
    const { id } = await repo.enqueue({
      slug: "test:noop",
      input: {},
      runAt: null,
      runAsUserId: null,
      dedupeKey: null,
      now: NOW,
    });
    await repo.claim(id, "runner-a", NOW, 30_000);

    const wrote = await repo.finalize({
      id,
      runnerId: "runner-a",
      outcome: "done",
      nextAttemptAt: null,
      lastError: null,
      now: NOW,
    });
    expect(wrote).toBe(true);
  });
});
