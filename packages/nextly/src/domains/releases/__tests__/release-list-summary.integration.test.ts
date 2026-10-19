/**
 * What the release list shows beside each release, read for a whole page at
 * once, against a real database: how many documents each release holds and
 * what it does with them, and what the checks say about each one.
 *
 * What only an integration test can establish: that the member counts come
 * out right from the stored rows on every dialect, and that the batch
 * readiness read answers exactly what the single read answers, release by
 * release, and refuses exactly whom the single read refuses.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { RELEASE_MEMBER_LIMIT } from "../../../schemas/releases/types";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { releaseMemberKey } from "../release-member-key";

import { seedPlainAuthor } from "./helpers/live-author";

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
        slug: "articles",
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "title", required: true })],
      }),
    ],
  });
  return current;
}

/** A document, stored through the ordinary write. */
async function article(
  t: TestNextly,
  status: "draft" | "published" = "draft"
): Promise<string> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const created = await handler.createEntry(
    { collectionName: "articles", overrideAccess: true },
    { title: "Fine", status }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  return id;
}

/** Empty an article's required title on its stored row: a hard problem. */
async function breakTitle(t: TestNextly, id: string): Promise<void> {
  await t.adapter.update(
    "dc_articles",
    { title: "" },
    { and: [{ column: "id", op: "=", value: id }] }
  );
}

/** A release holding these documents, each added by `author`. */
async function releaseOf(
  t: TestNextly,
  author: string,
  documents: Array<{ id: string; action: "publish" | "unpublish" }>
): Promise<string> {
  const release = await t.nextly.releases.create({ title: "Launch" });
  for (const document of documents) {
    await t.nextly.releases.addMember({
      releaseId: release.id,
      scopeKind: "collection",
      scopeSlug: "articles",
      entryId: document.id,
      locale: null,
      action: document.action,
      userId: author,
    });
  }
  return release.id;
}

/**
 * Members written straight into the production table, for a release holding
 * more than a release may now take: the write path refuses to build one, and
 * releases made before the limit can still hold that many.
 */
async function insertMembers(
  t: TestNextly,
  releaseId: string,
  count: number
): Promise<void> {
  const adapter = t.adapter as unknown as {
    insert: (
      table: string,
      row: Record<string, unknown>,
      options: { returning: string[] }
    ) => Promise<unknown>;
  };
  for (let i = 0; i < count; i += 1) {
    const ref = {
      scopeKind: "collection" as const,
      scopeSlug: "articles",
      entryId: `legacy-${i}`,
      locale: null,
    };
    await adapter.insert(
      "nextly_release_members",
      {
        id: `${releaseId.slice(0, 24)}-${String(i).padStart(4, "0")}`,
        releaseId,
        ...ref,
        action: "publish",
        memberKey: releaseMemberKey(releaseId, ref),
        singleSlot: null,
        createdBy: null,
        createdAt: new Date(),
      },
      { returning: [] }
    );
  }
}

describe.each(getConfiguredTestDialects())(
  "a page of releases, summarised in one read (%s)",
  dialect => {
    it("counts each release's documents, and how many go live and come down", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      const drafts = [await article(t), await article(t), await article(t)];
      const live = [
        await article(t, "published"),
        await article(t, "published"),
      ];

      const mixed = await releaseOf(t, author, [
        ...drafts.map(id => ({ id, action: "publish" as const })),
        ...live.map(id => ({ id, action: "unpublish" as const })),
      ]);
      const takedown = await releaseOf(t, author, [
        { id: live[0], action: "unpublish" },
      ]);
      const empty = await releaseOf(t, author, []);

      const counts = await t.nextly.releases.memberCounts({
        releaseIds: [mixed, takedown, empty],
      });
      expect(counts).toEqual({
        [mixed]: { total: 5, goLive: 3, comeDown: 2 },
        [takedown]: { total: 1, goLive: 0, comeDown: 1 },
        // Asked about and holding nothing: counted as nothing, not left out,
        // so a reader never mistakes "none" for "not answered".
        [empty]: { total: 0, goLive: 0, comeDown: 0 },
      });
    });

    it("answers each release's readiness exactly as the single read does", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      const broken = await article(t);
      const fine = await article(t);
      await breakTitle(t, broken);
      const withProblem = await releaseOf(t, author, [
        { id: fine, action: "publish" },
        { id: broken, action: "publish" },
      ]);
      const clean = await releaseOf(t, author, [
        { id: fine, action: "publish" },
      ]);
      const missing = "00000000-0000-7000-8000-0000000000ff";

      const batch = await t.nextly.releases.readinessOf({
        releaseIds: [withProblem, missing, clean],
      });
      const single = await Promise.all(
        [withProblem, clean].map(releaseId =>
          t.nextly.releases.readiness({ releaseId })
        )
      );

      // The control: the release with a problem really has one, so the
      // comparison below is between two non-trivial answers.
      expect(single[0].hard.length).toBeGreaterThan(0);
      // In the order asked; a release that does not exist has nothing to read
      // and is left out, as the single read would answer not found for it.
      expect(batch).toEqual([
        { ...single[0], checked: true },
        { ...single[1], checked: true },
      ]);
    });

    it("refuses whom the single read refuses", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      const releaseId = await releaseOf(t, author, [
        { id: await article(t), action: "publish" },
      ]);
      // An active user granted nothing about releases.
      const outsider = await seedPlainAuthor(t);
      const as = { userId: outsider, overrideAccess: false } as const;

      await expect(
        t.nextly.releases.readiness({ releaseId, ...as })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        t.nextly.releases.readinessOf({ releaseIds: [releaseId], ...as })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        t.nextly.releases.memberCounts({ releaseIds: [releaseId], ...as })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("refuses more releases than one page holds", async () => {
      const t = await boot(dialect);
      const ids = Array.from(
        { length: 51 },
        (_, i) => `00000000-0000-7000-8000-${String(i).padStart(12, "0")}`
      );
      await expect(
        t.nextly.releases.readinessOf({ releaseIds: ids })
      ).rejects.toMatchObject({ code: "INVALID_INPUT", statusCode: 400 });
      // Fifty is a whole page, and is answered.
      await expect(
        t.nextly.releases.readinessOf({ releaseIds: ids.slice(0, 50) })
      ).resolves.toEqual([]);
    });

    it("leaves a release over the document limit unchecked, and says so", async () => {
      const t = await boot(dialect);
      const oversized = (await t.nextly.releases.create({ title: "Old" })).id;
      await insertMembers(t, oversized, RELEASE_MEMBER_LIMIT + 1);

      await expect(
        t.nextly.releases.readinessOf({ releaseIds: [oversized] })
      ).resolves.toEqual([
        { releaseId: oversized, checked: false, reason: "over-member-limit" },
      ]);
      // Its counts are still read in full.
      await expect(
        t.nextly.releases.memberCounts({ releaseIds: [oversized] })
      ).resolves.toEqual({
        [oversized]: {
          total: RELEASE_MEMBER_LIMIT + 1,
          goLive: RELEASE_MEMBER_LIMIT + 1,
          comeDown: 0,
        },
      });
    });
  }
);
