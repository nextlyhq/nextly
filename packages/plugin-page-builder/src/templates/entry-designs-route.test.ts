/**
 * The entry designs read with its reads injected: the caller's rights asked
 * before anything is read, own designs kept only where the caller may read
 * their entries, one entry's own design answered by its key rather than
 * from the capped list, the own designs of a list's rows answered by their
 * keys in one read, what the caller is offered, what a template's screens
 * ask about, and the query the route accepts.
 *
 * Against a real instance, access included, is the integration suite's.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  ENTRY_DESIGNS_ENTRIES_MAX,
  ENTRY_DESIGNS_MAX,
  entryDesignsForEntriesPath,
} from "./entry-designs-contract";
import {
  askOfTemplate,
  ENTRY_DESIGNS_SCAN_PAGES,
  parseEntryDesignsQuery,
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

/**
 * `count` own designs, newest first, served a page at a time as core's find
 * serves them, with the entries the caller may read chosen by `readable`.
 */
function pagedReads(count: number, readable: (index: number) => boolean) {
  const rows = Array.from({ length: count }, (_, index) =>
    design(`d${String(index)}`, `p${String(index)}`)
  );
  const injected = reads(ALL_RIGHTS).injected;
  const templates = vi.fn<EntryDesignsReads["templates"]>(args => {
    if ("collection" in args.where) {
      return Promise.resolve({ rows: [], hasNext: false });
    }
    const start = ((args.page ?? 1) - 1) * args.limit;
    return Promise.resolve({
      rows: rows.slice(start, start + args.limit),
      hasNext: start + args.limit < rows.length,
    });
  });
  const readableEntries = vi.fn<EntryDesignsReads["readableEntries"]>(
    (_collection, ids) =>
      Promise.resolve(new Set(ids.filter(id => readable(Number(id.slice(1))))))
  );
  return {
    injected: { ...injected, templates, readableEntries },
    designPages: () =>
      templates.mock.calls
        .map(([args]) => args)
        .filter(args => !("collection" in args.where))
        .map(args => args.page),
  };
}

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

  it("reads past a first page that holds none the caller may read", async () => {
    // The newest page is all entries the caller may not read; the next holds
    // readable ones. A read that filtered one capped page would answer an
    // empty list, which the template's screens would say as "none".
    const { setup } = guard();
    const paged = pagedReads(
      ENTRY_DESIGNS_MAX + 100,
      index => index >= ENTRY_DESIGNS_MAX
    );
    const answer = await readEntryDesigns(POSTS_ASK, setup, paged.injected);

    expect(answer.items).toHaveLength(100);
    expect(answer.items[0]?.entryId).toBe(`p${String(ENTRY_DESIGNS_MAX)}`);
    expect(answer.meta.hasNext).toBe(false);
    expect(paged.designPages()).toEqual([1, 2]);
  });

  it("fills the bound across pages, and says more may exist while rows remain", async () => {
    // Every other entry is readable, so the bound fills on the second page
    // with a third still unread.
    const { setup } = guard();
    const paged = pagedReads(ENTRY_DESIGNS_MAX * 3, index => index % 2 === 0);
    const answer = await readEntryDesigns(POSTS_ASK, setup, paged.injected);

    expect(answer.items).toHaveLength(ENTRY_DESIGNS_MAX);
    expect(answer.meta.hasNext).toBe(true);
    expect(paged.designPages()).toEqual([1, 2]);
  });

  it("answers the whole list as whole once the rows run out", async () => {
    const { setup } = guard();
    const paged = pagedReads(ENTRY_DESIGNS_MAX, () => true);
    const answer = await readEntryDesigns(POSTS_ASK, setup, paged.injected);

    expect(answer.items).toHaveLength(ENTRY_DESIGNS_MAX);
    expect(answer.meta.hasNext).toBe(false);
    expect(paged.designPages()).toEqual([1]);
  });

  it("stops at the page ceiling and says more may exist, never that there are none", async () => {
    const { setup } = guard();
    const paged = pagedReads(
      ENTRY_DESIGNS_MAX * (ENTRY_DESIGNS_SCAN_PAGES + 1),
      () => false
    );
    const answer = await readEntryDesigns(POSTS_ASK, setup, paged.injected);

    expect(answer.items).toEqual([]);
    // Not definitive: the surfaces read this as "more may exist".
    expect(answer.meta.hasNext).toBe(true);
    expect(paged.designPages()).toHaveLength(ENTRY_DESIGNS_SCAN_PAGES);
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

describe("the own designs of some entries", () => {
  it("answers the entries asked about by their keys, in one read", async () => {
    const { setup } = guard();
    const { injected, templates } = reads(ALL_RIGHTS, {
      designs: [design("d7", "p7"), design("d9", "p9")],
    });
    const answer = await readEntryDesigns(
      { collection: "posts", entries: ["p7", "p8", "p9"] },
      setup,
      injected
    );

    expect(answer.items.map(item => item.entryId)).toEqual(["p7", "p9"]);
    // Answered for these entries in full: nothing past them is implied.
    expect(answer.meta.hasNext).toBe(false);
    const designReads = templates.mock.calls
      .map(([args]) => args)
      .filter(args => !("collection" in args.where));
    expect(designReads).toEqual([
      expect.objectContaining({
        where: { entry: { in: ["posts/p7", "posts/p8", "posts/p9"] } },
        limit: 3,
      }),
    ]);
  });

  it("keeps only the own designs of entries the caller may read", async () => {
    const { setup } = guard();
    const { injected, readableEntries } = reads(
      ALL_RIGHTS,
      { designs: [design("d7", "p7"), design("d9", "p9")] },
      ["p9"]
    );
    const answer = await readEntryDesigns(
      { collection: "posts", entries: ["p7", "p9"] },
      setup,
      injected
    );

    // A lookup that trusted the ids it was given would list both.
    expect(answer.items.map(item => item.entryId)).toEqual(["p9"]);
    expect(readableEntries).toHaveBeenCalledTimes(1);
    expect(readableEntries).toHaveBeenCalledWith("posts", ["p7", "p9"]);
  });

  it("reads nothing for a caller who may not read the collection", async () => {
    const { setup } = guard();
    const { injected, templates } = reads({ "read-templates": true });
    const answer = await readEntryDesigns(
      { collection: "posts", entries: ["p7"] },
      setup,
      injected
    );

    expect(answer.items).toEqual([]);
    expect(answer.meta.templateReadable).toBe(false);
    expect(templates).not.toHaveBeenCalled();
  });
});

describe("the route's query", () => {
  const BASE = "http://nextly.test/plugins/page-builder";

  /** The validation error a refused path throws, or a failure naming it. */
  function refused(path: string): NextlyError {
    try {
      parseEntryDesignsQuery(`${BASE}${path}`);
    } catch (error) {
      if (NextlyError.is(error)) return error;
      throw error;
    }
    throw new Error(`expected ${path} to be refused`);
  }

  it("reads a list's entries as the column asks for them", () => {
    // The positive control: every refusal below is satisfied by a parser
    // that refuses everything.
    expect(
      parseEntryDesignsQuery(
        `${BASE}${entryDesignsForEntriesPath("posts", ["p1", "p2"])}`
      )
    ).toEqual({ collection: "posts", entries: ["p1", "p2"] });
  });

  it("folds blanks and repeats, and keeps an id that needed encoding whole", () => {
    expect(
      parseEntryDesignsQuery(
        `${BASE}/templates/entry-designs?collection=posts&entries=a,,a,%20b`
      ).entries
    ).toEqual(["a", "b"]);
    expect(
      parseEntryDesignsQuery(
        `${BASE}${entryDesignsForEntriesPath("posts", ["a&b", "c d"])}`
      ).entries
    ).toEqual(["a&b", "c d"]);
  });

  it("takes a page's worth of entries, and refuses more rather than cutting", () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, index) => `p${String(index)}`);
    expect(
      parseEntryDesignsQuery(
        `${BASE}${entryDesignsForEntriesPath("posts", ids(ENTRY_DESIGNS_ENTRIES_MAX))}`
      ).entries
    ).toHaveLength(ENTRY_DESIGNS_ENTRIES_MAX);
    expect(
      refused(
        entryDesignsForEntriesPath("posts", ids(ENTRY_DESIGNS_ENTRIES_MAX + 1))
      ).code
    ).toBe("VALIDATION_ERROR");
  });

  it("refuses entries without their collection, beside an entry, or none at all", () => {
    expect(
      refused("/templates/entry-designs?template=t1&entries=p1").code
    ).toBe("VALIDATION_ERROR");
    expect(
      refused("/templates/entry-designs?collection=posts&entry=p1&entries=p2")
        .code
    ).toBe("VALIDATION_ERROR");
    expect(
      refused("/templates/entry-designs?collection=posts&entries=,").code
    ).toBe("VALIDATION_ERROR");
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
