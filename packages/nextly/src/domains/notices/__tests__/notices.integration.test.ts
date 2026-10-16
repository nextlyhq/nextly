/**
 * A person's own notices, against a real database on every dialect.
 *
 * What only a database can show: that a notice is stored once per occurrence
 * (the unique digest, and an insert that does not abort the caller's
 * transaction on a repeat — PostgreSQL aborts a transaction on a unique
 * violation), that a notice written inside a transaction goes with it, that
 * each person reads and marks only their own, and that a notice still reads
 * from its snapshot once its subject is gone.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  clearNoticeKindsForTests,
  defineNoticeKind,
  registerNoticeKind,
} from "../notice-kinds";
import { NoticesService } from "../notices-service";
import { pruneNoticesSafely } from "../prune";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  clearNoticeKindsForTests();
});

/** Subjects that still exist; a test deletes one by removing it here. */
let existing = new Set<string>();
/** People who may see the narrowed kind. */
let mayReadReleases = new Set<string>();

const stopped = defineNoticeKind({
  key: "test.stopped",
  subjectType: "release",
  data: z.object({ title: z.string() }),
  render: (data, { subjectGone }) => ({
    title: `“${data.title}” stopped`,
    body: subjectGone ? "The release has since been deleted." : undefined,
  }),
  link: async ids =>
    new Map(ids.filter(id => existing.has(id)).map(id => [id, `/r/${id}`])),
  visible: async userId => mayReadReleases.has(userId),
});

const plain = defineNoticeKind({
  key: "test.plain",
  subjectType: "thing",
  data: z.object({ n: z.number() }),
  render: data => ({ title: `Thing ${data.n}` }),
});

beforeEach(() => {
  existing = new Set(["r1", "r2"]);
  mayReadReleases = new Set(["alice", "bob"]);
  registerNoticeKind(stopped);
  registerNoticeKind(plain);
});

async function boot(dialect: TestDialect): Promise<NoticesService> {
  current = await createTestNextly({ dialect, collections: [] });
  return current.getService("noticesService") as NoticesService;
}

describe.each(getConfiguredTestDialects())("notices (%s)", dialect => {
  it("shows each person only their own notices", async () => {
    const notices = await boot(dialect);
    await notices.record({
      kind: stopped,
      userId: "alice",
      subjectId: "r1",
      occurrence: "1",
      data: { title: "Spring" },
    });
    await notices.record({
      kind: stopped,
      userId: "bob",
      subjectId: "r2",
      occurrence: "1",
      data: { title: "Autumn" },
    });

    const alice = await notices.find({ userId: "alice" });
    expect(alice.rows.map(n => n.title)).toEqual(["“Spring” stopped"]);
    expect(alice.total).toBe(1);
    expect(await notices.count({ userId: "bob", unread: true })).toBe(1);
    expect((await notices.find({ userId: "carol" })).rows).toEqual([]);
  });

  it("stores a notice once per occurrence, and again for a new one", async () => {
    const notices = await boot(dialect);
    const input = {
      kind: stopped,
      userId: "alice",
      subjectId: "r1",
      occurrence: "rev-3",
      data: { title: "Spring" },
    };

    const first = await notices.record(input);
    const repeat = await notices.record(input);
    // The repeat is not an error and reports that it created nothing, so a
    // caller sends an email for the first only.
    expect(first.created).toBe(true);
    expect(repeat.created).toBe(false);
    expect(repeat.id).toBe(first.id);
    expect(await notices.count({ userId: "alice" })).toBe(1);

    const next = await notices.record({ ...input, occurrence: "rev-7" });
    expect(next.created).toBe(true);
    expect(await notices.count({ userId: "alice" })).toBe(2);
  });

  it("records a repeat inside a transaction without breaking it", async () => {
    // On PostgreSQL a unique violation aborts the whole transaction, so a
    // repeated occurrence inside the change it reports must not raise one.
    const notices = await boot(dialect);
    const input = {
      kind: stopped,
      userId: "alice",
      subjectId: "r1",
      occurrence: "rev-3",
      data: { title: "Spring" },
    };
    await current!.adapter.transaction(async tx => {
      await notices.record(input, tx);
      const again = await notices.record(input, tx);
      expect(again.created).toBe(false);
      // The transaction is still usable after the repeat.
      await notices.record({ ...input, occurrence: "rev-4" }, tx);
    });
    expect(await notices.count({ userId: "alice" })).toBe(2);
  });

  it("goes with the transaction it was written in", async () => {
    const notices = await boot(dialect);
    await expect(
      current!.adapter.transaction(async tx => {
        await notices.record(
          {
            kind: stopped,
            userId: "alice",
            subjectId: "r1",
            occurrence: "1",
            data: { title: "Spring" },
          },
          tx
        );
        throw new Error("the change this notice reports failed");
      })
    ).rejects.toThrow("the change this notice reports failed");
    expect(await notices.count({ userId: "alice" })).toBe(0);
  });

  it("marks read only the caller's own notices", async () => {
    const notices = await boot(dialect);
    const mine = await notices.record({
      kind: plain,
      userId: "alice",
      subjectId: "t1",
      occurrence: "1",
      data: { n: 1 },
    });
    const theirs = await notices.record({
      kind: plain,
      userId: "bob",
      subjectId: "t1",
      occurrence: "1",
      data: { n: 1 },
    });

    // Bob's id in Alice's request is ignored, not reported.
    const marked = await notices.markRead({
      userId: "alice",
      ids: [mine.id!, theirs.id!],
    });
    expect(marked).toBe(1);
    expect(await notices.count({ userId: "alice", unread: true })).toBe(0);
    expect(await notices.count({ userId: "bob", unread: true })).toBe(1);

    await notices.record({
      kind: plain,
      userId: "alice",
      subjectId: "t2",
      occurrence: "1",
      data: { n: 2 },
    });
    expect(await notices.markRead({ userId: "alice", all: true })).toBe(1);
    // Marking again changes nothing: read stays read, at its first time.
    expect(await notices.markRead({ userId: "alice", all: true })).toBe(0);
  });

  it("reads from its snapshot once its subject is gone", async () => {
    const notices = await boot(dialect);
    await notices.record({
      kind: stopped,
      userId: "alice",
      subjectId: "r1",
      occurrence: "1",
      data: { title: "Spring" },
    });
    const before = await notices.find({ userId: "alice" });
    expect(before.rows[0]?.subject).toMatchObject({
      link: "/r/r1",
      gone: false,
    });

    existing.delete("r1");
    const after = await notices.find({ userId: "alice" });
    expect(after.rows[0]).toMatchObject({
      title: "“Spring” stopped",
      body: "The release has since been deleted.",
      subject: { id: "r1", link: null, gone: true },
    });
  });

  it("lets a kind narrow who sees it, in the count as well as the list", async () => {
    const notices = await boot(dialect);
    await notices.record({
      kind: stopped,
      userId: "alice",
      subjectId: "r1",
      occurrence: "1",
      data: { title: "Spring" },
    });
    await notices.record({
      kind: plain,
      userId: "alice",
      subjectId: "t1",
      occurrence: "1",
      data: { n: 1 },
    });
    mayReadReleases.delete("alice");

    const page = await notices.find({ userId: "alice" });
    expect(page.rows.map(n => n.kind)).toEqual(["test.plain"]);
    expect(page.total).toBe(1);
    expect(await notices.count({ userId: "alice" })).toBe(1);
  });

  it("lists newest first, a page at a time, with the true total", async () => {
    const notices = await boot(dialect);
    for (let n = 1; n <= 5; n += 1) {
      await notices.record({
        kind: plain,
        userId: "alice",
        subjectId: `t${n}`,
        occurrence: "1",
        data: { n },
      });
    }
    const page = await notices.find({ userId: "alice", page: 2, limit: 2 });
    expect(page.rows.map(n => n.title)).toEqual(["Thing 3", "Thing 2"]);
    expect(page.total).toBe(5);
  });

  it("refuses a kind nobody registered, and data its kind does not declare", async () => {
    const notices = await boot(dialect);
    const stray = defineNoticeKind({
      key: "test.stray",
      subjectType: "thing",
      data: z.object({}),
      render: () => ({ title: "stray" }),
    });
    await expect(
      notices.record({
        kind: stray,
        userId: "alice",
        subjectId: "t1",
        occurrence: "1",
        data: {},
      })
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    await expect(
      notices.record({
        kind: plain,
        userId: "alice",
        subjectId: "t1",
        occurrence: "1",
        // A JavaScript caller, past the type, with the wrong data.
        data: { n: "one" } as unknown as { n: number },
      })
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(await notices.count({ userId: "alice" })).toBe(0);
  });
  it("removes notices past the activity log's window, oldest first, and keeps the rest", async () => {
    const notices = await boot(dialect);
    for (const n of [1, 2]) {
      await notices.record({
        kind: plain,
        userId: "alice",
        subjectId: `t${n}`,
        occurrence: "1",
        data: { n },
      });
    }
    const day = 24 * 60 * 60 * 1000;
    // Ninety-one days on, with a ninety-day window, both are old enough.
    const later = () => new Date(Date.now() + 91 * day);
    expect(
      await pruneNoticesSafely(
        { db: current!.adapter as never, now: later },
        90 * day,
        5
      )
    ).toBe(2);
    expect(await notices.count({ userId: "alice" })).toBe(0);

    // The control: inside the window nothing goes.
    await notices.record({
      kind: plain,
      userId: "alice",
      subjectId: "t3",
      occurrence: "1",
      data: { n: 3 },
    });
    expect(
      await pruneNoticesSafely({ db: current!.adapter as never }, 90 * day, 5)
    ).toBe(0);
    expect(await notices.count({ userId: "alice" })).toBe(1);
  });

  it("deletes a person's notices with their account, and nobody else's", async () => {
    const notices = await boot(dialect);
    const created = (await current!.nextly.users.create({
      email: "leaving@example.com",
      password: "Str0ng!Passw0rd#2026",
      data: { name: "Leaving" },
    })) as unknown as { item?: { id?: string }; id?: string };
    const leaving = String(created.item?.id ?? created.id);
    for (const userId of [leaving, "alice"]) {
      await notices.record({
        kind: plain,
        userId,
        subjectId: "t1",
        occurrence: "1",
        data: { n: 1 },
      });
    }

    await current!.nextly.users.delete({ id: leaving });

    expect(await notices.count({ userId: leaving })).toBe(0);
    expect(await notices.count({ userId: "alice" })).toBe(1);
  });

  it("before `nextly migrate`, shows nothing and skips writes with a warning naming the fix", async () => {
    await boot(dialect);
    await current!.adapter.executeQuery(`DROP TABLE nextly_notices`);
    const warnings: string[] = [];
    // A fresh service, so nothing remembers the table from before the drop.
    const notices = new NoticesService({
      db: current!.adapter as never,
      logger: { warn: message => warnings.push(message) },
    });

    const written = await notices.record({
      kind: plain,
      userId: "alice",
      subjectId: "t1",
      occurrence: "1",
      data: { n: 1 },
    });
    expect(written).toEqual({ created: false, id: null });
    expect((await notices.find({ userId: "alice" })).rows).toEqual([]);
    expect(await notices.count({ userId: "alice" })).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"nextly_notices"');
    expect(warnings[0]).toContain("nextly migrate");
  });
});
