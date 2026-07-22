/**
 * The publish gate must enforce on the REST/dispatcher path.
 *
 * The dispatcher talks to the DI `CollectionsHandler`, which builds its own
 * `CollectionEntryService`. If that instance is constructed without the RBAC
 * service, `checkCollectionAccess` has no permission store and a missing stored
 * `publish` rule defaults to public — so an authenticated caller who cleared the
 * route's `update` check could publish without `publish-<slug>`. This pins the
 * wiring: a route-authorized update (the dispatcher attests `update`, never
 * `publish`) that moves the document into published is refused for a user who
 * holds no `publish` permission.
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

describe("publish enforcement on the dispatcher path (RBAC wiring)", () => {
  it("refuses a route-authorized publish for a caller without publish permission", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    // Set up a draft through a trusted write.
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "t", status: "draft" }
    );
    const id = (created.data as { id: string }).id;

    // The dispatcher route-authorizes the write as `update` (never `publish`),
    // so the update RBAC re-check is skipped but the publish transition must
    // still be checked at the service. This user holds no publish permission.
    const denied = await handler.updateEntry(
      {
        collectionName: "posts",
        entryId: id,
        userId: "user-no-publish",
        routeAuthorized: true,
      },
      { status: "published" }
    );

    expect(denied.success).toBe(false);
    expect(denied.statusCode).toBe(403);

    // A trusted (overrideAccess) publish still succeeds — the gate is not
    // blanket-denying, it is enforcing the missing permission.
    const allowed = await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { status: "published" }
    );
    expect(allowed.success).toBe(true);
  });

  it("evaluates a code-defined publish rule from defineCollection access", async () => {
    // The `access.publish` rule is only expressible because CollectionAccessControl
    // now declares `publish`; the runtime resolves it through the same access
    // pipeline. A code-defined publish denial must block the transition.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          access: { publish: () => false },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "t", status: "draft" }
    );
    const id = (created.data as { id: string }).id;

    const denied = await handler.updateEntry(
      {
        collectionName: "posts",
        entryId: id,
        userId: "user-1",
        routeAuthorized: true,
      },
      { status: "published" }
    );

    expect(denied.success).toBe(false);
    expect(denied.statusCode).toBe(403);
  });

  it("does not demand publish for publish-all when the collection has no lifecycle", async () => {
    // publishAllLocales must return its "nothing to publish" no-op before the
    // publish permission check, so a caller with update but not publish is not
    // 403'd for a call that changes nothing.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          // No `status` lifecycle. Update is granted (so the base check passes)
          // but publish is not, so only the publish check could 403 here.
          access: { update: () => true },
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

    const result = await handler.publishAllLocales({
      collectionName: "posts",
      entryId: id,
      userId: "user-1",
    });

    expect(result.statusCode).not.toBe(403);
  });

  it("does not gate publish-all for a user field named status without lifecycle", async () => {
    // A collection without the draft/published lifecycle can still declare an
    // ordinary field named `status`. Its presence puts a `status` column in the
    // schema, but there is nothing to publish, so publish-all must no-op rather
    // than demand the publish permission. Gating on the lifecycle flag
    // (collection.status === true), not the mere existence of a `status` column,
    // is what makes this pass.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          // No lifecycle. `status` here is an ordinary user field, so the schema
          // carries a `status` column even though nothing is publishable.
          access: { update: () => true },
          fields: [text({ name: "title" }), text({ name: "status" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "t", status: "anything" }
    );
    const id = (created.data as { id: string }).id;

    const result = await handler.publishAllLocales({
      collectionName: "posts",
      entryId: id,
      userId: "user-1",
    });

    expect(result.statusCode).not.toBe(403);
  });
});
