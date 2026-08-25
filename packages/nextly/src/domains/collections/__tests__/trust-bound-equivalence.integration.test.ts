/**
 * `TRUSTS_EVERY_COLLECTION` must be indistinguishable from omitting the bound.
 *
 * The constant names what an absent bound already meant, so the one property it
 * must never have is a behaviour of its own. The way it acquires one is a call
 * site deriving "this caller narrowed its bypass" from `trusted !== undefined`,
 * which is true for the constant. `expansionStatusScope` withholds a widened
 * lifecycle from a narrowed caller, so under that derivation stating the
 * constant stops drafts propagating into an expansion while omitting it does
 * not — the same caller, the same intent, different rows.
 *
 * Asserted end to end rather than on the predicate, deliberately. A unit test on
 * `narrows()` would pass while a call site went on asking `!== undefined`, which
 * is exactly the shape the defect had. The property belongs to the READ, so the
 * read is what is measured.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, relationship, text } from "../../../config";
import { clearServices, type getService } from "../../../di/register";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { TRUSTS_EVERY_COLLECTION } from "../../../services/collections/trust-grant";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  clearServices();
});

/** A published post pointing at an UNPUBLISHED author. */
async function boot(): Promise<{
  handler: ReturnType<typeof getService<"collectionsHandler">>;
  postId: string;
}> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "authors",
        status: true,
        fields: [text({ name: "name" })],
      }),
      defineCollection({
        slug: "posts",
        fields: [
          text({ name: "title" }),
          relationship({ name: "author", relationTo: "authors" }),
        ],
      }),
    ],
  });

  const handler = current.getService("collectionsHandler");
  const author = await handler.createEntry(
    { collectionName: "authors", overrideAccess: true },
    { name: "Unpublished Author", status: "draft" }
  );
  const authorId = (author.data as { id: string }).id;

  // The fixture is the thing most likely to be wrong here, and a wrong fixture
  // makes every assertion below pass for the wrong reason: if the author were
  // PUBLISHED, all three reads would populate it and the file would read as
  // proof of equivalence while testing nothing about lifecycle at all.
  expect((author.data as { status?: string }).status).toBe("draft");

  const post = await handler.createEntry(
    { collectionName: "posts", overrideAccess: true },
    { title: "A post", author: authorId }
  );
  return { handler, postId: (post.data as { id: string }).id };
}

/** Whether the expansion actually pulled the unpublished author in. */
function populated(data: unknown): boolean {
  return JSON.stringify(data ?? null).includes("Unpublished Author");
}

describe("TRUSTS_EVERY_COLLECTION is the absent bound (integration)", () => {
  it("propagates status:all into expansion exactly as an omitted bound does", async () => {
    const { handler, postId } = await boot();

    // `overrideAccess: false` is LOAD-BEARING and was measured, not chosen.
    //
    // On a trusted read the defect is invisible: `widensLifecycle` widens the
    // lifecycle on its own for an unbounded trusted caller, and it reads the
    // bound's VALUE rather than its presence, so it already treats the constant
    // correctly. It therefore masks the wrong answer coming from
    // `expansionStatusScope` and the read populates either way.
    //
    // A trusted read cannot show the divergence at all, so asserting one here
    // would be a green that proves nothing. The difference is only observable
    // where the caller's own explicit `status: "all"` is the SOLE thing
    // carrying drafts into the expansion.
    const omitted = await handler.getEntry({
      collectionName: "posts",
      entryId: postId,
      depth: 1,
      overrideAccess: false,
      status: "all",
    });

    const stated = await handler.getEntry({
      collectionName: "posts",
      entryId: postId,
      depth: 1,
      overrideAccess: false,
      status: "all",
      trusted: TRUSTS_EVERY_COLLECTION,
    });

    // The population control. Without it, `toBe(populated(...))` is satisfied by
    // both reads returning NOTHING — two empty results are equal, and that is
    // how a previous proof in this repo passed against unfixed code.
    expect(populated(omitted.data)).toBe(true);
    expect(populated(stated.data)).toBe(true);
  });

  it("still withholds them from a caller that genuinely narrowed", async () => {
    const { handler, postId } = await boot();

    // A predicate that admits the target is STILL a narrowing bound: it declares
    // one fixed audience, and `expansionStatusScope` refuses to widen a
    // lifecycle for such a caller whatever the predicate answers.
    //
    // This is the discriminator. Without it, the assertions above would pass
    // just as well if `bounded` were hardcoded `false` everywhere — which would
    // hand every bounded public route the drafts of collections it refused.
    const narrowed = await handler.getEntry({
      collectionName: "posts",
      entryId: postId,
      depth: 1,
      overrideAccess: true,
      status: "all",
      trusted: () => true,
    });

    expect(populated(narrowed.data)).toBe(false);
  });
});
