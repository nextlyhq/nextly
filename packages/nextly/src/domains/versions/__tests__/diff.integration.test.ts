/**
 * The diff endpoint over REAL captured snapshots. A change on each field kind
 * surfaces; an identical re-save surfaces nothing, which is what proves the
 * normalization absorbs each dialect's storage encoding (JSON-as-string chips,
 * 0/1 booleans, numeric strings); and comparing a version with itself is
 * refused. Runs against whichever dialect the integration run configures; CI
 * covers SQLite, Postgres, and MySQL.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  checkbox,
  chips,
  defineCollection,
  number,
  text,
} from "../../../config";
import { getVersionDiffForDocument } from "../../../dispatcher/handlers/versions-methods";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { FieldDiff } from "../diff/types";

const SUPER_ADMIN = { id: "system", roles: ["super-admin"] };

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

function nodeByName(fields: FieldDiff[], name: string): FieldDiff | undefined {
  return fields.find(f => f.name === name);
}

describe("version diff (integration)", () => {
  it("surfaces a change on each field kind, and records nothing for an identical re-save", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: true,
          fields: [
            text({ name: "title" }),
            number({ name: "views" }),
            checkbox({ name: "featured" }),
            chips({ name: "tags" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "First", views: 1, featured: false, tags: ["a", "b"] }
    );
    const id = (created.data as { id: string }).id;

    // v2 changes every field.
    await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { title: "Second", views: 2, featured: true, tags: ["b", "c"] }
    );
    // A re-save of v2's exact values reads back as v2 holds them, every field
    // kind included, so it changes nothing and records no v3.
    await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { title: "Second", views: 2, featured: true, tags: ["b", "c"] }
    );

    const changed = await getVersionDiffForDocument({
      scopeKind: "collection",
      slug: "posts",
      entryId: id,
      user: SUPER_ADMIN,
      from: 1,
      to: 2,
    });

    expect(changed.hasChanges).toBe(true);
    expect(nodeByName(changed.fields, "title")).toMatchObject({
      kind: "text",
      status: "changed",
    });
    expect(nodeByName(changed.fields, "views")).toMatchObject({
      kind: "value",
      status: "changed",
      before: 1,
      after: 2,
    });
    expect(nodeByName(changed.fields, "featured")?.status).toBe("changed");
    expect(nodeByName(changed.fields, "tags")?.status).toBe("changed");

    await expect(
      getVersionDiffForDocument({
        scopeKind: "collection",
        slug: "posts",
        entryId: id,
        user: SUPER_ADMIN,
        from: 2,
        to: 3,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("drops unchanged fields under modifiedOnly", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: true,
          fields: [text({ name: "title" }), text({ name: "body" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "A", body: "same" }
    );
    const id = (created.data as { id: string }).id;
    await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { title: "B", body: "same" }
    );

    const diff = await getVersionDiffForDocument({
      scopeKind: "collection",
      slug: "posts",
      entryId: id,
      user: SUPER_ADMIN,
      from: 1,
      to: 2,
      modifiedOnly: true,
    });

    const names = diff.fields.map(f => f.name);
    expect(names).toContain("title");
    expect(names).not.toContain("body");
  });

  it("names a field the reader may not read as hidden, and sends nothing of it", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: true,
          fields: [
            text({ name: "title", label: "Title" }),
            text({
              name: "codename",
              label: "Codename",
              access: { read: () => false },
            }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "First", codename: "falcon" }
    );
    const id = (created.data as { id: string }).id;
    await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { title: "Second", codename: "osprey" }
    );

    const diff = await getVersionDiffForDocument({
      scopeKind: "collection",
      slug: "posts",
      entryId: id,
      user: SUPER_ADMIN,
      from: 1,
      to: 2,
    });

    expect(nodeByName(diff.fields, "title")).toMatchObject({
      status: "changed",
      declaredLabel: "Title",
      path: [],
    });
    expect(nodeByName(diff.fields, "codename")).toEqual({
      kind: "hidden",
      reason: "no-access",
      name: "codename",
      label: "Codename",
      declaredLabel: "Codename",
      type: "text",
      status: "unchanged",
      path: [],
    });
    // The comparison says it left something out.
    expect(diff.incomplete).toBe(true);
    // Neither value reaches the reader, anywhere in the result.
    const wire = JSON.stringify(diff);
    expect(wire).not.toContain("falcon");
    expect(wire).not.toContain("osprey");
  });

  it("refuses to compare a version with itself", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "notes",
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "notes", overrideAccess: true },
      { title: "x" }
    );
    const id = (created.data as { id: string }).id;

    await expect(
      getVersionDiffForDocument({
        scopeKind: "collection",
        slug: "notes",
        entryId: id,
        user: SUPER_ADMIN,
        from: 1,
        to: 1,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
