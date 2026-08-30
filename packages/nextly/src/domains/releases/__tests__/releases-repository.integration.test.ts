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

import { deactivate, seedLiveAuthor } from "./helpers/live-author";

import { defineCollection, text } from "../../../config";
import { RELEASE_STATES_SHOWN_ON_A_DOCUMENT } from "../../../schemas/releases/types";
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

    it("stops returning a BLOCKED release to the read path", async () => {
      // The safety half of the state, and the reason the read path may not
      // simply widen its filter: a release that stopped must stop projecting
      // its effect onto what a visitor sees, or "stopped" would mean nothing
      // to a reader.
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.addMember({
        releaseId: release.id,
        ...ref("e1"),
        action: "publish",
      });
      await repo.scheduleRelease(release.id, PAST, "UTC");
      expect(await repo.blockRelease(release.id, PAST)).toBe(true);

      const found = await repo.findDueMembersFor([ref("e1")], new Date());
      expect(found.get(documentRefKey(ref("e1"))) ?? []).toEqual([]);
    });

    it("returns a BLOCKED release to a caller that asks for one", async () => {
      // The half a unit test cannot reach, and the half that was wrong. The
      // banner widened its own state list one layer ABOVE this query, which
      // filtered `scheduled` alone — so the row it asked for had already been
      // dropped and the widening could never fire. Only a real query answers
      // whether the states a caller names are the states it gets.
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.addMember({
        releaseId: release.id,
        ...ref("e1"),
        action: "publish",
      });
      await repo.scheduleRelease(release.id, PAST, "UTC");
      expect(await repo.blockRelease(release.id, PAST)).toBe(true);

      // The list the document's banner actually passes, imported rather than
      // spelled again: a test naming its own states would keep passing after
      // the banner's list changed underneath it.
      const found = await repo.findDueMembersFor(
        [ref("e1")],
        new Date(),
        RELEASE_STATES_SHOWN_ON_A_DOCUMENT
      );
      const members = found.get(documentRefKey(ref("e1"))) ?? [];
      expect(members).toHaveLength(1);
      // Still carrying the instant it was going to run at, which is what the
      // banner orders and dates the row by.
      expect(members[0]?.scheduledAt.getTime()).toBe(PAST.getTime());
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

      const instants = await repo.findScheduledTransitions();
      const earliest = instants[0];

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

      await expect(repo.findScheduledTransitions()).resolves.toEqual([]);
    });

    it("returns EVERY scheduled instant, so an overdue one cannot mask a later", async () => {
      // The cheap check wants an instant at or before now; a cache lifetime
      // wants the next one strictly AFTER. Those differ exactly when an overdue
      // release is still `scheduled` — which is what a release held open by a
      // failed member looks like. Returning only the earliest made the second
      // question unanswerable: it would report "nothing ahead" forever while a
      // genuinely future release went unbounded.
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const stuck = await repo.createRelease({ title: "Overdue" });
      await repo.scheduleRelease(stuck.id, PAST, "UTC");
      const ahead = await repo.createRelease({ title: "Ahead" });
      await repo.scheduleRelease(ahead.id, FUTURE, "UTC");

      const instants = await repo.findScheduledTransitions();

      expect(instants).toHaveLength(2);
      // Ascending, so a caller can take the first strictly after now without
      // sorting it again.
      expect(instants[0]!.getTime()).toBeLessThan(instants[1]!.getTime());
    });

    it("flushes the members' cache tags when a release is SCHEDULED", async () => {
      // A page cached while nothing was scheduled was stored tag-only, and the
      // bound computed at read time cannot reach back into an entry that
      // already exists. Scheduling has to flush those tags itself, or the page
      // serves pre-release content past the transition until some unrelated
      // write happens to bust it.
      const app = await boot(dialect);
      const flushed: unknown[] = [];
      const repo = new ReleasesRepository(app.adapter, {
        flush: intents => {
          flushed.push(...intents);
        },
      });
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.addMember({
        releaseId: release.id,
        ...ref("e1"),
        action: "publish",
      });
      // `addMember` flushes too, for its own reason. Cleared so this case
      // measures what SCHEDULING flushed rather than the sum of both.
      flushed.length = 0;

      await repo.scheduleRelease(release.id, PAST, "UTC");

      expect(flushed).toHaveLength(1);
      expect((flushed[0] as { tags: string[] }).tags.sort()).toEqual(
        ["nextly:posts", "nextly:posts:id:e1"].sort()
      );
    });

    it("flushes them again when the release is CANCELLED", async () => {
      // Cancelling changes what a read returns just as scheduling does: a page
      // cached with a lifetime derived from this release is now bounded by an
      // instant that will never arrive.
      const app = await boot(dialect);
      const flushed: unknown[] = [];
      const repo = new ReleasesRepository(app.adapter, {
        flush: intents => {
          flushed.push(...intents);
        },
      });
      const release = await repo.createRelease({ title: "Called off" });
      await repo.addMember({
        releaseId: release.id,
        ...ref("e1"),
        action: "publish",
      });
      await repo.scheduleRelease(release.id, PAST, "UTC");
      flushed.length = 0;

      await repo.cancelRelease(release.id);

      expect(flushed).toHaveLength(1);
    });

    it("flushes tags when a member is ADDED to a scheduled release", async () => {
      // Membership can change after scheduling. Without this the document's
      // cached pages stay bounded by a schedule that did not include it.
      const app = await boot(dialect);
      const flushed: unknown[] = [];
      const repo = new ReleasesRepository(app.adapter, {
        flush: intents => {
          flushed.push(...intents);
        },
      });
      const release = await repo.createRelease({ title: "Spring launch" });
      await repo.scheduleRelease(release.id, PAST, "UTC");
      flushed.length = 0;

      await repo.addMember({
        releaseId: release.id,
        ...ref("e1"),
        action: "publish",
      });

      expect(flushed).toHaveLength(1);
    });

    it("flushes the REMOVED member's own tags", async () => {
      // Read before the delete: afterwards nothing says which document's tags
      // to flush, so the projection that release was producing would stay
      // cached with no write left to clear it.
      const app = await boot(dialect);
      const flushed: { tags: string[] }[] = [];
      const repo = new ReleasesRepository(app.adapter, {
        flush: intents => {
          flushed.push(...(intents as { tags: string[] }[]));
        },
      });
      const release = await repo.createRelease({ title: "Spring launch" });
      const member = await repo.addMember({
        releaseId: release.id,
        ...ref("e1"),
        action: "publish",
      });
      await repo.scheduleRelease(release.id, PAST, "UTC");
      flushed.length = 0;

      await repo.removeMember(member.id);

      expect(flushed).toHaveLength(1);
      expect(flushed[0]!.tags).toContain("nextly:posts:id:e1");
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

    describe("which documents a due release would REVEAL", () => {
      it("names a document whose due release publishes it", async () => {
        // The widening query. A published-only read filters `status` in SQL, so a
        // draft row is excluded by the database before any per-document
        // decoration runs — a post-filter cannot add back a row the query never
        // returned. This is what lets the filter include it in the first place.
        const app = await boot(dialect);
        const repo = new ReleasesRepository(app.adapter);
        const release = await repo.createRelease({ title: "Go live" });
        await repo.addMember({
          releaseId: release.id,
          ...ref("e1"),
          action: "publish",
          // A live author. `findDueDecisions` projects a member only when its
          // author still exists and is active, matching the write path that runs
          // AS them — an unattributed member describes an effect no write could
          // perform, so it is correctly invisible.
          createdBy: await seedLiveAuthor(app),
        });
        await repo.scheduleRelease(release.id, PAST, "UTC");

        const decisions = await repo.findDueDecisions({
          scopeKind: "collection",
          scopeSlug: "posts",
          now: new Date(),
        });
        expect(decisions.reveal).toEqual(["e1"]);
      });

      it("does NOT name one whose release is still in the future", async () => {
        const app = await boot(dialect);
        const repo = new ReleasesRepository(app.adapter);
        const release = await repo.createRelease({ title: "Later" });
        await repo.addMember({
          releaseId: release.id,
          ...ref("e1"),
          action: "publish",
          // Attributed, so this negative case fails for its OWN reason. An
          // authorless member is now filtered before the timing, state and
          // winner logic runs, so without this the assertion holds even if
          // that logic breaks entirely.
          createdBy: await seedLiveAuthor(app),
        });
        await repo.scheduleRelease(release.id, FUTURE, "UTC");

        expect(
          await repo.findDueDecisions({
            scopeKind: "collection",
            scopeSlug: "posts",
            now: new Date(),
          })
        ).toMatchObject({ reveal: [] });
      });

      it("does NOT name one whose release was never scheduled", async () => {
        // A release still being assembled has no instant. Treating an unscheduled
        // member as due would publish content the moment it was added to a draft
        // release, which is the opposite of what a release is for.
        const app = await boot(dialect);
        const repo = new ReleasesRepository(app.adapter);
        const release = await repo.createRelease({ title: "Still assembling" });
        await repo.addMember({
          releaseId: release.id,
          ...ref("e1"),
          action: "publish",
          // Attributed, so this negative case fails for its OWN reason. An
          // authorless member is now filtered before the timing, state and
          // winner logic runs, so without this the assertion holds even if
          // that logic breaks entirely.
          createdBy: await seedLiveAuthor(app),
        });

        expect(
          await repo.findDueDecisions({
            scopeKind: "collection",
            scopeSlug: "posts",
            now: new Date(),
          })
        ).toMatchObject({ reveal: [] });
      });

      it("does NOT name one whose LATER due release takes it down again", async () => {
        // Publish on the 1st, unpublish on the 20th; from the 20th both are due
        // and the later one wins. The winner is decided by the SAME pure rule the
        // per-document decoration uses, so the filter cannot admit a row the
        // decoration then hides — which would surface as a listing whose count
        // disagrees with its contents.
        const app = await boot(dialect);
        const repo = new ReleasesRepository(app.adapter);
        const up = await repo.createRelease({ title: "Go live" });
        await repo.addMember({
          releaseId: up.id,
          ...ref("e1"),
          action: "publish",
          // Attributed, so this negative case fails for its OWN reason. An
          // authorless member is now filtered before the timing, state and
          // winner logic runs, so without this the assertion holds even if
          // that logic breaks entirely.
          createdBy: await seedLiveAuthor(app),
        });
        await repo.scheduleRelease(
          up.id,
          new Date("2020-01-01T00:00:00Z"),
          "UTC"
        );

        const down = await repo.createRelease({ title: "Take down" });
        await repo.addMember({
          releaseId: down.id,
          ...ref("e1"),
          action: "unpublish",
          // Attributed, so this negative case fails for its OWN reason. An
          // authorless member is now filtered before the timing, state and
          // winner logic runs, so without this the assertion holds even if
          // that logic breaks entirely.
          createdBy: await seedLiveAuthor(app),
        });
        await repo.scheduleRelease(
          down.id,
          new Date("2020-06-01T00:00:00Z"),
          "UTC"
        );

        expect(
          await repo.findDueDecisions({
            scopeKind: "collection",
            scopeSlug: "posts",
            now: new Date(),
          })
        ).toMatchObject({ reveal: [] });
      });

      it("does NOT project a release whose author was DEACTIVATED", async () => {
        // The property the write path already enforces and this seam did not.
        // Materialisation runs every action as the member's author precisely so
        // that scheduling cannot become a privilege escalation with a delay on
        // it. Withdrawing that authority has to stop the projection too —
        // otherwise the write is refused while the read goes on showing the
        // effect, and because a refused member holds its release open, it shows
        // it forever.
        const app = await boot(dialect);
        const repo = new ReleasesRepository(app.adapter);
        const author = await seedLiveAuthor(app);
        const release = await repo.createRelease({ title: "Go live" });
        await repo.addMember({
          releaseId: release.id,
          ...ref("e1"),
          action: "publish",
          createdBy: author,
        });
        await repo.scheduleRelease(release.id, PAST, "UTC");

        // Live author: the effect IS projected. Without this the case below
        // could pass because the release was never projected for some other
        // reason entirely.
        await expect(
          repo.findDueDecisions({
            scopeKind: "collection",
            scopeSlug: "posts",
            now: new Date(),
          })
        ).resolves.toMatchObject({ reveal: ["e1"] });

        await deactivate(app, author);

        await expect(
          repo.findDueDecisions({
            scopeKind: "collection",
            scopeSlug: "posts",
            now: new Date(),
          })
        ).resolves.toMatchObject({ reveal: [], hide: [] });
      });

      it("projects NOTHING when the WINNING member's author was deactivated", async () => {
        // The read and the write must pick the same winner. Materialisation
        // resolves the winner over EVERY member and judges the author
        // afterwards, so removing candidates before the winner rule lets this
        // seam pick a different one: the earlier publish below beats the later
        // takedown once the takedown is filtered out, while the write path still
        // picks the takedown, fails it, and performs nothing. The release stays
        // scheduled, so the older publish would be projected indefinitely
        // against a document nothing ever writes.
        const app = await boot(dialect);
        const repo = new ReleasesRepository(app.adapter);
        const active = await seedLiveAuthor(app);
        const gone = await seedLiveAuthor(app);

        const earlier = await repo.createRelease({ title: "Publish" });
        await repo.addMember({
          releaseId: earlier.id,
          ...ref("e1"),
          action: "publish",
          createdBy: active,
        });
        await repo.scheduleRelease(earlier.id, PAST, "UTC");

        const later = await repo.createRelease({ title: "Take down" });
        await repo.addMember({
          releaseId: later.id,
          ...ref("e1"),
          action: "unpublish",
          createdBy: gone,
        });
        // Later than the publish, so it WINS the effect rule.
        await repo.scheduleRelease(
          later.id,
          new Date(PAST.getTime() + 60_000),
          "UTC"
        );

        // Precondition: with both authors live, the later takedown wins.
        await expect(
          repo.findDueDecisions({
            scopeKind: "collection",
            scopeSlug: "posts",
            now: new Date(),
          })
        ).resolves.toMatchObject({ hide: ["e1"] });

        await deactivate(app, gone);

        // NOT `reveal: ["e1"]` — that is the older action the write path will
        // never perform.
        await expect(
          repo.findDueDecisions({
            scopeKind: "collection",
            scopeSlug: "posts",
            now: new Date(),
          })
        ).resolves.toEqual({ reveal: [], hide: [] });
      });

      it("does NOT project a member with no recorded author", async () => {
        // The same verdict the materialiser reaches: there is nobody to act as,
        // and the only fallback is the privileged principal it refuses. So a
        // member like this describes an effect no write could ever perform.
        const app = await boot(dialect);
        const repo = new ReleasesRepository(app.adapter);
        const release = await repo.createRelease({ title: "Go live" });
        await repo.addMember({
          releaseId: release.id,
          ...ref("e1"),
          action: "publish",
        });
        await repo.scheduleRelease(release.id, PAST, "UTC");

        await expect(
          repo.findDueDecisions({
            scopeKind: "collection",
            scopeSlug: "posts",
            now: new Date(),
          })
        ).resolves.toMatchObject({ reveal: [], hide: [] });
      });

      it("does NOT project a TAKEDOWN whose author was deactivated either", async () => {
        // Both directions, because they fail in opposite ways. A publish that
        // still projects shows content the author may no longer publish; a
        // takedown that still projects HIDES content on the say-so of somebody
        // whose authority was withdrawn.
        const app = await boot(dialect);
        const repo = new ReleasesRepository(app.adapter);
        const author = await seedLiveAuthor(app);
        const release = await repo.createRelease({ title: "Take down" });
        await repo.addMember({
          releaseId: release.id,
          ...ref("e1"),
          action: "unpublish",
          createdBy: author,
        });
        await repo.scheduleRelease(release.id, PAST, "UTC");
        await expect(
          repo.findDueDecisions({
            scopeKind: "collection",
            scopeSlug: "posts",
            now: new Date(),
          })
        ).resolves.toMatchObject({ hide: ["e1"] });

        await deactivate(app, author);

        await expect(
          repo.findDueDecisions({
            scopeKind: "collection",
            scopeSlug: "posts",
            now: new Date(),
          })
        ).resolves.toMatchObject({ reveal: [], hide: [] });
      });

      it("names a document whose due release WITHDRAWS it", async () => {
        // The direction that was computed and then thrown away. `unpublish` was
        // resolved correctly and the id was simply left out of the reveal set,
        // so every read went on returning the row the release was supposed to
        // take down — a scheduled takedown that silently did nothing.
        const app = await boot(dialect);
        const repo = new ReleasesRepository(app.adapter);
        const release = await repo.createRelease({ title: "Take down" });
        await repo.addMember({
          releaseId: release.id,
          ...ref("e1"),
          action: "unpublish",
          // A live author. `findDueDecisions` projects a member only when its
          // author still exists and is active, matching the write path that runs
          // AS them — an unattributed member describes an effect no write could
          // perform, so it is correctly invisible.
          createdBy: await seedLiveAuthor(app),
        });
        await repo.scheduleRelease(release.id, PAST, "UTC");

        const decisions = await repo.findDueDecisions({
          scopeKind: "collection",
          scopeSlug: "posts",
          now: new Date(),
        });
        expect(decisions.hide).toEqual(["e1"]);
        // Disjoint: one winning member per document, so nothing is in both.
        expect(decisions.reveal).toEqual([]);
      });

      it("does NOT withdraw one whose release is still in the future", async () => {
        // The control for the case above: a repository that reported every
        // unpublish member would satisfy it while withdrawing content whose
        // takedown has not arrived.
        const app = await boot(dialect);
        const repo = new ReleasesRepository(app.adapter);
        const release = await repo.createRelease({ title: "Take down" });
        await repo.addMember({
          releaseId: release.id,
          ...ref("e1"),
          action: "unpublish",
          // Attributed, so this negative case fails for its OWN reason. An
          // authorless member is now filtered before the timing, state and
          // winner logic runs, so without this the assertion holds even if
          // that logic breaks entirely.
          createdBy: await seedLiveAuthor(app),
        });
        await repo.scheduleRelease(release.id, FUTURE, "UTC");

        expect(
          await repo.findDueDecisions({
            scopeKind: "collection",
            scopeSlug: "posts",
            now: new Date(),
          })
        ).toEqual({ reveal: [], hide: [] });
      });

      it("ignores a member scoped to ONE LANGUAGE", async () => {
        // Per-locale lifecycle does not live on the row this answer filters. A
        // localized document is public through its main row OR through any one
        // of its translations, and the mutation service keeps a German
        // unpublish from taking the document down for everyone by writing the
        // companion's `_status` and leaving the main row alone. Honouring a
        // locale member here would contradict that write path in both
        // directions. Per-locale release visibility belongs on companion
        // selection and is not built yet.
        const app = await boot(dialect);
        const repo = new ReleasesRepository(app.adapter);
        const release = await repo.createRelease({ title: "German launch" });
        await repo.addMember({
          releaseId: release.id,
          ...ref("e1", "de"),
          action: "publish",
          // Attributed, so this negative case fails for its OWN reason. An
          // authorless member is now filtered before the timing, state and
          // winner logic runs, so without this the assertion holds even if
          // that logic breaks entirely.
          createdBy: await seedLiveAuthor(app),
        });
        await repo.scheduleRelease(release.id, PAST, "UTC");

        await expect(
          repo.findDueDecisions({
            scopeKind: "collection",
            scopeSlug: "posts",
            now: new Date(),
          })
        ).resolves.toEqual({ reveal: [], hide: [] });
      });

      it("lets a later LOCALE takedown decide nothing about the document", async () => {
        // The exact shape that produced the defect this replaced: members were
        // grouped by document AND locale, so a document-wide publish and a
        // later locale-scoped takedown formed two groups, each resolving its
        // own winner, and the same id landed in `reveal` AND `hide`.
        // `statusCondition` re-admitted it through the reveal while the Single
        // path hid it, so the two read paths disagreed about one document.
        //
        // Guards the FILTER, not the grouping: once locale members are excluded
        // every remaining member of a document groups together, so the overlap
        // is then structurally impossible. Break-verified — restoring the old
        // grouping key alone does not fail this, and that is the honest reason
        // why.
        const app = await boot(dialect);
        const repo = new ReleasesRepository(app.adapter);
        const up = await repo.createRelease({ title: "wide publish" });
        await repo.addMember({
          releaseId: up.id,
          ...ref("e1", null),
          action: "publish",
          // A live author. `findDueDecisions` projects a member only when its
          // author still exists and is active, matching the write path that runs
          // AS them — an unattributed member describes an effect no write could
          // perform, so it is correctly invisible.
          createdBy: await seedLiveAuthor(app),
        });
        await repo.scheduleRelease(up.id, PAST, "UTC");

        const down = await repo.createRelease({ title: "de takedown" });
        await repo.addMember({
          releaseId: down.id,
          ...ref("e1", "de"),
          action: "unpublish",
        });
        await repo.scheduleRelease(
          down.id,
          new Date("2021-01-01T00:00:00Z"),
          "UTC"
        );

        const decisions = await repo.findDueDecisions({
          scopeKind: "collection",
          scopeSlug: "posts",
          now: new Date(),
        });
        const both = decisions.reveal.filter(id => decisions.hide.includes(id));
        expect(both).toEqual([]);
        // The control: the assertion above is satisfied by two empty sets, so
        // pin what the document-wide member actually decides.
        expect(decisions.reveal).toEqual(["e1"]);
      });

      it("scopes to the collection asked about", async () => {
        // The control for the cases above: a query that returned everything would
        // satisfy the positive case while widening every other collection's read.
        const app = await boot(dialect);
        const repo = new ReleasesRepository(app.adapter);
        const release = await repo.createRelease({ title: "Go live" });
        await repo.addMember({
          releaseId: release.id,
          ...ref("e1"),
          action: "publish",
          // Attributed, so this negative case fails for its OWN reason. An
          // authorless member is now filtered before the timing, state and
          // winner logic runs, so without this the assertion holds even if
          // that logic breaks entirely.
          createdBy: await seedLiveAuthor(app),
        });
        await repo.scheduleRelease(release.id, PAST, "UTC");

        expect(
          await repo.findDueDecisions({
            scopeKind: "collection",
            scopeSlug: "other_collection",
            now: new Date(),
          })
        ).toMatchObject({ reveal: [] });
      });
    });
  }
);
