/**
 * Reference hydration against a real database.
 *
 * The unit tests pin the walk and the fallbacks with a mocked read; this pins
 * the thing they cannot — that a stored relationship id resolves to the target's
 * real title through the same access-checked read a request uses, and that a
 * target the caller may not read comes back as its bare id with no label.
 */
import { afterEach, describe, expect, it } from "vitest";

import { diffDocumentVersions } from "../../../api/versions-access";
import { defineCollection, relationship, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { FieldDiff } from "../diff/types";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const superAdmin = { id: "root", roles: ["super-admin"] };

function idOf(result: { data?: unknown }): string {
  return (result.data as { id: string }).id;
}

/** Find a `value` node by field name anywhere in the diff tree. */
function findValue(
  fields: FieldDiff[],
  name: string
): Extract<FieldDiff, { kind: "value" }> | undefined {
  for (const node of fields) {
    if (node.kind === "value" && node.name === name) return node;
    if (node.kind === "group") {
      const hit = findValue(node.fields, name);
      if (hit) return hit;
    }
    if (node.kind === "list") {
      for (const item of node.items) {
        const hit = findValue(item.fields, name);
        if (hit) return hit;
      }
    }
  }
  return undefined;
}

/** Find a `set` node by field name at the top level of the diff tree. */
function findSet(
  fields: FieldDiff[],
  name: string
): Extract<FieldDiff, { kind: "set" }> | undefined {
  return fields.find(
    (n): n is Extract<FieldDiff, { kind: "set" }> =>
      n.kind === "set" && n.name === name
  );
}

const postsCollection = defineCollection({
  slug: "posts",
  versions: true,
  fields: [
    text({ name: "title" }),
    relationship({ name: "author", relationTo: "authors" }),
    relationship({ name: "tags", relationTo: "tags", hasMany: true }),
  ],
});

const tagsCollection = defineCollection({
  slug: "tags",
  fields: [text({ name: "title" })],
});

/** Authors readable by anyone. */
async function boot(): Promise<TestNextly> {
  return createTestNextly({
    collections: [
      defineCollection({ slug: "authors", fields: [text({ name: "title" })] }),
      tagsCollection,
      postsCollection,
    ],
  });
}

/** Authors readable by no one but a trusted (overrideAccess) call. */
async function bootRestrictedAuthors(): Promise<TestNextly> {
  return createTestNextly({
    collections: [
      defineCollection({
        slug: "authors",
        fields: [text({ name: "title" })],
        access: { read: () => false },
      }),
      tagsCollection,
      postsCollection,
    ],
  });
}

describe("version reference hydration (integration)", () => {
  it("resolves relationship ids in a diff to the targets' real labels", async () => {
    current = await boot();
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const ada = idOf(
      await handler.createEntry(
        { collectionName: "authors", overrideAccess: true },
        { title: "Ada" }
      )
    );
    const grace = idOf(
      await handler.createEntry(
        { collectionName: "authors", overrideAccess: true },
        { title: "Grace" }
      )
    );
    const design = idOf(
      await handler.createEntry(
        { collectionName: "tags", overrideAccess: true },
        { title: "Design" }
      )
    );
    const eng = idOf(
      await handler.createEntry(
        { collectionName: "tags", overrideAccess: true },
        { title: "Engineering" }
      )
    );

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "One", author: ada, tags: [design] }
    );
    const entryId = idOf(created);
    await handler.updateEntry(
      { collectionName: "posts", entryId, overrideAccess: true },
      { title: "Two", author: grace, tags: [design, eng] }
    );

    const diff = await diffDocumentVersions({
      scopeKind: "collection",
      slug: "posts",
      entryId,
      user: superAdmin,
      from: 1,
      to: 2,
    });

    const author = findValue(diff.fields, "author");
    expect(author?.before).toMatchObject({ id: ada, label: "Ada" });
    expect(author?.after).toMatchObject({ id: grace, label: "Grace" });

    const tags = findSet(diff.fields, "tags");
    expect(tags?.added.find(t => t.id === eng)?.label).toBe("Engineering");
  });

  it("withholds a label the caller may not read, keeping the id", async () => {
    // The authors collection denies reads, so resolution through the target's
    // own read rule leaves the id but no title for a non-trusted caller.
    current = await bootRestrictedAuthors();
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const ada = idOf(
      await handler.createEntry(
        { collectionName: "authors", overrideAccess: true },
        { title: "Ada" }
      )
    );
    const bob = idOf(
      await handler.createEntry(
        { collectionName: "authors", overrideAccess: true },
        { title: "Bob" }
      )
    );

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "One", author: ada }
    );
    const entryId = idOf(created);
    await handler.updateEntry(
      { collectionName: "posts", entryId, overrideAccess: true },
      { title: "Two", author: bob }
    );

    const editor = { id: "ed", roles: ["editor"] };
    const diff = await diffDocumentVersions({
      scopeKind: "collection",
      slug: "posts",
      entryId,
      user: editor,
      from: 1,
      to: 2,
    });

    const author = findValue(diff.fields, "author");
    expect(author?.before).toMatchObject({ id: ada, label: null });
    expect(author?.after).toMatchObject({ id: bob, label: null });
  });
});
