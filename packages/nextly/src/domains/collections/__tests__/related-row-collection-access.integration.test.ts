/**
 * Populating a relationship asks the TARGET collection whether this caller may
 * read it.
 *
 * A related row belongs to another collection and carries that collection's own
 * `access.read`. Expansion selected it straight from its table and applied only
 * field-level redaction, so a caller the target refuses still obtained its rows
 * by populating a relationship that pointed at them — the same row a direct
 * read of the target answers with 403.
 *
 * The refusal reads as an ABSENT relationship rather than an error: one
 * unreadable reference must not refuse the whole parent read, and the caller
 * learns no more than a reference pointing at nothing would tell them.
 *
 * The leak case is not enough on its own, which is why each describe carries its
 * mirror: enforcing without a threaded caller judges everyone anonymous and
 * hides the row from callers the rule admits, and no leak test would catch that.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { apiKeyScope } from "../../../auth/authenticated-scope";
import { defineCollection, relationship, text } from "../../../config";
import { getDialectTables } from "../../../database/index";
import { clearServices } from "../../../di/register";
import { seedBuilderCollection } from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { CollectionRelationshipService } from "../services/collection-relationship-service";

/**
 * The Builder's many-to-many shape: the target lives on `options.target`, not
 * on `relationTo`, and the typed helper cannot express it.
 */
const M2M_FIELD = {
  name: "tags",
  type: "relationship",
  options: { relationType: "manyToMany", target: "tags" },
} as unknown as FieldDefinition;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Only `permitted` may read the collection this is declared on. */
const readableByPermitted = ({ user }: { user?: { id?: string } }): boolean =>
  user?.id === "permitted";

/**
 * `refs` points at the same restricted row twice: once through a field naming
 * several collections, once through an ordinary single-target field. The
 * single-target one is the control — the gap was never specific to multi-target
 * references, and a fix that closed only those would leave the same row
 * reachable through the field beside it.
 */
async function boot(): Promise<{
  handler: CollectionsHandler;
  refId: string;
  pageId: string;
}> {
  current = await createTestNextly({
    collections: [
      defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      defineCollection({
        slug: "pages",
        access: { read: readableByPermitted },
        fields: [text({ name: "title" }), text({ name: "tenant" })],
      }),
      defineCollection({
        slug: "refs",
        fields: [
          text({ name: "name" }),
          relationship({ name: "target", relationTo: ["posts", "pages"] }),
          relationship({ name: "plain", relationTo: "pages" }),
        ],
      }),
    ],
  });

  const handler = current.getService<CollectionsHandler>("collectionsHandler");
  const page = await handler.createEntry(
    { collectionName: "pages", overrideAccess: true },
    { title: "Restricted page", tenant: "acme" }
  );
  const pageId = (page.data as { id: string }).id;
  const ref = await handler.createEntry(
    { collectionName: "refs", overrideAccess: true },
    {
      name: "r",
      target: { relationTo: "pages", value: pageId },
      plain: pageId,
    }
  );

  return { handler, refId: (ref.data as { id: string }).id, pageId };
}

describe("related-row collection access (integration)", () => {
  it("does not populate a target the caller may not read", async () => {
    const { handler, refId, pageId } = await boot();

    // The control, and it has to RUN the gate to mean anything: a
    // route-authorized read skips the coarse check by design, so this one is
    // deliberately not route-authorized. Establishing the refusal first is what
    // makes the absent relationship below evidence rather than a reference that
    // merely failed to resolve.
    const direct = await handler.getEntry({
      collectionName: "pages",
      entryId: pageId,
      user: { id: "claim-aware" },
    });
    expect(direct.success).toBe(false);
    expect(direct.statusCode).toBe(403);

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
      user: { id: "claim-aware" },
      routeAuthorized: true,
    });

    // The parent read is still served.
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;

    // Neither shape hands back the row the direct read refused.
    expect(JSON.stringify(data.target ?? null)).not.toContain(
      "Restricted page"
    );
    expect(JSON.stringify(data.plain ?? null)).not.toContain("Restricted page");
  });

  it("still populates the target for a caller the rule admits", async () => {
    const { handler, refId } = await boot();

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
      user: { id: "permitted" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(JSON.stringify(data.target)).toContain("Restricted page");
    expect(JSON.stringify(data.plain)).toContain("Restricted page");
  });

  it("leaves a trusted read unfiltered", async () => {
    const { handler, refId } = await boot();

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
      overrideAccess: true,
    });

    const data = result.data as Record<string, unknown>;
    expect(JSON.stringify(data.target)).toContain("Restricted page");
    expect(JSON.stringify(data.plain)).toContain("Restricted page");
  });
});

describe("related-row collection access — many-to-many (integration)", () => {
  /**
   * A many-to-many field reaches its targets through a junction table, which
   * only the Schema-Builder shape produces — a code-first `hasMany: true`
   * stores a JSON array on the parent row and never touches that path. So the
   * PARENT is seeded the way the Builder stores it, to put the junction fetches
   * under test, while the TARGET stays code-first: a code-defined `access.read`
   * is the only thing that can refuse a caller now.
   */
  async function seedM2M(): Promise<{
    rel: CollectionRelationshipService;
    postId: string;
  }> {
    const tags = defineCollection({
      slug: "tags",
      access: { read: readableByPermitted },
      fields: [text({ name: "name" })],
    });

    current = await createTestNextly({ collections: [tags] });
    const adapter = current.adapter;

    await seedBuilderCollection(adapter, {
      slug: "posts",
      fields: [
        { name: "title", type: "text" },
        {
          name: "tags",
          type: "relationship",
          options: { relationType: "manyToMany", target: "tags" },
        },
      ],
    });

    // Re-boot against the same database so the Builder-seeded parent reaches
    // the registry, with the code-first target still declared so its rule stays
    // registered.
    clearServices();
    current = await createTestNextly({ adapter, collections: [tags] });
    current.getService("collectionService");
    const rel = current.getService<CollectionRelationshipService>(
      "relationshipService"
    );

    const nowEpoch = 1785330000;
    await adapter.executeQuery(
      `INSERT INTO dc_tags (id, title, slug, name, created_at, updated_at) VALUES ('tag-1', 'Restricted tag', 'restricted-tag', 'restricted', ${nowEpoch}, ${nowEpoch})`
    );
    await adapter.executeQuery(
      `INSERT INTO dc_posts (id, title, slug, created_at, updated_at) VALUES ('post-1', 'Hello', 'hello', ${nowEpoch}, ${nowEpoch})`
    );
    await rel.insertManyToManyRelations("posts", "post-1", M2M_FIELD, [
      "tag-1",
    ]);

    return { rel, postId: "post-1" };
  }

  it("does not populate many-to-many targets the caller may not read", async () => {
    const { rel, postId } = await seedM2M();

    // The single-entry junction fetch.
    const expanded = await rel.expandRelationships(
      { id: postId, title: "Hello", slug: "hello" },
      "posts",
      [M2M_FIELD],
      { depth: 1, enforceCollectionAccess: true, user: { id: "denied" } }
    );
    expect(JSON.stringify(expanded.tags ?? [])).not.toContain("Restricted tag");

    // The batched junction fetch the list path uses.
    const batched = await rel.batchFetchManyToManyRelations(
      "posts",
      [postId],
      M2M_FIELD,
      { enforceCollectionAccess: true, user: { id: "denied" } }
    );
    expect(JSON.stringify(batched.get(postId) ?? [])).not.toContain(
      "Restricted tag"
    );
  });

  it("still populates them for a caller the rule admits", async () => {
    const { rel, postId } = await seedM2M();

    const expanded = await rel.expandRelationships(
      { id: postId, title: "Hello", slug: "hello" },
      "posts",
      [M2M_FIELD],
      { depth: 1, enforceCollectionAccess: true, user: { id: "permitted" } }
    );
    expect(JSON.stringify(expanded.tags ?? [])).toContain("Restricted tag");
  });
});

describe("related-row collection access — rule context (integration)", () => {
  /**
   * A rule is shown the SAME context on expansion that a direct read shows it.
   *
   * The rules above read only `user.id`, which every path supplies. This one
   * reads the caller's effective permissions, which only the canonical context
   * — the one `checkAccess` builds from the database — carries for a session
   * caller. A narrower reconstruction admits by `user.id` and still fails
   * here, so the direct read is asserted first: a row the caller can read
   * directly but that vanishes from a relationship is the ghost this guards.
   */
  const readableWithPagesPermission = ({
    permissions,
  }: {
    permissions: string[];
  }): boolean => permissions.includes("pages:read");

  async function bootWithRole(): Promise<{
    handler: CollectionsHandler;
    refId: string;
    pageId: string;
    auditorId: string;
    strangerId: string;
  }> {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          access: { read: readableWithPagesPermission },
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

    const readPages = await current.nextly.permissions.create({
      data: {
        action: "read",
        resource: "pages",
        name: "Read pages",
        slug: "read-pages",
      },
    });
    const auditor = await current.nextly.roles.create({
      data: {
        name: "Auditor",
        slug: "auditor",
        permissionIds: [readPages.item.id],
      },
    });

    const auditorId = await createUser("auditor@example.com", auditor.item.id);
    const strangerId = await createUser("stranger@example.com");

    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const page = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "Audited page" }
    );
    const pageId = (page.data as { id: string }).id;
    const ref = await handler.createEntry(
      { collectionName: "refs", overrideAccess: true },
      { name: "r", plain: pageId }
    );

    return {
      handler,
      refId: (ref.data as { id: string }).id,
      pageId,
      auditorId,
      strangerId,
    };
  }

  /**
   * Inserts a user, granting it `roleId` when given. Written against drizzle
   * because the adapter's `insert` and `where` disagree on column naming.
   */
  async function createUser(email: string, roleId?: string): Promise<string> {
    const db = current!.adapter.getDrizzle() as unknown as {
      insert: (table: unknown) => {
        values: (row: unknown) => Promise<unknown>;
      };
    };
    const tables = getDialectTables();
    const userId = `user-${email}`;
    await db.insert(tables.users).values({
      id: userId,
      email,
      name: email,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    if (roleId) {
      await db.insert(tables.userRoles).values({
        id: `user-role-${email}`,
        userId,
        roleId,
        createdAt: new Date(),
      });
    }
    return userId;
  }

  it("shows the rule the caller's effective permissions, as a direct read does", async () => {
    const { handler, refId, pageId, auditorId } = await bootWithRole();

    // The direct read admits; what follows must agree with it.
    const direct = await handler.getEntry({
      collectionName: "pages",
      entryId: pageId,
      user: { id: auditorId },
    });
    expect(direct.success).toBe(true);

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
      user: { id: auditorId },
      routeAuthorized: true,
    });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(JSON.stringify(data.plain)).toContain("Audited page");
  });

  it("withholds the target from a caller whose permissions the rule refuses", async () => {
    const { handler, refId, pageId, strangerId } = await bootWithRole();

    const direct = await handler.getEntry({
      collectionName: "pages",
      entryId: pageId,
      user: { id: strangerId },
    });
    expect(direct.success).toBe(false);

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
      user: { id: strangerId },
      routeAuthorized: true,
    });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(JSON.stringify(data.plain)).not.toContain("Audited page");
  });
});

describe("related-row collection access — one verdict per target (integration)", () => {
  it("asks the target's rule once for a batch, however many rows it yields", async () => {
    // The verdict is per caller and target, not per row, so a rule that costs
    // something — a lookup, a call out — is paid once for the batch. A per-row
    // evaluation answers identically and is only visible in the count. The
    // LIST read is what batches: it collects every parent's reference and
    // fetches the targets in one query, so three parents put three rows in
    // front of one verdict.
    let evaluations = 0;
    const countingRule = (): boolean => {
      evaluations += 1;
      return true;
    };

    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          access: { read: countingRule },
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
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    for (const title of ["one", "two", "three"]) {
      const page = await handler.createEntry(
        { collectionName: "pages", overrideAccess: true },
        { title }
      );
      await handler.createEntry(
        { collectionName: "refs", overrideAccess: true },
        { name: `ref-${title}`, plain: (page.data as { id: string }).id }
      );
    }

    evaluations = 0;
    const result = await handler.listEntries({
      collectionName: "refs",
      depth: 1,
      user: { id: "anyone" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    const rows = (result.data as { docs: Array<{ plain?: unknown }> }).docs;
    // Every target arrived, so the single verdict really covered all three.
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(JSON.stringify(row.plain)).toContain("title");
    }
    expect(evaluations).toBe(1);
  });
});

describe("related-row collection access — anonymous readers (integration)", () => {
  /**
   * A visitor with no session is judged by the target's rule exactly as a
   * direct anonymous read of that target judges them: the rule is handed a
   * real anonymous context and its refusal stands. Otherwise a public parent
   * exposes, through a relationship, rows the same visitor is refused when
   * asking for them by name — so the direct read is asserted first, and the
   * relationship must agree with it.
   */
  async function bootAnonymous(pagesAccess: {
    read?: (ctx: { user?: { id?: string } | null }) => boolean;
  }): Promise<{ handler: CollectionsHandler; refId: string; pageId: string }> {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          access: pagesAccess,
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
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const page = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "Members page" }
    );
    const pageId = (page.data as { id: string }).id;
    const ref = await handler.createEntry(
      { collectionName: "refs", overrideAccess: true },
      { name: "r", plain: pageId }
    );
    return { handler, refId: (ref.data as { id: string }).id, pageId };
  }

  it("withholds a target whose rule refuses a caller with no session", async () => {
    const { handler, refId, pageId } = await bootAnonymous({
      read: ({ user }) => !!user,
    });

    // The direct door refuses the visitor; the relationship door must too.
    const direct = await handler.getEntry({
      collectionName: "pages",
      entryId: pageId,
    });
    expect(direct.success).toBe(false);

    // Authorization is a precondition: a refused target is never queried. The
    // schema load is the first thing a row read needs, so a target whose
    // schema was never loaded had no metadata read, no lifecycle resolution
    // and no select run on the refused caller's behalf.
    // The handler builds its own relationship service over its own file
    // manager, so that is the loader the expansion under test goes through.
    const loads = vi.spyOn(
      (handler as unknown as { fileManager: { loadDynamicSchema: unknown } })
        .fileManager,
      "loadDynamicSchema" as never
    );

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
    });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(JSON.stringify(data.plain)).not.toContain("Members page");
    expect(loads.mock.calls.map(call => call[0])).not.toContain("pages");

    // The control that the spy CAN see a target load: the same rule admits a
    // signed-in reader, whose expansion must reach the loader for `pages`.
    // Without this, a spy on the wrong object satisfies the assertion above
    // by seeing nothing at all.
    const admitted = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
      user: { id: "reader" },
      routeAuthorized: true,
    });
    expect(
      JSON.stringify((admitted.data as Record<string, unknown>).plain)
    ).toContain("Members page");
    expect(loads.mock.calls.map(call => call[0])).toContain("pages");
  });

  it("still populates a target that names no read rule", async () => {
    // The control: no rule is no opinion, and the visitor falls through to
    // the public default on both doors.
    const { handler, refId } = await bootAnonymous({});

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
    });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(JSON.stringify(data.plain)).toContain("Members page");
  });
});

describe("related-row collection access — API-key rule spelling (integration)", () => {
  it("shows a key's rule the same permission spelling a direct read shows it", async () => {
    // A rule reads `resource:action`; the key's scope stores `action-resource`.
    // The direct api-key gate converts before handing the rule its context, and
    // the relationship path must convert the same way — a copy of the stored
    // list makes the same row readable by name and absent by reference.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          access: {
            read: ({ permissions }: { permissions: string[] }) =>
              permissions.includes("pages:read"),
          },
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
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const page = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "Keyed page" }
    );
    const pageId = (page.data as { id: string }).id;
    const ref = await handler.createEntry(
      { collectionName: "refs", overrideAccess: true },
      { name: "r", plain: pageId }
    );

    const scope = apiKeyScope([
      { slug: "read-refs", action: "read", resource: "refs" },
      { slug: "read-pages", action: "read", resource: "pages" },
    ]);
    const key = { id: "key-owner", roles: [] as string[] };

    const direct = await handler.getEntry({
      collectionName: "pages",
      entryId: pageId,
      user: key,
      authenticatedScope: scope,
    });
    expect(direct.success).toBe(true);

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: (ref.data as { id: string }).id,
      depth: 1,
      user: key,
      authenticatedScope: scope,
      routeAuthorized: true,
    });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(JSON.stringify(data.plain)).toContain("Keyed page");
  });
});

describe("related-row collection access — one verdict per expansion (integration)", () => {
  it("asks the target's rule once for a hasMany field, however many references it holds", async () => {
    // The single-entry path fetches a `hasMany` field's references one at a
    // time and concurrently, so each fetch reaches the verdict on its own. The
    // verdict is cached for the expansion, so the rule is still asked once —
    // a rule that calls out somewhere is not called out five hundred times
    // for a five-hundred-reference field.
    let evaluations = 0;
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          access: {
            read: () => {
              evaluations += 1;
              return true;
            },
          },
          fields: [text({ name: "title" })],
        }),
        defineCollection({
          slug: "refs",
          fields: [
            text({ name: "name" }),
            relationship({ name: "many", relationTo: "pages", hasMany: true }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const pageIds: string[] = [];
    for (const title of ["one", "two", "three"]) {
      const page = await handler.createEntry(
        { collectionName: "pages", overrideAccess: true },
        { title }
      );
      pageIds.push((page.data as { id: string }).id);
    }
    const ref = await handler.createEntry(
      { collectionName: "refs", overrideAccess: true },
      { name: "r", many: pageIds }
    );

    evaluations = 0;
    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: (ref.data as { id: string }).id,
      depth: 1,
      user: { id: "anyone" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    const data = result.data as { many?: unknown[] };
    // Every reference arrived, so the one verdict really covered all three.
    expect(data.many).toHaveLength(3);
    expect(evaluations).toBe(1);
  });
});

describe("related-row collection access — API-key roles (integration)", () => {
  it("shows a key's rule the key's own roles, not its owner's", async () => {
    // A rule deciding on a role must see the KEY's roles, which arrive on its
    // scope; the user object names the owner. A Direct API or plugin caller
    // can hand over a user with no roles beside a scope that has them, and
    // the direct api-key gate reads the scope — so must the relationship.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          access: {
            read: ({ roles }: { roles: string[] }) => roles.includes("auditor"),
          },
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
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const page = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "Audited page" }
    );
    const pageId = (page.data as { id: string }).id;
    const ref = await handler.createEntry(
      { collectionName: "refs", overrideAccess: true },
      { name: "r", plain: pageId }
    );

    const scope = apiKeyScope(
      [
        { slug: "read-refs", action: "read", resource: "refs" },
        { slug: "read-pages", action: "read", resource: "pages" },
      ],
      ["auditor"]
    );
    // The owner carries no roles at all; only the key does.
    const key = { id: "key-owner" };

    const direct = await handler.getEntry({
      collectionName: "pages",
      entryId: pageId,
      user: key,
      authenticatedScope: scope,
    });
    expect(direct.success).toBe(true);

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: (ref.data as { id: string }).id,
      depth: 1,
      user: key,
      authenticatedScope: scope,
      routeAuthorized: true,
    });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(JSON.stringify(data.plain)).toContain("Audited page");
  });
});
