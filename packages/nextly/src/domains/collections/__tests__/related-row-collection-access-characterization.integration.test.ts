/**
 * What populating a relationship answers about its TARGET, for each kind of
 * caller.
 *
 * Expansion decides read access to the target by itself rather than through
 * the collection read gate. These cases pin the answers that hold whether or
 * not expansion also consults the caller's grants: a refusing or throwing rule
 * withholds the target, a super-admin session bypasses the rule, and a key
 * owned by a super-admin gets no bypass. Each is pinned cell by cell, so a
 * change to any one fails a named test.
 *
 * 🔴 The key cases come in two halves, and only together do they say what their
 * names claim. A key WITHOUT `read-<target>` cannot separate the rule deciding
 * from the grant deciding: an implementation refusing on the missing grant,
 * before it evaluates `access.read` or reaches the super-admin carve-out,
 * answers every one of them correctly for the wrong reason. The cases holding
 * the grant leave the rule as the only thing left to decide, and one of them
 * requires the target to be POPULATED — so an implementation that withholds
 * every target from every key, which every without-grant case accepts, fails
 * there and only there.
 *
 * Not pinned here: expansion with no RBAC service registered. Every instance
 * `createTestNextly` builds registers one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiKeyScope } from "../../../auth/authenticated-scope";
import { defineCollection, relationship, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

type ReadRule = (ctx: { user?: { id?: string } | null }) => boolean;

/** `refs.plain` points at one `pages` row whose read rule is `pagesRead`. */
async function boot(pagesRead: ReadRule | undefined): Promise<{
  handler: CollectionsHandler;
  refId: string;
  pageId: string;
}> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "pages",
        ...(pagesRead ? { access: { read: pagesRead } } : {}),
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "refs",
        fields: [
          text({ name: "name" }),
          relationship({ name: "plain", relationTo: "pages" }),
        ],
      }),
    ],
  });
  const handler = current.getService("collectionsHandler");
  const page = await handler.createEntry(
    { collectionName: "pages", overrideAccess: true },
    { title: "Target page" }
  );
  const pageId = (page.data as { id: string }).id;
  const ref = await handler.createEntry(
    { collectionName: "refs", overrideAccess: true },
    { name: "r", plain: pageId }
  );
  return { handler, refId: (ref.data as { id: string }).id, pageId };
}

/** Whether the populated relationship on `refs` carries the target row. */
async function populates(
  handler: CollectionsHandler,
  refId: string,
  caller: Pick<
    Parameters<CollectionsHandler["getEntry"]>[0],
    "user" | "authenticatedScope"
  >
): Promise<boolean> {
  const result = await handler.getEntry({
    collectionName: "refs",
    entryId: refId,
    depth: 1,
    routeAuthorized: true,
    ...caller,
  });
  // The parent read is served in every case; only the target varies.
  expect(result.success).toBe(true);
  const plain = (result.data as Record<string, unknown>).plain;
  return JSON.stringify(plain ?? null).includes("Target page");
}

/** A scoped key that may read `refs` but holds no grant on `pages`. */
const keyWithoutTargetGrant = apiKeyScope([
  { slug: "read-refs", action: "read", resource: "refs" },
]);

describe("relationship expansion — a scoped API key without read-<target>", () => {
  // Only refusals are pinned for a key without the target grant. Both hold
  // whether or not expansion also asks for that grant: a refusing rule
  // withholds, and an owner's role lends the key no bypass.
  it("withholds a target whose rule refuses", async () => {
    const { handler, refId } = await boot(() => false);

    expect(
      await populates(handler, refId, {
        user: { id: "key-owner", roles: [] as string[] },
        authenticatedScope: keyWithoutTargetGrant,
      })
    ).toBe(false);
  });

  it("gives a key owned by a super-admin no bypass", async () => {
    const { handler, refId } = await boot(() => false);

    expect(
      await populates(handler, refId, {
        user: { id: "root-owner", roles: ["super-admin"] },
        authenticatedScope: keyWithoutTargetGrant,
      })
    ).toBe(false);
  });
});

/**
 * A scoped key holding `read-pages` as well as `read-refs`.
 *
 * 🔴 The control the cases above cannot supply for themselves. Both of them use
 * a scope WITHOUT the target grant, so an implementation that refuses on the
 * missing grant — before it evaluates `access.read` or reaches the
 * scoped-key/super-admin carve-out — answers both correctly without ever
 * reaching the behaviour their names claim. Holding the grant leaves the
 * target's own rule as the only thing left to decide, so these cases separate
 * the two.
 *
 * Roles are passed as an EXPLICIT empty list rather than omitted. `apiKeyScope`
 * leaves `roles` off the scope when given nothing, and the key decision reads
 * `scope.roles ?? user.roles`, so an omitted list lets the owner's roles stand
 * in for the key's — which is the very substitution the super-admin case below
 * exists to rule out.
 */
const keyWithTargetGrant = apiKeyScope(
  [
    { slug: "read-refs", action: "read", resource: "refs" },
    { slug: "read-pages", action: "read", resource: "pages" },
  ],
  []
);

describe("relationship expansion — a scoped API key WITH read-<target>", () => {
  it("populates a target whose rule admits", async () => {
    // The must-move control for this whole file. Every other key case asserts
    // a target is WITHHELD, and an implementation that withholds every target
    // from every key satisfies all of them. This one must come back populated,
    // so that implementation fails here.
    const { handler, refId } = await boot(() => true);

    expect(
      await populates(handler, refId, {
        user: { id: "key-owner", roles: [] as string[] },
        authenticatedScope: keyWithTargetGrant,
      })
    ).toBe(true);
  });

  it("withholds a target whose rule refuses", async () => {
    // With the grant held, the refusal can only have come from the target's
    // rule. The same assertion on a key without the grant cannot say that.
    const { handler, refId } = await boot(() => false);

    expect(
      await populates(handler, refId, {
        user: { id: "key-owner", roles: [] as string[] },
        authenticatedScope: keyWithTargetGrant,
      })
    ).toBe(false);
  });

  it("gives a key owned by a super-admin no bypass, grant or no grant", async () => {
    // The owner carries the role and the key does not, so a decision reading
    // the owner's roles admits this caller. Pinned with the grant held so the
    // refusal is the carve-out at work rather than the missing grant.
    const { handler, refId } = await boot(() => false);

    expect(
      await populates(handler, refId, {
        user: { id: "root-owner", roles: ["super-admin"] },
        authenticatedScope: keyWithTargetGrant,
      })
    ).toBe(false);
  });
});

describe("relationship expansion — session callers", () => {
  it("populates a target whose rule refuses, for a super-admin session", async () => {
    const { handler, refId } = await boot(() => false);

    // Control first: the same rule withholds the target from an ordinary
    // session, so the populated relationship below is the bypass at work.
    expect(await populates(handler, refId, { user: { id: "ordinary" } })).toBe(
      false
    );
    expect(
      await populates(handler, refId, {
        user: { id: "root", roles: ["super-admin"] },
      })
    ).toBe(true);
  });

  it("withholds a target whose rule throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler, refId } = await boot(() => {
      throw new Error("rule failed");
    });

    expect(await populates(handler, refId, { user: { id: "ordinary" } })).toBe(
      false
    );
  });
});
