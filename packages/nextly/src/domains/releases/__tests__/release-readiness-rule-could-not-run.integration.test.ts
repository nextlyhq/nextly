/**
 * A release's readiness ends with `RULE_COULD_NOT_RUN`, naming the
 * collection, when the publish rule its author is judged by could not run.
 *
 * The readiness checks ask whether each member's author may still perform its
 * action, through the gate the release's run will meet. A rule whose own query
 * waited out the bound for a database connection never answered. The
 * plausible broken implementation, the one this had, read the gate's failed
 * answer as a refusal: the author was reported `AUTHOR_MAY_NOT_ACT`, a hard
 * problem that blocks the release for a reason no rule gave. A rule that
 * throws for any other reason still refuses, which the second control shows;
 * the first, with the rule answering, reports nothing, and both show the
 * fixture reaches the rule.
 */
import { poolWaitTimeoutError } from "@nextlyhq/adapter-drizzle/types";
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

import { seedPlainAuthor } from "./helpers/live-author";

const POSTS = "readinessruleposts";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Armed after the member is added, so the add's own checks never ask it. */
interface Probe {
  armed: boolean;
  /** What an armed rule does: wait out the pool, or fail on its own. */
  does: "wait" | "throw";
  calls: number;
}

/** A release holding one draft going live, added for a plain author. */
async function releaseOfOne(
  dialect: TestDialect,
  probe: Probe
): Promise<{ t: TestNextly; releaseId: string; memberId: string }> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => {
            if (!probe.armed) return true;
            probe.calls += 1;
            if (probe.does === "throw") {
              throw new Error("the rule's own failure");
            }
            // The rule's own query waited out the pool's bound, as the
            // adapter reports it.
            throw poolWaitTimeoutError(15_000);
          },
        },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  const t = current;
  const author = await seedPlainAuthor(t);
  // A rule only narrows a permission, so the author holds the document's and
  // the release's, and the rule is what decides.
  for (const action of ["read", "update", "publish"]) {
    await grantTo(t, author, action, [POSTS, "content-releases"]);
  }
  const handler = t.getService<CollectionsHandler>("collectionsHandler");
  const created = await handler.createEntry(
    { collectionName: POSTS, overrideAccess: true },
    { title: "Draft", status: "draft" }
  );
  const entryId = (created.data as { id: string }).id;
  const release = await t.nextly.releases.create({ title: "Launch" });
  const member = await t.nextly.releases.addMember({
    releaseId: release.id,
    scopeKind: "collection",
    scopeSlug: POSTS,
    entryId,
    locale: null,
    action: "publish",
    userId: author,
  });
  return { t, releaseId: release.id, memberId: member.id };
}

describe.each(getConfiguredTestDialects())(
  "a release whose author's publish rule could not run (integration, %s)",
  dialect => {
    it("reports nothing while the rule answers", async () => {
      const probe: Probe = { armed: false, does: "wait", calls: 0 };
      const { t, releaseId } = await releaseOfOne(dialect, probe);

      const readiness = await t.nextly.releases.readiness({ releaseId });

      expect(readiness.hard).toEqual([]);
    });

    it("still reports an author whose rule fails for any other reason", async () => {
      const probe: Probe = { armed: false, does: "throw", calls: 0 };
      const { t, releaseId, memberId } = await releaseOfOne(dialect, probe);

      probe.armed = true;
      const readiness = await t.nextly.releases.readiness({ releaseId });

      expect(probe.calls).toBeGreaterThan(0);
      expect(readiness.hard.map(found => [found.memberId, found.code])).toEqual(
        [[memberId, "AUTHOR_MAY_NOT_ACT"]]
      );
    });

    it("ends naming the collection, not with the author reported as unable to act", async () => {
      const probe: Probe = { armed: false, does: "wait", calls: 0 };
      const { t, releaseId } = await releaseOfOne(dialect, probe);

      probe.armed = true;
      const readiness = await t.nextly.releases
        .readiness({ releaseId })
        .catch((error: unknown) => error);

      expect(probe.calls, JSON.stringify(readiness)).toBeGreaterThan(0);
      expect(readiness).toMatchObject({
        statusCode: 503,
        code: "RULE_COULD_NOT_RUN",
        publicData: { subject: POSTS },
      });
    });
  }
);
