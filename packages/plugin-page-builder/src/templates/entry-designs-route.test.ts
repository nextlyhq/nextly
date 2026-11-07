/**
 * The entry designs read with its reads injected: the caller's rights asked
 * before anything is read, own designs kept only where the caller may read
 * their entries, one entry's own design answered by its key rather than
 * from the capped list, what the caller is offered, and what a template's
 * screens ask about.
 *
 * Against a real instance, access included, is the integration suite's.
 */
import { describe, expect, it, vi } from "vitest";

import {
  askOfTemplate,
  readEntryDesigns,
  type EntryDesignsAsk,
  type EntryDesignsReads,
} from "./entry-designs-route";
import type { TemplateGuardSetup } from "./template-guard";

/** A collection record with an address field, so it may have a template. */
const POSTS = {
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [{ name: "slug", type: "text" }],
};

const ALL_RIGHTS = {
  "read-posts": true,
  "read-templates": true,
  "create-templates": true,
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

function design(id: string, entryId: string): Record<string, unknown> {
  return { id, title: `Design of ${entryId}`, status: "draft", entryId };
}

function reads(
  rights: Record<string, boolean>,
  rows: {
    base?: Record<string, unknown>[];
    designs?: Record<string, unknown>[];
  } = {},
  /** The entries the caller may read; every one when absent. */
  readable?: readonly string[]
) {
  const templates = vi.fn<EntryDesignsReads["templates"]>(args =>
    Promise.resolve({
      rows:
        "collection" in args.where ? (rows.base ?? []) : (rows.designs ?? []),
      hasNext: false,
    })
  );
  const readableEntries = vi.fn<EntryDesignsReads["readableEntries"]>(
    (_collection, ids) =>
      Promise.resolve(
        new Set(
          ids.filter(id => readable === undefined || readable.includes(id))
        )
      )
  );
  const injected: EntryDesignsReads = {
    can: (action, slug) =>
      Promise.resolve(rights[`${action}-${slug}`] === true),
    template: id =>
      Promise.resolve(
        id === "d1"
          ? { id, collection: null, entryCollection: "posts", entryId: "p1" }
          : id === "t1"
            ? { id, collection: "posts" }
            : null
      ),
    templates,
    readableEntries,
  };
  return { injected, templates, readableEntries };
}

const POSTS_ASK: EntryDesignsAsk = { collection: "posts" };

describe("readEntryDesigns", () => {
  it("reads nothing of a collection the caller may not read", async () => {
    const { setup, readCollection } = guard();
    const { injected, templates } = reads({ "read-templates": true });
    const answer = await readEntryDesigns(POSTS_ASK, setup, injected);

    expect(answer.items).toEqual([]);
    expect(answer.meta.template).toBeNull();
    expect(answer.meta.templateReadable).toBe(false);
    expect(readCollection).not.toHaveBeenCalled();
    expect(templates).not.toHaveBeenCalled();
  });

  it("says the template was withheld from a caller who may not read templates", async () => {
    const { setup } = guard();
    const { injected, templates } = reads({
      "read-posts": true,
      "create-templates": true,
    });
    const answer = await readEntryDesigns(POSTS_ASK, setup, injected);

    expect(templates).not.toHaveBeenCalled();
    // Withheld, not absent: a surface must not read this as "no template".
    expect(answer.meta).toMatchObject({
      template: null,
      templateReadable: false,
      mayCreateTemplate: false,
      mayGiveDesign: false,
    });
  });

  it("keeps only the own designs of entries the caller may read, in one read", async () => {
    const { setup } = guard();
    const { injected, readableEntries } = reads(
      ALL_RIGHTS,
      { designs: [design("d1", "p1"), design("d2", "p2")] },
      ["p2"]
    );
    const answer = await readEntryDesigns(POSTS_ASK, setup, injected);

    // A read that trusted the collection-level right would list both.
    expect(answer.items.map(item => item.entryId)).toEqual(["p2"]);
    expect(answer.meta.total).toBe(1);
    expect(readableEntries).toHaveBeenCalledTimes(1);
    expect(readableEntries).toHaveBeenCalledWith("posts", ["p1", "p2"]);
  });

  it("answers one entry's own design by its key, not from the capped list", async () => {
    const { setup } = guard();
    const { injected, templates } = reads(ALL_RIGHTS, {
      designs: [design("d1", "p1")],
    });
    const answer = await readEntryDesigns(
      { collection: "posts", entry: "p1" },
      setup,
      injected
    );

    expect(answer.meta.entry).toBe("p1");
    expect(answer.items.map(item => item.id)).toEqual(["d1"]);
    expect(templates).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entry: { equals: "posts/p1" } },
        limit: 1,
      })
    );
  });

  it("answers the template, and offers an own design only while it is published", async () => {
    const { setup } = guard();
    const published = reads(ALL_RIGHTS, {
      base: [{ id: 5, title: "Blog post", status: "published" }],
    });
    const live = await readEntryDesigns(POSTS_ASK, setup, published.injected);
    expect(live.meta).toMatchObject({
      template: { id: "5", title: "Blog post", status: "published" },
      templateReadable: true,
      mayGiveDesign: true,
      // There is one already, so another is not offered.
      mayCreateTemplate: false,
    });

    const draft = reads(ALL_RIGHTS, {
      base: [{ id: 5, title: "Blog post", status: "draft" }],
    });
    const notLive = await readEntryDesigns(POSTS_ASK, setup, draft.injected);
    expect(notLive.meta.mayGiveDesign).toBe(false);
    expect(notLive.meta.mayCreateTemplate).toBe(false);

    const none = reads(ALL_RIGHTS);
    const empty = await readEntryDesigns(POSTS_ASK, setup, none.injected);
    expect(empty.meta.mayCreateTemplate).toBe(true);
    expect(empty.meta.mayGiveDesign).toBe(false);
  });

  it("offers no template on a collection that cannot have one", async () => {
    const { setup } = guard({ slug: "tags", fields: [] });
    const { injected } = reads({
      "read-tags": true,
      "read-templates": true,
      "create-templates": true,
    });
    const answer = await readEntryDesigns(
      { collection: "tags" },
      setup,
      injected
    );
    expect(answer.meta.templateAllowed).toBe(false);
    expect(answer.meta.mayCreateTemplate).toBe(false);
  });
});

describe("askOfTemplate", () => {
  it("asks about a collection's template's collection, and an own design's entry alone", async () => {
    const { injected } = reads({});
    expect(await askOfTemplate("t1", injected)).toEqual({
      collection: "posts",
    });
    expect(await askOfTemplate("d1", injected)).toEqual({
      collection: "posts",
      entry: "p1",
    });
    expect(await askOfTemplate("hidden", injected)).toEqual({
      collection: "",
    });
  });
});
