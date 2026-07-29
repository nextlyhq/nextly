/**
 * Populating a relationship asks the TARGET collection whether this caller may
 * read it.
 *
 * A related row belongs to another collection and carries that collection's own
 * read rules. Expansion selected it straight from its table and applied only
 * field-level redaction, so a caller refused the collection outright still
 * obtained its rows by populating a relationship that pointed at them: the
 * same row a direct read of the target answered with 403.
 *
 * The refusal reads as an ABSENT relationship rather than an error: one
 * unreadable reference must not refuse the whole parent read, and the caller
 * learns no more than a reference pointing at nothing would tell them.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { defineCollection, relationship, text } from "../../../config";
import { clearServices } from "../../../di/register";
import { seedBuilderCollection } from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { CollectionAccessService } from "../services/collection-access-service";
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

const RULE_PATH = new URL("./_fixtures/tenant-read-rule.ts", import.meta.url)
  .pathname;

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

  // `claim-aware` without a matching tenant claim is refused outright.
  await current.adapter.update(
    "dynamic_collections",
    { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
    { and: [{ column: "slug", op: "=", value: "pages" }] }
  );

  return { handler, refId: (ref.data as { id: string }).id, pageId };
}

describe("related-row collection access (integration)", () => {
  it("does not populate a target the caller may not read", async () => {
    const { handler, refId, pageId } = await boot();

    // The same caller, reading the target directly, is refused.
    const direct = await handler.getEntry({
      collectionName: "pages",
      entryId: pageId,
      user: { id: "claim-aware" },
      routeAuthorized: true,
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

  // The mirror, and the reason the case above is not enough on its own:
  // enforcing without a threaded caller judges everyone anonymous and hides
  // the row from callers the rule admits, which no leak test would catch.
  it("still populates the target for a caller the rule admits", async () => {
    const { handler, refId } = await boot();

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
      // The fixture returns `true` for any other caller.
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

const ID_RULE_PATH = new URL(
  "./_fixtures/related-target-read-rule.ts",
  import.meta.url
).pathname;

/** The id the id-keyed rule withholds. */
const BLOCKED_ID = "11111111-1111-4111-8111-111111111111";

describe("related-row collection access — many-to-many (integration)", () => {
  /**
   * A many-to-many field reaches its targets through a junction table, which
   * only the Schema-Builder shape produces — a code-first `hasMany: true`
   * stores a JSON array on the parent row and never touches that path. Seeded
   * the way the Builder stores it so the junction fetches are the ones under
   * test.
   */
  async function seedM2M(): Promise<{
    rel: CollectionRelationshipService;
    postId: string;
  }> {
    current = await createTestNextly({});
    const adapter = current.adapter;

    await seedBuilderCollection(adapter, {
      slug: "tags",
      fields: [{ name: "name", type: "text" }],
    });
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

    clearServices();
    current = await createTestNextly({ adapter });
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

    await adapter.update(
      "dynamic_collections",
      {
        access_rules: { read: { type: "custom", functionPath: ID_RULE_PATH } },
      },
      { and: [{ column: "slug", op: "=", value: "tags" }] }
    );

    return { rel, postId: "post-1" };
  }

  it("does not populate many-to-many targets the caller may not read", async () => {
    const { rel, postId } = await seedM2M();

    // The single-entry junction fetch.
    const expanded = await rel.expandRelationships(
      { id: postId, title: "Hello", slug: "hello" },
      "posts",
      [M2M_FIELD],
      { depth: 1, enforceFieldAccess: true, user: { id: "denied" } }
    );
    expect(JSON.stringify(expanded.tags ?? [])).not.toContain("Restricted tag");

    // The batched junction fetch the list path uses.
    const batched = await rel.batchFetchManyToManyRelations(
      "posts",
      [postId],
      M2M_FIELD,
      { enforceFieldAccess: true, user: { id: "denied" } }
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
      { depth: 1, enforceFieldAccess: true, user: { id: "permitted" } }
    );
    expect(JSON.stringify(expanded.tags)).toContain("Restricted tag");

    const batched = await rel.batchFetchManyToManyRelations(
      "posts",
      [postId],
      M2M_FIELD,
      { enforceFieldAccess: true, user: { id: "permitted" } }
    );
    expect(JSON.stringify(batched.get(postId))).toContain("Restricted tag");
  });
});

describe("related-row collection access — per-document rules (integration)", () => {
  async function bootIdRule(): Promise<{
    handler: CollectionsHandler;
    refId: string;
    pageId: string;
  }> {
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "pages", fields: [text({ name: "title" })] }),
        defineCollection({
          slug: "refs",
          fields: [
            text({ name: "name" }),
            relationship({ name: "target", relationTo: "pages" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const page = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "Blocked page" }
    );
    const pageId = (page.data as { id: string }).id;
    const ref = await handler.createEntry(
      { collectionName: "refs", overrideAccess: true },
      { name: "r", target: pageId }
    );
    await current.adapter.update(
      "dynamic_collections",
      {
        access_rules: { read: { type: "custom", functionPath: ID_RULE_PATH } },
      },
      { and: [{ column: "slug", op: "=", value: "pages" }] }
    );
    return { handler, refId: (ref.data as { id: string }).id, pageId };
  }

  // A rule reading the id decides nothing useful when the id never arrives,
  // and an exclusion inverts: `undefined !== blocked` admits the row the rule
  // exists to withhold.
  it("gives an id-keyed rule the related document's id", async () => {
    const { handler, refId, pageId } = await bootIdRule();

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
      user: { id: "blocked-one", blockedId: pageId },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.data)).not.toContain("Blocked page");
  });

  // The mirror: the same rule and the same caller, blocking a DIFFERENT id.
  // Without it the case above would pass just as well if the row were hidden
  // for any other reason, including the relationship never populating.
  it("populates a row the same rule does not block", async () => {
    const { handler, refId } = await bootIdRule();

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
      user: { id: "blocked-one", blockedId: "some-other-id" },
      routeAuthorized: true,
    });

    expect(JSON.stringify(result.data)).toContain("Blocked page");
  });
});

describe("related-row collection access — owner-only targets (integration)", () => {
  async function bootOwnerOnly(): Promise<{
    handler: CollectionsHandler;
    refId: string;
  }> {
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "notes", fields: [text({ name: "title" })] }),
        defineCollection({
          slug: "refs",
          fields: [
            text({ name: "name" }),
            relationship({ name: "target", relationTo: "notes" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const note = await handler.createEntry(
      {
        collectionName: "notes",
        user: { id: "owner-1" },
        routeAuthorized: true,
      },
      { title: "Owned note" }
    );
    const ref = await handler.createEntry(
      { collectionName: "refs", overrideAccess: true },
      { name: "r", target: (note.data as { id: string }).id }
    );
    await current.adapter.update(
      "dynamic_collections",
      { access_rules: { read: { type: "owner-only" } } },
      { and: [{ column: "slug", op: "=", value: "notes" }] }
    );
    return { handler, refId: (ref.data as { id: string }).id };
  }

  // An owner-only rule answers with a predicate rather than a verdict. Treating
  // every such target as denied would stop an owner populating their OWN row,
  // which is a rule they satisfy.
  it("populates an owner-only target for its owner", async () => {
    const { handler, refId } = await bootOwnerOnly();

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
      user: { id: "owner-1" },
      routeAuthorized: true,
    });

    expect(JSON.stringify(result.data)).toContain("Owned note");
  });

  it("withholds it from anyone else", async () => {
    const { handler, refId } = await bootOwnerOnly();

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
      user: { id: "someone-else" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.data)).not.toContain("Owned note");
  });
});

describe("related-row collection access — policy resolution (integration)", () => {
  // The policy is a collection-wide fact, but resolving it costs a metadata
  // read, and expansion fetches its references concurrently and recursively.
  // `getOwnerConstraint` runs once per resolution and nowhere else, so counting
  // it counts resolutions.
  it("resolves a target's policy once across a nested expansion", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "orgs", fields: [text({ name: "title" })] }),
        defineCollection({
          slug: "authors",
          fields: [
            text({ name: "title" }),
            relationship({ name: "org", relationTo: "orgs" }),
          ],
        }),
        defineCollection({
          slug: "posts",
          fields: [
            text({ name: "title" }),
            relationship({
              name: "authors",
              relationTo: "authors",
              hasMany: true,
            }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const org = await handler.createEntry(
      { collectionName: "orgs", overrideAccess: true },
      { title: "Acme" }
    );
    const orgId = (org.data as { id: string }).id;

    // Several authors, all pointing at the SAME org: without a shared cache
    // each of them resolves that org's policy on its own.
    const authorIds: string[] = [];
    for (const name of ["a", "b", "c", "d", "e"]) {
      const author = await handler.createEntry(
        { collectionName: "authors", overrideAccess: true },
        { title: name, org: orgId }
      );
      authorIds.push((author.data as { id: string }).id);
    }
    const post = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "Post", authors: authorIds }
    );

    const spy = vi.spyOn(
      CollectionAccessService.prototype,
      "getOwnerConstraint"
    );
    try {
      const result = await handler.getEntry({
        collectionName: "posts",
        entryId: (post.data as { id: string }).id,
        depth: 2,
        user: { id: "reader-1" },
        routeAuthorized: true,
      });
      expect(result.success).toBe(true);

      // The second hop ran, so the count below describes a real nested walk
      // rather than an expansion that stopped at the first level.
      expect(JSON.stringify(result.data)).toContain("Acme");

      const orgResolutions = spy.mock.calls.filter(
        call => call[0] === "orgs"
      ).length;
      expect(orgResolutions).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("related-row collection access — query predicates (integration)", () => {
  async function bootTenantScoped(): Promise<{
    handler: CollectionsHandler;
    mineRefId: string;
    theirsRefId: string;
  }> {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          fields: [text({ name: "title" }), text({ name: "tenant" })],
        }),
        defineCollection({
          slug: "refs",
          fields: [
            text({ name: "name" }),
            relationship({ name: "target", relationTo: "pages" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const mine = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "My page", tenant: "acme" }
    );
    const theirs = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "Their page", tenant: "other" }
    );
    const mineRef = await handler.createEntry(
      { collectionName: "refs", overrideAccess: true },
      { name: "mine", target: (mine.data as { id: string }).id }
    );
    const theirsRef = await handler.createEntry(
      { collectionName: "refs", overrideAccess: true },
      { name: "theirs", target: (theirs.data as { id: string }).id }
    );
    await current.adapter.update(
      "dynamic_collections",
      {
        access_rules: { read: { type: "custom", functionPath: ID_RULE_PATH } },
      },
      { and: [{ column: "slug", op: "=", value: "pages" }] }
    );
    return {
      handler,
      mineRefId: (mineRef.data as { id: string }).id,
      theirsRefId: (theirsRef.data as { id: string }).id,
    };
  }

  const scopedCaller = { id: "tenant-scoped", tenant: "acme" };

  // A rule may answer with a predicate rather than a verdict. Treating that as
  // a denial hides rows the rule admits; treating it as an allow hands back
  // rows it excludes. The predicate has to actually narrow.
  it("populates a row the predicate admits", async () => {
    const { handler, mineRefId } = await bootTenantScoped();

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: mineRefId,
      depth: 1,
      user: scopedCaller,
      routeAuthorized: true,
    });

    expect(JSON.stringify(result.data)).toContain("My page");
  });

  it("withholds a row the same predicate excludes", async () => {
    const { handler, theirsRefId } = await bootTenantScoped();

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: theirsRefId,
      depth: 1,
      user: scopedCaller,
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.data)).not.toContain("Their page");
  });
});
