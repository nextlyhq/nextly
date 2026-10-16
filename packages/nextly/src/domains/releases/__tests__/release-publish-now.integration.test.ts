/**
 * Publish now, and the states a release can no longer leave.
 *
 * Publish now runs a release at once through the same engine a scheduled run
 * uses, so the properties worth proving against a real database are the ones a
 * shortcut would lose: the documents are written for real (the stored row, not
 * only what a read projects), they are written as each member's author, the
 * whole release goes together, and a run is never repeated.
 *
 * The second half is what "never re-run or change a release that ran" means
 * for the other transitions: a published or cancelled release takes no further
 * change, while a STOPPED one — which has not run — can still be fixed.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { ReleasesRepository } from "../releases-repository";

import { deactivate, seedLiveAuthor } from "./helpers/live-author";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "posts";
const DAY = 24 * 60 * 60 * 1000;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

/** The stored lifecycle of a row, read RAW rather than through the read path. */
async function storedStatus(
  t: TestNextly,
  id: string
): Promise<string | undefined> {
  const row = await t.adapter.selectOne<{ status?: string }>(`dc_${SLUG}`, {
    where: { and: [{ column: "id", op: "=", value: id }] },
  });
  return row?.status;
}

async function draft(t: TestNextly, title: string): Promise<string> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const created = await handler.createEntry(
    { collectionName: SLUG, overrideAccess: true },
    { title, status: "draft" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  return id;
}

/** A release holding these drafts to go live, added by `author`. */
async function releaseOf(
  t: TestNextly,
  author: string,
  entryIds: string[],
  title = "Launch"
): Promise<string> {
  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({ title, createdBy: author });
  for (const entryId of entryIds) {
    await repo.addMember({
      releaseId: release.id,
      scopeKind: "collection",
      scopeSlug: SLUG,
      entryId,
      locale: null,
      action: "publish",
      createdBy: author,
    });
  }
  return release.id;
}

async function stateOf(t: TestNextly, id: string): Promise<string | undefined> {
  return (await t.nextly.releases.findByID({ id }))?.state;
}

describe.each(getConfiguredTestDialects())(
  "publish now, and releases that ran (%s)",
  dialect => {
    it("runs a scheduled release at once, writing every document as its author", async () => {
      // Scheduled for next week, so only Publish now can explain the rows
      // being published today — the read path would not project a release
      // whose time has not come.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const a = await draft(t, "First");
      const b = await draft(t, "Second");
      const id = await releaseOf(t, author, [a, b]);
      await new ReleasesRepository(t.adapter).scheduleRelease(
        id,
        new Date(Date.now() + 7 * DAY),
        "Europe/Berlin"
      );

      const ran = await t.nextly.releases.publishNow({ id });

      expect(ran.state).toBe("published");
      // Raw rows: a run that wrote nothing would still read as published
      // through the read path once its instant had passed.
      expect(await storedStatus(t, a)).toBe("published");
      expect(await storedStatus(t, b)).toBe("published");
      // The zone the author chose is kept: it is part of the record.
      expect(ran.timezone).toBe("Europe/Berlin");
    });

    it("runs a release once when two requests to publish it now overlap", async () => {
      // A double click or a retry: both read the release scheduled. Only one
      // may move it and run it; the other is refused before anything runs.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const id = await releaseOf(t, author, [await draft(t, "Once")]);
      await new ReleasesRepository(t.adapter).scheduleRelease(
        id,
        new Date(Date.now() + 7 * DAY),
        "UTC"
      );
      const outcomes = await Promise.allSettled([
        t.nextly.releases.publishNow({ id }),
        t.nextly.releases.publishNow({ id }),
      ]);
      expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.find(o => o.status === "rejected")).toMatchObject({
        reason: { code: "CONFLICT" },
      });
      expect(await stateOf(t, id)).toBe("published");
    });

    it("runs a draft release at once", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const a = await draft(t, "Only");
      const id = await releaseOf(t, author, [a]);

      const ran = await t.nextly.releases.publishNow({ id });

      expect(ran.state).toBe("published");
      expect(await storedStatus(t, a)).toBe("published");
    });

    it("refuses a release that would stop, and changes nothing", async () => {
      // The same check scheduling makes: an author who can no longer act would
      // stop the run part-way. Refused BEFORE any document is written, so none
      // of the release goes out rather than some of it.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const gone = await seedLiveAuthor(t);
      const a = await draft(t, "Fine");
      const b = await draft(t, "Stuck");
      const id = await releaseOf(t, author, [a]);
      await new ReleasesRepository(t.adapter).addMember({
        releaseId: id,
        scopeKind: "collection",
        scopeSlug: SLUG,
        entryId: b,
        locale: null,
        action: "publish",
        createdBy: gone,
      });
      await deactivate(t, gone);

      await expect(t.nextly.releases.publishNow({ id })).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(await stateOf(t, id)).toBe("draft");
      expect(await storedStatus(t, a)).toBe("draft");
      expect(await storedStatus(t, b)).toBe("draft");
    });

    it("runs only this release, not every other release that is due", async () => {
      // Another release, overdue and touching a different document, is the
      // runner's to apply. Publish now acting on it too would put content live
      // that nobody asked to publish from this screen.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const mine = await draft(t, "Mine");
      const theirs = await draft(t, "Theirs");
      const id = await releaseOf(t, author, [mine]);
      const other = await releaseOf(t, author, [theirs], "Other");
      await new ReleasesRepository(t.adapter).scheduleRelease(
        other,
        new Date(Date.now() - DAY),
        "UTC"
      );

      await t.nextly.releases.publishNow({ id });

      expect(await storedStatus(t, mine)).toBe("published");
      expect(await storedStatus(t, theirs)).toBe("draft");
      expect(await stateOf(t, other)).toBe("scheduled");
    });

    it("never runs a release twice, nor one that stopped or was cancelled", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const repo = new ReleasesRepository(t.adapter);

      const published = await releaseOf(t, author, [await draft(t, "P")]);
      await t.nextly.releases.publishNow({ id: published });

      const cancelled = await releaseOf(t, author, [await draft(t, "C")]);
      await repo.cancelRelease(cancelled);

      const stoppedDoc = await draft(t, "S");
      const stopped = await releaseOf(t, author, [stoppedDoc]);
      const at = new Date(Date.now() - DAY);
      await repo.scheduleRelease(stopped, at, "UTC");
      await repo.blockReleases([{ id: stopped, scheduledAt: at }]);

      for (const [id, state] of [
        [published, "published"],
        [cancelled, "cancelled"],
        [stopped, "blocked"],
      ] as const) {
        await expect(
          t.nextly.releases.publishNow({ id })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await stateOf(t, id)).toBe(state);
      }
      // A stopped release is fixed and scheduled again, never run as it is.
      expect(await storedStatus(t, stoppedDoc)).toBe("draft");
    });

    it("lets documents come out of a stopped release, and not out of one that ran", async () => {
      // Removing the document that stopped a release is how it is fixed, so a
      // stopped release must stay editable. A published or cancelled one is
      // the record of what happened, and stays as it is.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const repo = new ReleasesRepository(t.adapter);

      const stopped = await releaseOf(t, author, [await draft(t, "S")]);
      const at = new Date(Date.now() - DAY);
      await repo.scheduleRelease(stopped, at, "UTC");
      await repo.blockReleases([{ id: stopped, scheduledAt: at }]);
      const [stoppedMember] = await repo.listMembers(stopped);
      await t.nextly.releases.removeMember({
        memberId: stoppedMember.id,
        releaseId: stopped,
      });
      expect(await repo.listMembers(stopped)).toEqual([]);

      const published = await releaseOf(t, author, [await draft(t, "P")]);
      await t.nextly.releases.publishNow({ id: published });
      const cancelled = await releaseOf(t, author, [await draft(t, "C")]);
      await repo.cancelRelease(cancelled);

      for (const id of [published, cancelled]) {
        const [member] = await repo.listMembers(id);
        await expect(
          t.nextly.releases.removeMember({ memberId: member.id, releaseId: id })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await repo.listMembers(id)).toHaveLength(1);
      }
    });

    it("treats a cancelled release as final: no new documents, no new time", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const repo = new ReleasesRepository(t.adapter);
      const id = await releaseOf(t, author, [await draft(t, "C")]);
      await repo.cancelRelease(id);

      await expect(
        t.nextly.releases.addMember({
          releaseId: id,
          scopeKind: "collection",
          scopeSlug: SLUG,
          entryId: await draft(t, "Late"),
          locale: null,
          action: "publish",
          userId: author,
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining("create a new release"),
      });
      await expect(
        t.nextly.releases.schedule({
          id,
          at: new Date(Date.now() + DAY),
          timezone: "UTC",
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining("create a new release"),
      });
      expect(await stateOf(t, id)).toBe("cancelled");
      expect(await repo.listMembers(id)).toHaveLength(1);
    });
  }
);
