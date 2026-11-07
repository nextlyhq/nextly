/**
 * The entry designs read with its reads injected: the caller's rights asked
 * before anything is read, the template and own designs shaped as the
 * surfaces read them, and a template's collection found through the row.
 *
 * Against a real instance, access included, is the integration suite's.
 */
import { describe, expect, it, vi } from "vitest";

import {
  collectionOfTemplate,
  readEntryDesigns,
  type EntryDesignsReads,
} from "./entry-designs-route";
import type { TemplateGuardSetup } from "./template-guard";

/** A collection record with an address field, so it may have a template. */
const POSTS = {
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [{ name: "slug", type: "text" }],
};

function guard(record: Record<string, unknown> | null = POSTS) {
  const readCollection = vi.fn(() => Promise.resolve(record));
  const setup: TemplateGuardSetup = {
    templatesCollection: "templates",
    ownCollections: () => new Set(["templates", "pages"]),
    readCollection,
    holderOf: () => Promise.resolve(null),
    entryExists: () => Promise.resolve(true),
  };
  return { setup, readCollection };
}

function reads(
  rights: Record<string, boolean>,
  rows: {
    base?: Record<string, unknown>[];
    designs?: Record<string, unknown>[];
  } = {}
) {
  const templates = vi.fn<EntryDesignsReads["templates"]>(args =>
    Promise.resolve({
      rows:
        "collection" in args.where ? (rows.base ?? []) : (rows.designs ?? []),
      hasNext: false,
    })
  );
  const injected: EntryDesignsReads = {
    can: (action, slug) =>
      Promise.resolve(rights[`${action}-${slug}`] === true),
    template: id =>
      Promise.resolve(
        id === "d1" ? { id, collection: null, entryCollection: "posts" } : null
      ),
    templates,
  };
  return { injected, templates };
}

describe("readEntryDesigns", () => {
  it("reads nothing of a collection the caller may not read", async () => {
    const { setup, readCollection } = guard();
    const { injected, templates } = reads({ "read-templates": true });
    const answer = await readEntryDesigns("posts", setup, injected);

    expect(answer.items).toEqual([]);
    expect(answer.meta.template).toBeNull();
    expect(answer.meta.names).toEqual({ singular: "posts", plural: "posts" });
    expect(readCollection).not.toHaveBeenCalled();
    expect(templates).not.toHaveBeenCalled();
  });

  it("finds no template for a caller who may not read templates", async () => {
    const { setup } = guard();
    const { injected, templates } = reads({
      "read-posts": true,
      "create-templates": true,
    });
    const answer = await readEntryDesigns("posts", setup, injected);

    expect(templates).not.toHaveBeenCalled();
    expect(answer.meta).toMatchObject({
      template: null,
      templateAllowed: true,
      mayCreateTemplate: false,
      names: { singular: "Post", plural: "Posts" },
    });
  });

  it("answers the template and the own designs, each by its entry", async () => {
    const { setup } = guard();
    const { injected, templates } = reads(
      { "read-posts": true, "read-templates": true, "create-templates": true },
      {
        base: [{ id: 5, title: "Blog post", status: "published" }],
        designs: [
          {
            id: "d1",
            title: "Hello",
            status: "draft",
            entryId: "p1",
            updatedAt: new Date("2026-11-07T09:00:00Z"),
          },
          // A row naming no entry is not an own design the surfaces can place.
          { id: "d2", title: "Stray", status: "published" },
        ],
      }
    );
    const answer = await readEntryDesigns("posts", setup, injected);

    expect(answer.meta.template).toEqual({
      id: "5",
      title: "Blog post",
      status: "published",
    });
    expect(answer.items).toEqual([
      {
        id: "d1",
        entryId: "p1",
        title: "Hello",
        status: "draft",
        updatedAt: "2026-11-07T09:00:00.000Z",
      },
    ]);
    // The own designs by the indexed field, newest edit first.
    expect(templates).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entryCollection: { equals: "posts" } },
        sort: ["-updatedAt", "id"],
      })
    );
  });

  it("offers no template on a collection that cannot have one", async () => {
    const { setup } = guard({ slug: "tags", fields: [] });
    const { injected } = reads({
      "read-tags": true,
      "read-templates": true,
      "create-templates": true,
    });
    const answer = await readEntryDesigns("tags", setup, injected);
    expect(answer.meta.templateAllowed).toBe(false);
    expect(answer.meta.mayCreateTemplate).toBe(false);
  });
});

describe("collectionOfTemplate", () => {
  it("answers the collection an own design's entry is in, and nothing for an unreadable one", async () => {
    const { injected } = reads({});
    expect(await collectionOfTemplate("d1", injected)).toBe("posts");
    expect(await collectionOfTemplate("hidden", injected)).toBe("");
  });
});
