/**
 * A release admits a document only where its author's rule for the release's
 * action lets that document through.
 *
 * A release writes the document's status alone, a publish or an unpublish,
 * which is judged by that action's own permission and rule. Where the rule
 * answers a filter, the release asks it of the document, as the run's write
 * will: a document the filter matches joins, and one it does not is refused,
 * at the add, at a switch of the member's action, and in the readiness checks
 * that decide whether the release may run.
 *
 * @module domains/releases/__tests__/release-members-match-the-rule-filter.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { clearRuleFilterReports } from "../../../auth/access/rule-answer";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this file keeps its
// own collection slug.
const POSTS = "releasefilter_posts";

const AUTHOR = "releasefilter-author";
const OTHER = "releasefilter-other";

/** "Only the caller's own": a filter over the entry's `owner`. */
const ownEntries = ({ user }: { user: { id: string } | null }) =>
  ({ owner: { equals: user?.id ?? "" } }) as unknown as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  clearRuleFilterReports();
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: ownEntries,
          unpublish: ownEntries,
        },
        fields: [text({ name: "title" }), text({ name: "owner" })],
      }),
    ],
  });
  // A code rule only narrows a permission, so the author holds the
  // document's and the release's.
  await userWhoMay(current, AUTHOR, "read", [POSTS, "content-releases"]);
  for (const action of ["publish", "unpublish"]) {
    await grantTo(current, AUTHOR, action, [POSTS, "content-releases"]);
  }
  for (const action of ["create", "update"]) {
    await grantTo(current, AUTHOR, action, ["content-releases"]);
  }
  return current;
}

/** The author's own draft and another's. */
async function seed(t: TestNextly): Promise<{ own: string; others: string }> {
  const own = await t.nextly.create({
    collection: POSTS,
    data: { title: "mine", owner: AUTHOR, status: "draft" },
  });
  const others = await t.nextly.create({
    collection: POSTS,
    data: { title: "theirs", owner: OTHER, status: "draft" },
  });
  return { own: String(own.item.id), others: String(others.item.id) };
}

/** A member of `entryId` going live, added as the author on a checked call. */
function addAsAuthor(
  t: TestNextly,
  releaseId: string,
  entryId: string,
  extra: Record<string, unknown> = {}
) {
  return t.nextly.releases.addMember({
    releaseId,
    scopeKind: "collection",
    scopeSlug: POSTS,
    entryId,
    locale: null,
    action: "publish",
    userId: AUTHOR,
    overrideAccess: false,
    ...extra,
  });
}

/** The same member added on a trusted call, with the author recorded. */
function addTrusted(t: TestNextly, releaseId: string, entryId: string) {
  return t.nextly.releases.addMember({
    releaseId,
    scopeKind: "collection",
    scopeSlug: POSTS,
    entryId,
    locale: null,
    action: "publish",
    userId: AUTHOR,
    overrideAccess: true,
  });
}

async function statusOf(t: TestNextly, id: string): Promise<unknown> {
  const found = (await t.nextly.findByID({
    collection: POSTS,
    id,
  })) as unknown as { status?: unknown; item?: { status?: unknown } };
  return found.item?.status ?? found.status;
}

describe.each(getConfiguredTestDialects())(
  "a release member under a publish rule that answers a filter (%s)",
  dialect => {
    it("admits a document the author's publish filter matches", async () => {
      const t = await boot(dialect);
      const { own } = await seed(t);
      const release = await t.nextly.releases.create({ title: "Launch" });

      const member = await addAsAuthor(t, release.id, own);

      expect(member.entryId).toBe(own);
    });

    it("refuses a document the filter does not match, and adds nothing", async () => {
      const t = await boot(dialect);
      const { others } = await seed(t);
      const release = await t.nextly.releases.create({ title: "Launch" });

      await expect(addAsAuthor(t, release.id, others)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(
        await t.nextly.releases.listMembers({ releaseId: release.id })
      ).toHaveLength(0);
    });

    it("judges a key by its own rule's filter as well as its maker's", async () => {
      const t = await boot(dialect);
      const { own, others } = await seed(t);
      const release = await t.nextly.releases.create({ title: "Launch" });
      const asKey = {
        authenticatedScope: {
          actorType: "apiKey" as const,
          permissions: [
            "read-content-releases",
            "create-content-releases",
            `read-${POSTS}`,
            `publish-${POSTS}`,
          ],
        },
        apiKeyId: "releasefilter-key",
      };

      await expect(
        addAsAuthor(t, release.id, others, asKey)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const member = await addAsAuthor(t, release.id, own, asKey);
      expect(member.entryId).toBe(own);
    });

    it("switches a member's action only for a document the filter matches", async () => {
      const t = await boot(dialect);
      const { own, others } = await seed(t);
      const release = await t.nextly.releases.create({ title: "Launch" });
      const mine = await addAsAuthor(t, release.id, own);
      // Added on a trusted call, as a member recorded before the rule
      // narrowed the author is.
      const theirs = await addTrusted(t, release.id, others);
      const switchTo = (memberId: string) =>
        t.nextly.releases.changeMemberAction({
          releaseId: release.id,
          memberId,
          action: "unpublish",
          userId: AUTHOR,
          overrideAccess: false,
        });

      await expect(switchTo(theirs.id)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      const switched = await switchTo(mine.id);
      expect(switched.action).toBe("unpublish");
    });

    it("flags, before the run, only the member its author may not act on", async () => {
      const t = await boot(dialect);
      const { own, others } = await seed(t);
      const release = await t.nextly.releases.create({ title: "Launch" });
      const mine = await addTrusted(t, release.id, own);
      const theirs = await addTrusted(t, release.id, others);

      const readiness = await t.nextly.releases.readiness({
        releaseId: release.id,
      });

      const flagged = readiness.hard
        .filter(finding => finding.code === "AUTHOR_MAY_NOT_ACT")
        .map(finding => finding.memberId);
      expect(flagged).toEqual([theirs.id]);
      // POPULATION CONTROL: the author's own member was checked and passed.
      expect(flagged).not.toContain(mine.id);
    });

    it("does not run a release holding a member its author may not act on", async () => {
      const t = await boot(dialect);
      const { own, others } = await seed(t);
      const release = await t.nextly.releases.create({ title: "Launch" });
      await addTrusted(t, release.id, own);
      await addTrusted(t, release.id, others);

      await expect(
        t.nextly.releases.publishNow({ id: release.id })
      ).rejects.toBeDefined();
      expect(await statusOf(t, others)).toBe("draft");
      expect(await statusOf(t, own)).toBe("draft");
    });

    it("runs a release whose members the author may all act on", async () => {
      // The control: the run itself is not what refuses.
      const t = await boot(dialect);
      const { own } = await seed(t);
      const release = await t.nextly.releases.create({ title: "Launch" });
      await addTrusted(t, release.id, own);

      await t.nextly.releases.publishNow({ id: release.id });

      expect(await statusOf(t, own)).toBe("published");
    });
  }
);
