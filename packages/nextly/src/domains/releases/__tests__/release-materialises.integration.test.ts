/**
 * A scheduled release, actually performed.
 *
 * The read path can make a due release LOOK applied; this is the half that
 * writes it. The two are built on the same pure rule, so the case worth
 * exercising end to end is that a release which reads as due also PERSISTS —
 * and that it persists as the member's author rather than as a system
 * principal, which is the property a scheduled publish could most easily lose
 * without anyone noticing.
 *
 * @module domains/releases/__tests__/release-materialises.integration.test
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
import { applyDueReleases } from "../apply-due-releases";
import { createReleaseMutations } from "../release-mutations";
import { ReleasesRepository } from "../releases-repository";

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

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

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

async function draftInRelease(
  t: TestNextly,
  scheduledAt: Date | null,
  author: string | null
): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: SLUG, overrideAccess: true },
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
    createdBy: author,
  });
  if (scheduledAt !== null) {
    await repo.scheduleRelease(release.id, scheduledAt, "UTC");
  }
  return id;
}

/** One materialisation pass, as the drain job performs it. */
async function materialise(t: TestNextly, author: { id: string } | null) {
  return applyDueReleases({
    repository: new ReleasesRepository(t.adapter),
    mutations: createReleaseMutations({ contentApi: t.nextly }),
    runAs: {
      findUser: async id => (author === null ? null : { id, isActive: true }),
      listRoleSlugs: async () => [],
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "a due release is actually performed (%s)",
  dialect => {
    it("PUBLISHES the stored row, not just the read", async () => {
      // The whole point of materialisation. Asserted on the RAW row rather than
      // through a read, because the read path resolves a due release by itself
      // — reading through it would pass against a materialiser that wrote
      // nothing at all.
      const t = await boot(dialect);
      const id = await draftInRelease(t, PAST, "author-1");
      expect(await storedStatus(t, id)).toBe("draft");

      const result = await materialise(t, { id: "author-1" });
      expect(result).toMatchObject({ applied: 1, failed: 0, published: 1 });
      expect(await storedStatus(t, id)).toBe("published");
    });

    it("leaves a release whose time has NOT come", async () => {
      // The control. A materialiser that published every member would satisfy
      // the case above while publishing the entire future schedule.
      const t = await boot(dialect);
      const id = await draftInRelease(t, FUTURE, "author-1");

      const result = await materialise(t, { id: "author-1" });

      expect(result).toMatchObject({ due: 0, applied: 0 });
      expect(await storedStatus(t, id)).toBe("draft");
    });

    it("REFUSES a member whose author cannot be resolved, and holds the release open", async () => {
      // Authority that was withdrawn stays withdrawn. The row must not publish,
      // and the release must stay scheduled so the next pass retries rather
      // than the work vanishing from both the content and the schedule.
      const t = await boot(dialect);
      const id = await draftInRelease(t, PAST, "ghost");

      const result = await materialise(t, null);

      expect(result).toMatchObject({ applied: 0, failed: 1, published: 0 });
      expect(result.outcomes[0]?.failure).toBe("AUTHOR_UNAVAILABLE");
      expect(await storedStatus(t, id)).toBe("draft");
    });

    it("refuses a member with no recorded author rather than acting as the system", async () => {
      // The sharpest case: there is nobody to act as, and the only fallback
      // available is the privileged principal this design refuses.
      const t = await boot(dialect);
      const id = await draftInRelease(t, PAST, null);

      const result = await materialise(t, { id: "author-1" });

      expect(result.outcomes[0]?.failure).toBe("NO_RECORDED_AUTHOR");
      expect(await storedStatus(t, id)).toBe("draft");
    });
  }
);
