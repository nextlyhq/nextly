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

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { ReleasesRepository } from "../releases-repository";
import { seedPlainAuthor } from "./helpers/live-author";
import { scheduleAsItStands } from "./helpers/release-writes";

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
    // The assertions read as a visitor, judged by the Public role a real boot
    // makes, which reads posts by their rule.
    seedPublic: true,
    collections: [
      defineCollection({
        slug: SLUG,
        status: true,
        // Its authors may put a post live and take one down, so a member is
        // one the release's run can perform.
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

/** A draft entry, and the release that will publish it. */
async function draftInRelease(
  t: TestNextly,
  scheduledAt: Date | null
): Promise<string> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const created = await handler.createEntry(
    { collectionName: SLUG, overrideAccess: true },
    { title: "pending", status: "draft" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");

  await releaseHolding(t, id, "publish", scheduledAt);
  return id;
}

/**
 * A release holding this post, added the way the product adds one, and
 * scheduled when an instant is given. Asserted ready, so what a case reads is
 * the effect of a release that would actually run.
 */
async function releaseHolding(
  t: TestNextly,
  entryId: string,
  action: "publish" | "unpublish",
  scheduledAt: Date | null
): Promise<void> {
  // A live author: the read path projects a due member only when its author
  // still exists and is active, matching the write path that runs AS them.
  // Not the super admin, so the author's own access is what is judged. A code
  // rule only narrows the permission, so the author holds update and the
  // release's action on posts.
  const author = await seedPlainAuthor(t);
  await grantTo(t, author, "update", [SLUG]);
  await grantTo(t, author, action, [SLUG]);
  const release = await t.nextly.releases.create({ title: "Go live" });
  await t.nextly.releases.addMember({
    releaseId: release.id,
    scopeKind: "collection",
    scopeSlug: SLUG,
    entryId,
    locale: null,
    action,
    userId: author,
  });
  expect(
    (await t.nextly.releases.readiness({ releaseId: release.id })).hard
  ).toEqual([]);
  if (scheduledAt !== null) {
    // Through the repository, so an instant already past can be set.
    const repo = new ReleasesRepository(t.adapter);
    await scheduleAsItStands(repo, release.id, scheduledAt, "UTC");
  }
}

/** A PUBLISHED entry, and the release that will withdraw it. */
async function publishedInTakedown(
  t: TestNextly,
  scheduledAt: Date | null
): Promise<string> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  // Trusted for the SETUP only: what has to be untrusted is the READ the
  // assertion makes, which is where the release decision applies.
  const created = await handler.createEntry(
    { collectionName: SLUG, overrideAccess: true },
    { title: "live", status: "published" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");

  await releaseHolding(t, id, "unpublish", scheduledAt);
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
