/**
 * The checks a document must pass to join a release, on every way in.
 *
 * They were the REST route's alone, so the Direct API accepted a member REST
 * refuses: a document that is not there, a collection with no draft/published
 * lifecycle, a Single named by a stale id. Each of those is recorded, scheduled
 * and then fails at its instant, holding the release open with nobody
 * watching. These cases go through the Direct API, which is the door that had
 * no check.
 *
 * And the due releases are found by a query, not by reading every scheduled
 * release: a site with a year of launches planned reads only the ones due.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ReleasesRepository } from "../releases-repository";

import { seedLiveAuthor } from "./helpers/live-author";

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
        access: { read: () => true, update: () => true, publish: () => true },
        fields: [text({ name: "title" })],
      }),
      // No `status`: no draft/published lifecycle, so nothing a release can
      // publish.
      defineCollection({
        slug: "notes",
        access: { read: () => true, update: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "homepage",
        status: true,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "headline" })],
      }),
    ],
  });
  return current;
}

async function post(t: TestNextly): Promise<string> {
  const created = (await t.nextly.create({
    collection: "posts" as never,
    data: { title: "Draft", status: "draft" } as never,
  })) as unknown as { item?: { id?: string }; id?: string };
  return String(created.item?.id ?? created.id);
}

describe.each(getConfiguredTestDialects())(
  "a document joining a release through the Direct API (%s)",
  dialect => {
    it("refuses a document that is not there", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const release = await t.nextly.releases.create({ title: "Launch" });
      await expect(
        t.nextly.releases.addMember({
          releaseId: release.id,
          scopeKind: "collection",
          scopeSlug: "posts",
          entryId: "00000000-0000-4000-8000-00000000dead",
          locale: null,
          action: "publish",
          userId: author,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        await t.nextly.releases.listMembers({ releaseId: release.id })
      ).toEqual([]);
    });

    it("refuses a collection with no draft/published lifecycle", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const note = (await t.nextly.create({
        collection: "notes" as never,
        data: { title: "A note" } as never,
      })) as unknown as { item?: { id?: string }; id?: string };
      const release = await t.nextly.releases.create({ title: "Launch" });
      await expect(
        t.nextly.releases.addMember({
          releaseId: release.id,
          scopeKind: "collection",
          scopeSlug: "notes",
          entryId: String(note.item?.id ?? note.id),
          locale: null,
          action: "publish",
          userId: author,
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });

    it("stores a Single's own id, not the one the caller sent", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      await t.nextly.updateSingle({
        slug: "homepage" as never,
        data: { headline: "Draft", status: "draft" } as never,
      });
      const row = await t.adapter.selectOne<{ id: string }>(
        "single_homepage",
        {}
      );
      const release = await t.nextly.releases.create({ title: "Launch" });
      const member = await t.nextly.releases.addMember({
        releaseId: release.id,
        scopeKind: "single",
        scopeSlug: "homepage",
        entryId: "stale-id",
        locale: null,
        action: "publish",
        userId: author,
      });
      expect(member.entryId).toBe(row?.id);
    });

    it("accepts a real draft in a collection with a lifecycle", async () => {
      // The control: the checks refuse only what they should.
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const id = await post(t);
      const release = await t.nextly.releases.create({ title: "Launch" });
      const member = await t.nextly.releases.addMember({
        releaseId: release.id,
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: id,
        locale: null,
        action: "publish",
        userId: author,
      });
      expect(member.entryId).toBe(id);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "finding the due releases (%s)",
  dialect => {
    it("reads only the releases that are due, not every scheduled one", async () => {
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const now = new Date();
      const day = 24 * 60 * 60 * 1000;
      for (let i = 0; i < 40; i += 1) {
        const future = await repo.createRelease({ title: `Future ${i}` });
        await repo.scheduleRelease(
          future.id,
          new Date(now.getTime() + (i + 1) * day),
          "UTC"
        );
      }
      const due = await repo.createRelease({ title: "Due" });
      await repo.scheduleRelease(due.id, new Date(now.getTime() - day), "UTC");

      // Count the rows the database hands back for the read, through a
      // wrapper on the adapter the repository reads with.
      let rowsRead = 0;
      const counted = Object.create(t.adapter) as typeof t.adapter;
      counted.select = async <T = unknown>(
        ...args: Parameters<typeof t.adapter.select>
      ): Promise<T[]> => {
        const rows = await t.adapter.select<T>(...args);
        rowsRead += rows.length;
        return rows;
      };
      const found = await new ReleasesRepository(counted).findDueReleases(now);

      expect(found.map(row => row.title)).toEqual(["Due"]);
      // The forty future releases never left the database.
      expect(rowsRead).toBe(1);
    });
  }
);
