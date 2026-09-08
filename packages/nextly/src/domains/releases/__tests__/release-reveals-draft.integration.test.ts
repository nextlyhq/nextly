/**
 * The end-to-end question Stage D exists to answer: does a scheduled release
 * actually change what a reader sees, at the moment it comes due?
 *
 * Every other suite here tests a part — the effect rule, the repository, the
 * condition builder, the visibility seam. Each can be right while the feature
 * does nothing, because the parts are only connected at the read path. This is
 * the one that fails if they are not wired together.
 *
 * It asks through the ORDINARY read an anonymous visitor would make, not
 * through the release machinery, because "a release published my post" is a
 * claim about the read and not about the release.
 *
 * @module domains/releases/__tests__/release-reveals-draft.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { ReleasesRepository } from "../releases-repository";
import { seedLiveAuthor } from "./helpers/live-author";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "posts";
const PAST = new Date("2020-01-01T00:00:00Z");
const FUTURE = new Date("2099-01-01T00:00:00Z");

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
        status: true,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

/** A draft entry, and the release that will publish it. */
async function draftInRelease(
  t: TestNextly,
  scheduledAt: Date | null
): Promise<string> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const created = await handler.createEntry(
    { collectionName: SLUG },
    { title: "pending", status: "draft" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");

  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({ title: "Go live" });
  await repo.addMember({
    releaseId: release.id,
    scopeKind: "collection",
    scopeSlug: SLUG,
    entryId: id,
    locale: null,
    action: "publish",
    // A live author: the read path projects a due member only when its author
    // still exists and is active, matching the write path that runs AS them.
    createdBy: await seedLiveAuthor(t),
  });
  if (scheduledAt !== null) {
    await repo.scheduleRelease(release.id, scheduledAt, "UTC");
  }
  return id;
}

/** A PUBLISHED entry, and the release that will withdraw it. */
async function publishedInTakedown(
  t: TestNextly,
  scheduledAt: Date | null
): Promise<string> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  // Trusted for the SETUP only. This collection declares no `publish` rule, and
  // publish/unpublish are granted only by an explicit one — so an untrusted
  // create of a published row is refused. What has to be untrusted is the READ
  // the assertion makes, which is where the release decision applies.
  const created = await handler.createEntry(
    { collectionName: SLUG, overrideAccess: true },
    { title: "live", status: "published" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");

  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({ title: "Take it down" });
  await repo.addMember({
    releaseId: release.id,
    scopeKind: "collection",
    scopeSlug: SLUG,
    entryId: id,
    locale: null,
    action: "unpublish",
    createdBy: await seedLiveAuthor(t),
  });
  if (scheduledAt !== null) {
    await repo.scheduleRelease(release.id, scheduledAt, "UTC");
  }
  return id;
}

/** What an ordinary anonymous published read returns. */
async function publishedIds(t: TestNextly): Promise<string[]> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const result = await handler.listEntries({ collectionName: SLUG, limit: 50 });
  const docs = (result.data?.docs ?? []) as { id: string }[];
  return docs.map(row => row.id);
}

describe.each(getConfiguredTestDialects())(
  "a due release changes what a reader sees (%s)",
  dialect => {
    it("REVEALS a draft whose release has come due", async () => {
      const t = await boot(dialect);
      const id = await draftInRelease(t, PAST);
      expect(await publishedIds(t)).toContain(id);
    });

    it("does not reveal it before the release is due", async () => {
      // The control. Without it, a read path that simply ignored `status`
      // would satisfy the case above while publishing every draft on the site.
      const t = await boot(dialect);
      const id = await draftInRelease(t, FUTURE);
      expect(await publishedIds(t)).not.toContain(id);
    });

    it("does not reveal it while the release is still being assembled", async () => {
      // A release with no instant has not been scheduled at all. Treating its
      // members as due would publish content the moment somebody added it to a
      // draft release — the opposite of what a release is for.
      const t = await boot(dialect);
      const id = await draftInRelease(t, null);
      expect(await publishedIds(t)).not.toContain(id);
    });

    it("WITHDRAWS a published entry whose takedown has come due", async () => {
      // The listing half of the withdrawal, which had no test. The row's stored
      // status still says `published` — that is what the release is undoing —
      // so an implementation that only widened the filter kept returning it.
      const t = await boot(dialect);
      const id = await publishedInTakedown(t, PAST);
      expect(await publishedIds(t)).not.toContain(id);
    });

    it("still lists it before the takedown is due", async () => {
      // The control. A filter that excluded every entry named by any release
      // member would satisfy the case above while hiding content whose takedown
      // has not arrived.
      const t = await boot(dialect);
      const id = await publishedInTakedown(t, FUTURE);
      expect(await publishedIds(t)).toContain(id);
    });

    it("still lists it while the takedown is being assembled", async () => {
      // An unscheduled release is somebody still deciding. Consulting it would
      // make adding a document to a draft release take it off the site.
      const t = await boot(dialect);
      const id = await publishedInTakedown(t, null);
      expect(await publishedIds(t)).toContain(id);
    });
  }
);
