/**
 * `routeAuthorized` is a fact about the CALL SITE, and the two call sites
 * disagree.
 *
 * The flag skips the coarse RBAC / code-defined access gate for `update`. The
 * MINT runs behind `requireRouteCollectionAccess(req, "update", collection)`,
 * so re-asking there is a question already answered. A preview RENDER is an
 * anonymous public request with no route gate at all, so claiming the gate ran
 * skips the only check that notices a sharer's authority was withdrawn.
 *
 * A default would pick one and be silently wrong for the other, which is why
 * the argument is required. These cases pin the divergence: the same probe,
 * the same user, the same entry, two answers.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import { assertEntryPreviewable } from "../preview-access";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A caller the collection's own rule refuses to let edit anything. */
const DENIED = { id: "u1", email: "x@y.test", roles: [] };

async function seed(): Promise<string> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "pages",
        access: { read: () => true, update: () => false },
        fields: [text({ name: "slug" }), text({ name: "title" })],
      }),
    ],
  });
  const created = await current.nextly.create({
    collection: "pages",
    data: { slug: "a", title: "A" },
  });
  return String(created.item.id);
}

describe("assertEntryPreviewable and the gate that may or may not have run", () => {
  it("refuses a caller the collection's update rule denies, when nothing gated them", async () => {
    const id = await seed();

    await expect(
      assertEntryPreviewable("pages", id, DENIED, { routeAuthorized: false })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // The other half, and it is not a formality: this is the behaviour the mint
  // relies on, and a probe that refused here would break minting for every
  // caller the route had already authorized.
  it("does not re-ask that gate for a caller the route already authorized", async () => {
    const id = await seed();

    await expect(
      assertEntryPreviewable("pages", id, DENIED, { routeAuthorized: true })
    ).resolves.toBeUndefined();
  });

  // The control that makes the pair mean something: the SAME rule, reached
  // through the ordinary enforced write, refuses. Without it the divergence
  // above could be two readings of a rule that never applied to anyone.
  it("agrees with the enforced write path about that rule", async () => {
    const id = await seed();

    await expect(
      current!.nextly.update({
        collection: "pages",
        id,
        data: { title: "edited" },
        overrideAccess: false,
        user: DENIED,
      })
    ).rejects.toThrow();
  });
});
