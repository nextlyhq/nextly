/**
 * What populating a relationship answers about its TARGET, for the callers the
 * existing relationship-access suite does not name, as it behaves today.
 *
 * Expansion decides read access to the target by itself rather than through
 * the collection read gate, and it decides differently in two documented ways:
 * it never asks whether the caller holds `read-<target>`, and a target with no
 * read rule admits. These cases pin those answers cell by cell, beside the
 * direct read of the same target where the two doors disagree, so that folding
 * expansion into a shared read decision cannot change either answer unseen.
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
  it("populates a target that declares no read rule, which the direct read refuses", async () => {
    const { handler, refId, pageId } = await boot(undefined);
    const key = { id: "key-owner", roles: [] as string[] };

    // The direct door judges the key's grant and refuses it.
    const direct = await handler.getEntry({
      collectionName: "pages",
      entryId: pageId,
      user: key,
      authenticatedScope: keyWithoutTargetGrant,
    });
    expect(direct.success).toBe(false);

    // Expansion never asks about the grant, so the same row is populated.
    expect(
      await populates(handler, refId, {
        user: key,
        authenticatedScope: keyWithoutTargetGrant,
      })
    ).toBe(true);
  });

  it("populates when the target's rule admits, and withholds when it refuses", async () => {
    const key = { id: "key-owner", roles: [] as string[] };

    const admits = await boot(() => true);
    expect(
      await populates(admits.handler, admits.refId, {
        user: key,
        authenticatedScope: keyWithoutTargetGrant,
      })
    ).toBe(true);
    await current?.destroy();
    current = undefined;

    const refuses = await boot(() => false);
    expect(
      await populates(refuses.handler, refuses.refId, {
        user: key,
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

describe("relationship expansion — session callers", () => {
  it("populates a target that declares no read rule for a caller holding no grant", async () => {
    const { handler, refId } = await boot(undefined);

    expect(await populates(handler, refId, { user: { id: "no-grants" } })).toBe(
      true
    );
  });

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
