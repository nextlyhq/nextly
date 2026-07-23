/**
 * A scoped API key must be judged on its OWN grants on every write surface, not
 * only create/update/publish. The session super-admin bypass (which lets a
 * super-admin skip a code-defined access rule) is skipped when the caller is a
 * scoped API key, so a super-admin who OWNS a narrowly-scoped key cannot use it
 * to bypass that rule.
 *
 * This pins two surfaces that previously did not forward the scope to
 * `checkCollectionAccess`:
 *   - `deleteEntry`
 *   - the version-label update gate (`canUpdateEntry`, used by
 *     `assertVersionDocumentUpdatable`)
 *
 * Each uses a collection whose code-defined rule refuses the operation. A
 * super-admin caller WITHOUT a scope bypasses the rule; the same super-admin
 * arriving as a scoped API key is judged on the key and refused — which only
 * holds if the scope is threaded through to the gate.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("API-key scope coverage on delete + version-label gates", () => {
  it("skips the super-admin bypass for a scoped key on deleteEntry", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          // A code rule that refuses delete. A session super-admin bypasses it;
          // a scoped API key is judged on the key and must not.
          access: { read: () => true, delete: () => false },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "t" }
    );
    const id = (created.data as { id: string }).id;

    // Super-admin owner of a delete-scoped key: the scope reaches the gate, so
    // the super-admin bypass is skipped and the refusing code rule applies.
    const denied = await handler.deleteEntry({
      collectionName: "posts",
      entryId: id,
      userId: "admin",
      userRoles: ["super-admin"],
      authenticatedScope: {
        actorType: "apiKey",
        permissions: ["delete-posts"],
      },
    });
    expect(denied.success).toBe(false);
    expect(denied.statusCode).toBe(403);

    // The same super-admin as a session caller (no scope) bypasses the rule —
    // proving the scope, not the role, decides.
    const allowed = await handler.deleteEntry({
      collectionName: "posts",
      entryId: id,
      userId: "admin",
      userRoles: ["super-admin"],
    });
    expect(allowed.success).toBe(true);
  });

  it("skips the super-admin bypass for a scoped key on the update gate (version labels)", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          access: { read: () => true, update: () => false },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "t" }
    );
    const id = (created.data as { id: string }).id;

    // `canUpdateEntry` is the gate `assertVersionDocumentUpdatable` runs before a
    // version-label edit. A super-admin owning an update-scoped key: the scope
    // reaches the gate, the super-admin bypass is skipped, and the refusing rule
    // applies — the key may NOT edit labels.
    const scopedCanUpdate = await handler.canUpdateEntry({
      collectionName: "posts",
      entryId: id,
      user: { id: "admin", roles: ["super-admin"] },
      authenticatedScope: {
        actorType: "apiKey",
        permissions: ["update-posts"],
      },
    });
    expect(scopedCanUpdate).toBe(false);

    // The same super-admin as a session caller bypasses the rule.
    const sessionCanUpdate = await handler.canUpdateEntry({
      collectionName: "posts",
      entryId: id,
      user: { id: "admin", roles: ["super-admin"] },
    });
    expect(sessionCanUpdate).toBe(true);
  });

  it("judges the duplicate source read on the key's own read grant", async () => {
    // A duplicate copies the source row's fields, so the source must be readable
    // under the KEY's scope. A super-admin-owned key scoped for create but not
    // read must not be able to copy from a row it cannot see.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const source = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "source" }
    );
    const sourceId = (source.data as { id: string }).id;

    // create-only scope, no read: the source read is judged on the key and
    // refused (the super-admin bypass is skipped because the scope reaches it).
    const denied = await handler.duplicateEntry({
      collectionName: "posts",
      entryId: sourceId,
      userId: "admin",
      userRoles: ["super-admin"],
      authenticatedScope: {
        actorType: "apiKey",
        permissions: ["create-posts"],
      },
    });
    expect(denied.success).toBe(false);

    // Adding read to the scope lets the source read pass, and the create
    // proceeds.
    const allowed = await handler.duplicateEntry({
      collectionName: "posts",
      entryId: sourceId,
      userId: "admin",
      userRoles: ["super-admin"],
      authenticatedScope: {
        actorType: "apiKey",
        permissions: ["create-posts", "read-posts"],
      },
    });
    expect(allowed.success).toBe(true);
  });

  it("judges a scoped key on delete-by-query, not the owner session", async () => {
    // A where-clause delete gates the collection, enumerates under the delete
    // owner rule, then deletes per row. A super-admin-owned delete-scoped key
    // must be judged on the key at every step, so a code rule refusing delete
    // still applies (the super-admin bypass is skipped because the scope reaches
    // the collection gate, the owner-predicate enumeration, and each per-row
    // delete). Collection-wide denial is a request-level 403, so the scoped key
    // is rejected before any row is enumerated or removed.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          access: { read: () => true, delete: () => false },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "t" }
    );

    // The scope reaches the collection gate, the super-admin bypass is skipped,
    // and the refusing delete rule rejects the request (nothing is deleted).
    await expect(
      handler.bulkDeleteByQuery({
        collectionName: "posts",
        where: { and: [{ column: "title", op: "=", value: "t" }] },
        user: { id: "admin", roles: ["super-admin"] },
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["delete-posts"],
        },
      })
    ).rejects.toThrow();

    // The same super-admin as a session caller (no scope) bypasses the rule and
    // deletes the still-present row — proving the scope, not the role, decides
    // and that the denied attempt left the row intact.
    const allowed = await handler.bulkDeleteByQuery({
      collectionName: "posts",
      where: { and: [{ column: "title", op: "=", value: "t" }] },
      user: { id: "admin", roles: ["super-admin"] },
    });
    expect(allowed.successCount).toBe(1);
  });

  it("judges a scoped key on the batch publish pre-resolve, not the owner", async () => {
    // The array batch worker pre-resolves the caller's publish authorization ONCE
    // before the transaction. That pre-resolve must carry the API-key scope, or a
    // super-admin-owned key scoped only for update could publish a whole batch via
    // the owner's bypass.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          // Update is allowed; publish is refused by a code rule. A session
          // super-admin bypasses it, but a scoped key must be judged on the key.
          access: {
            read: () => true,
            create: () => true,
            update: () => true,
            publish: () => false,
          },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const entryService = current
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService();

    const seeded = await entryService.createEntries(
      { collectionName: "posts", overrideAccess: true },
      [{ title: "a", status: "draft" }]
    );
    const [id] = seeded.ids;

    // Super-admin owner of an update-only scoped key batch-publishes: the scope
    // reaches the pre-resolve, the super-admin bypass is skipped, and the refusing
    // publish rule applies — the row fails.
    const denied = await entryService.updateEntries(
      {
        collectionName: "posts",
        user: { id: "admin", roles: ["super-admin"] },
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["update-posts"],
        },
      },
      [{ id, data: { status: "published" } }]
    );
    expect(denied.successful).toBe(0);
    expect(denied.failed).toBe(1);

    // The same super-admin as a session caller (no scope) bypasses the rule —
    // proving the scope, not the role, decides the batch publish.
    const allowed = await entryService.updateEntries(
      {
        collectionName: "posts",
        user: { id: "admin", roles: ["super-admin"] },
      },
      [{ id, data: { status: "published" } }]
    );
    expect(allowed.successful).toBe(1);
    expect(allowed.failed).toBe(0);
  });
});
