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

  it("gates a default-locale companion publish when the main row is already published", async () => {
    // For a localized collection the default locale's status also lands on the
    // companion `_status`. When the main row is already published but the
    // default-locale companion `_status` diverged to draft (a state reachable
    // after a reconcile), a `?locale=<default>` publish moves the companion into
    // published and must still require the publish permission — the guard cannot
    // key on the main row alone (published -> published).
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "docs",
          localized: true,
          status: true,
          access: { publish: () => false },
          fields: [text({ name: "heading" })],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const adapter = current.adapter as unknown as {
      executeQuery: (sql: string) => Promise<unknown>;
    };

    // Trusted create publishes the default-locale entry: main row published,
    // companion `en` `_status` published.
    const created = await handler.createEntry(
      { collectionName: "docs", overrideAccess: true, locale: "en" },
      { heading: "H", status: "published" }
    );
    const id = (created.data as { id: string }).id;

    // Manufacture the divergence: main stays published, companion `en` drops to
    // draft (the post-reconcile state the guard has to defend).
    await adapter.executeQuery(
      `UPDATE "dc_docs_locales" SET "_status" = 'draft' WHERE "_parent" = '${id}' AND "_locale" = 'en'`
    );

    // A caller with update (route-attested) but not publish re-publishes the
    // default locale. The companion draft -> published transition must be denied.
    const denied = await handler.updateEntry(
      {
        collectionName: "docs",
        entryId: id,
        userId: "user-no-publish",
        routeAuthorized: true,
        locale: "en",
      },
      { heading: "H2", status: "published" }
    );

    expect(denied.success).toBe(false);
    expect(denied.statusCode).toBe(403);

    // The companion `_status` was not moved to published.
    const rows = (await adapter.executeQuery(
      `SELECT "_status" FROM "dc_docs_locales" WHERE "_parent" = '${id}' AND "_locale" = 'en'`
    )) as Array<{ _status: string }> | { rows?: Array<{ _status: string }> };
    const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
    expect(list[0]?._status).toBe("draft");
  });

  it("judges a scoped API-key publish on the key's own grant, not the owner's", async () => {
    // End-to-end threading: the dispatcher stamps the key's scoped permissions,
    // the handler forwards them, and the transition gate judges the key rather
    // than the key owner. A key scoped for update but not publish is refused; a
    // key scoped for publish is allowed — regardless of the owner's grants.
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
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "t", status: "draft" }
    );
    const id = (created.data as { id: string }).id;

    // Key scoped for `update-posts` only → publish denied.
    const denied = await handler.updateEntry(
      {
        collectionName: "posts",
        entryId: id,
        userId: "key-owner",
        routeAuthorized: true,
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["update-posts"],
        },
      },
      { status: "published" }
    );
    expect(denied.success).toBe(false);
    expect(denied.statusCode).toBe(403);

    // Same owner, key scoped WITH `publish-posts` → allowed.
    const allowed = await handler.updateEntry(
      {
        collectionName: "posts",
        entryId: id,
        userId: "key-owner",
        routeAuthorized: true,
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["update-posts", "publish-posts"],
        },
      },
      { status: "published" }
    );
    expect(allowed.success).toBe(true);
  });

  it("judges a scoped API-key create-as-published on the key's own grant", async () => {
    // The create path also gates publish (creating directly as published). A key
    // scoped for `create-posts` but not `publish-posts` cannot create a published
    // entry; adding `publish-posts` allows it — regardless of the owner's grants.
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

    const denied = await handler.createEntry(
      {
        collectionName: "posts",
        userId: "key-owner",
        routeAuthorized: true,
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["create-posts"],
        },
      },
      { title: "t", status: "published" }
    );
    expect(denied.success).toBe(false);
    expect(denied.statusCode).toBe(403);

    const allowed = await handler.createEntry(
      {
        collectionName: "posts",
        userId: "key-owner",
        routeAuthorized: true,
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["create-posts", "publish-posts"],
        },
      },
      { title: "t2", status: "published" }
    );
    expect(allowed.success).toBe(true);
  });

  it("does not let a code-defined access.publish be bypassed by a scoped key", async () => {
    // A scoped key holding `publish-posts` must still satisfy the collection's
    // code-defined `access.publish` rule — the grant is not a bypass.
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
        userId: "key-owner",
        routeAuthorized: true,
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["update-posts", "publish-posts"],
        },
      },
      { status: "published" }
    );
    expect(denied.success).toBe(false);
    expect(denied.statusCode).toBe(403);
  });

  it("route-authorizes publish-all's update gate for a scoped key", async () => {
    // publish-all runs a preliminary `update` gate before the publish check. For
    // a REST API-key request the route already authorized `update` on the key's
    // scope, so that gate must honor route authorization + the key scope rather
    // than fall back to the owner's RBAC (which the key owner lacks here).
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
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "t", status: "draft" }
    );
    const id = (created.data as { id: string }).id;

    const result = await handler.publishAllLocales({
      collectionName: "posts",
      entryId: id,
      userId: "key-owner",
      routeAuthorized: true,
      authenticatedScope: {
        actorType: "apiKey",
        permissions: ["update-posts", "publish-posts"],
      },
    });
    expect(result.success).toBe(true);
  });

  it("judges a scoped API-key BULK publish on the key's own grant", async () => {
    // A bulk update must not become a way around the single-write publish gate:
    // the per-id `updateEntry` each row runs through has to see the key's scope,
    // or an update-only key owned by a publisher could bulk-publish. A key
    // scoped for `update-posts` only is refused; adding `publish-posts` allows.
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
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "t", status: "draft" }
    );
    const id = (created.data as { id: string }).id;

    const denied = await handler.bulkUpdateEntries({
      collectionName: "posts",
      ids: [id],
      data: { status: "published" },
      userId: "key-owner",
      routeAuthorized: true,
      authenticatedScope: {
        actorType: "apiKey",
        permissions: ["update-posts"],
      },
    });
    // Partial-success shape: the row lands in failures with a 403, not successes.
    expect(denied.successCount).toBe(0);
    expect(denied.failures).toHaveLength(1);

    const allowed = await handler.bulkUpdateEntries({
      collectionName: "posts",
      ids: [id],
      data: { status: "published" },
      userId: "key-owner",
      routeAuthorized: true,
      authenticatedScope: {
        actorType: "apiKey",
        permissions: ["update-posts", "publish-posts"],
      },
    });
    expect(allowed.successCount).toBe(1);
  });
});
