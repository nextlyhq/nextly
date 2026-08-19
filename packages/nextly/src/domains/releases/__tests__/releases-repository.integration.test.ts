/**
 * The release store against a REAL database.
 *
 * Two things only an integration test can establish. First, that the tables
 * exist at all: they reach a database through three separate registries, and a
 * miss in any one of them still leaves every unit test passing. Booting a real
 * instance and writing to them is what proves the wiring.
 *
 * Second, that the uniqueness rule holds where it is actually enforced. The
 * unique index sits on the `member_key` digest rather than on the five source
 * columns, because `locale` is nullable and SQL treats NULL as distinct from
 * NULL — a composite index would admit any number of unlocalized members for
 * one document. That difference is invisible to a unit test and decisive here.
 *
 * Runs against whichever dialect the integration run configures; CI covers
 * SQLite, Postgres and MySQL.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  ReleasesRepository,
  documentRefKey,
  type DocumentRef,
} from "../releases-repository";

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
        versions: { drafts: true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

const ref = (entryId: string, locale: string | null = null): DocumentRef => ({
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId,
  locale,
});

const PAST = new Date("2020-01-01T00:00:00Z");
const FUTURE = new Date("2099-01-01T00:00:00Z");

describe.each(getConfiguredTestDialects())(
  "ReleasesRepository (%s)",
  dialect => {
    it("stores a release and its members", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);

      const release = await repo.createRelease({ title: "Spring launch" });
      expect(release.id).toBeTruthy();
      expect(release.state).toBe("draft");

      const member = await repo.addMember({
        releaseId: release.id,
        ...ref("e1"),
        action: "publish",
      });
      expect(member.releaseId).toBe(release.id);
      expect(member.action).toBe("publish");
    });

    it("refuses a second member for the same document in one release", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });

      await repo.addMember({
        releaseId: release.id,
        ...ref("e1"),
        action: "publish",
      });

      // The unlocalized case specifically: `locale` is NULL here, which is
      // exactly where a composite unique index would silently permit a duplicate.
      await expect(
        repo.addMember({
          releaseId: release.id,
          ...ref("e1"),
          action: "unpublish",
        })
      ).rejects.toThrow();
    });

    it("allows the same document in two DIFFERENT releases", async () => {
      // The flagship case: publish on one date, unpublish on another. A
      // constraint that forbade this would forbid scheduled takedown entirely.
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const first = await repo.createRelease({ title: "Go live" });
      const second = await repo.createRelease({ title: "Take down" });

      await repo.addMember({
        releaseId: first.id,
        ...ref("e1"),
        action: "publish",
      });
      await expect(
        repo.addMember({
          releaseId: second.id,
          ...ref("e1"),
          action: "unpublish",
        })
      ).resolves.toBeTruthy();
    });

    it("allows the same document in one release once per LANGUAGE", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });

      await repo.addMember({
        releaseId: release.id,
        ...ref("e1", "en"),
        action: "publish",
      });
      await expect(
        repo.addMember({
          releaseId: release.id,
          ...ref("e1", "es"),
          action: "publish",
        })
      ).resolves.toBeTruthy();
    });

    it("returns no due members while the release is still a draft", async () => {
      // An unscheduled release must not affect reads even if its time would have
      // passed: `state` is what makes a release live, not the clock alone.
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.addMember({
        releaseId: release.id,
        ...ref("e1"),
        action: "publish",
      });

      const due = await repo.findDueMembersFor([ref("e1")], new Date());
      expect(due.get(documentRefKey(ref("e1"))) ?? []).toEqual([]);
    });

    it("returns a member once its release is scheduled, and not before its time", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.addMember({
        releaseId: release.id,
        ...ref("e1"),
        action: "publish",
      });
      await repo.scheduleRelease(release.id, FUTURE, "UTC");

      // The repository returns every member of a SCHEDULED release; deciding
      // whether the time has come is `resolveReleaseEffect`'s job, and keeping
      // that judgement in one place is why the query does not filter on it.
      const found = await repo.findDueMembersFor([ref("e1")], new Date());
      const members = found.get(documentRefKey(ref("e1"))) ?? [];
      expect(members).toHaveLength(1);
      expect(members[0]?.scheduledAt.getTime()).toBe(FUTURE.getTime());
    });

    it("stops returning a member once its release is cancelled", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.addMember({
        releaseId: release.id,
        ...ref("e1"),
        action: "publish",
      });
      await repo.scheduleRelease(release.id, PAST, "UTC");

      const before = await repo.findDueMembersFor([ref("e1")], new Date());
      expect(before.get(documentRefKey(ref("e1")))).toHaveLength(1);

      await repo.cancelRelease(release.id);

      // Nothing is undone and nothing is written to the document: a cancelled
      // release simply stops being consulted, which is what makes cancelling a
      // due-but-unmaterialised release free.
      const after = await repo.findDueMembersFor([ref("e1")], new Date());
      expect(after.get(documentRefKey(ref("e1"))) ?? []).toEqual([]);
    });

    it("keeps each document's members apart", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.addMember({
        releaseId: release.id,
        ...ref("e1"),
        action: "publish",
      });
      await repo.addMember({
        releaseId: release.id,
        ...ref("e2"),
        action: "unpublish",
      });
      await repo.scheduleRelease(release.id, PAST, "UTC");

      const found = await repo.findDueMembersFor(
        [ref("e1"), ref("e2")],
        new Date()
      );
      expect(found.get(documentRefKey(ref("e1")))?.[0]?.action).toBe("publish");
      expect(found.get(documentRefKey(ref("e2")))?.[0]?.action).toBe(
        "unpublish"
      );
    });

    it("costs the same number of queries for 25 documents as for 5", async () => {
      // A per-row lookup would be correct and quadratic: a listing of 50 entries
      // would issue 50 queries. What is asserted is that the count does not GROW
      // with the number of documents, not that it equals one — a member row does
      // not carry its release's time, and the port has no join, so the honest
      // answer is a constant two.
      //
      // Members must EXIST for this to mean anything. With none, the lookup
      // returns after its first query and never reaches the second, so a per-row
      // implementation would pass this test too.
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      const refs = Array.from({ length: 25 }, (_, i) => ref(`e${i}`));
      for (const r of refs) {
        await repo.addMember({
          releaseId: release.id,
          ...r,
          action: "publish",
        });
      }
      await repo.scheduleRelease(release.id, PAST, "UTC");

      const spyMany = vi.spyOn(app.adapter, "select");
      const many = await repo.findDueMembersFor(refs, new Date());
      const queriesForMany = spyMany.mock.calls.length;
      spyMany.mockRestore();

      const spyFew = vi.spyOn(app.adapter, "select");
      await repo.findDueMembersFor(refs.slice(0, 5), new Date());
      const queriesForFew = spyFew.mock.calls.length;
      spyFew.mockRestore();

      // The positive control: the run actually resolved members, so the counts
      // above are of a lookup that did the work rather than one that bailed out.
      expect(many.size).toBe(25);
      expect(queriesForMany).toBe(queriesForFew);
    });

    it("asks nothing of the database for an empty document list", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);

      const spy = vi.spyOn(app.adapter, "select");
      const found = await repo.findDueMembersFor([], new Date());

      expect(found.size).toBe(0);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("reports the earliest scheduled instant, including one already past", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const now = new Date();
      const soon = new Date(now.getTime() + 60_000);
      const later = new Date(now.getTime() + 120_000);

      const past = await repo.createRelease({ title: "Already gone" });
      await repo.scheduleRelease(past.id, PAST, "UTC");
      const draft = await repo.createRelease({ title: "Not scheduled yet" });
      const laterRelease = await repo.createRelease({ title: "Later" });
      await repo.scheduleRelease(laterRelease.id, later, "UTC");
      const soonRelease = await repo.createRelease({ title: "Soon" });
      await repo.scheduleRelease(soonRelease.id, soon, "UTC");

      const earliest = await repo.findEarliestScheduledTransition();

      // The PAST release wins, and that is the point: a release whose time has
      // passed but which nothing has materialised yet is affecting reads right
      // now. Answering with the earliest FUTURE instant instead would report
      // "nothing pending" for exactly the case the lookup exists to catch.
      //
      // Whole seconds: SQLite stores epoch seconds, so a millisecond comparison
      // would pass on two dialects and fail on the third for no real difference.
      expect(Math.floor((earliest?.getTime() ?? 0) / 1000)).toBe(
        Math.floor(PAST.getTime() / 1000)
      );
      expect(draft.state).toBe("draft");
    });

    it("reports nothing once no release is scheduled at all", async () => {
      // A release leaves `scheduled` when it materialises or is cancelled, so
      // the cheap check goes quiet again on its own rather than needing to be
      // told.
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const release = await repo.createRelease({ title: "Called off" });
      await repo.scheduleRelease(release.id, PAST, "UTC");
      await repo.cancelRelease(release.id);

      await expect(repo.findEarliestScheduledTransition()).resolves.toBeNull();
    });

    it("removes a member", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      const member = await repo.addMember({
        releaseId: release.id,
        ...ref("e1"),
        action: "publish",
      });
      await repo.scheduleRelease(release.id, PAST, "UTC");

      await repo.removeMember(member.id);

      const found = await repo.findDueMembersFor([ref("e1")], new Date());
      expect(found.get(documentRefKey(ref("e1"))) ?? []).toEqual([]);
    });
  }
);
