/**
 * A blocks write judged for the fields its collection lists name, as the
 * server judges it: in the write's language, and knowing which kind of
 * document the page is.
 */
import type { BindingFieldShape, ListFields } from "@nextlyhq/blocks-engine";
import type {
  PluginFieldValidateArgs,
  PluginFieldWrite,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  listFieldsFrom,
  newConditionIssues,
  newListQueryIssues,
  type TemplateTargets,
} from "./list-query-judgement";

const CATEGORIES: ListFields = {
  declared: new Set(["id", "name", "featured"]),
  readable: [
    { name: "id", type: "text" },
    { name: "name", type: "text" },
  ],
};

const POSTS: ListFields = {
  declared: new Set(["id", "title", "categories"]),
  readable: [
    { name: "id", type: "text" },
    { name: "title", type: "text" },
    {
      name: "categories",
      type: "relationship",
      relationTo: "categories",
      hasMany: true,
    },
  ],
};

const FIELDS: Readonly<Record<string, ListFields>> = {
  categories: CATEGORIES,
  posts: POSTS,
};

function args(write: Partial<PluginFieldWrite>): PluginFieldValidateArgs {
  return {
    data: {},
    req: {},
    path: "content",
    field: { name: "content", type: "blocks" },
    write: {
      kind: "collection",
      slug: "posts",
      inTransaction: false,
      readStored: async () => ({ kind: "absent" }),
      ...write,
    },
  } as unknown as PluginFieldValidateArgs;
}

const relatedToEntry = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "cats",
      type: "core/collection-loop",
      version: 1,
      props: {
        collection: "categories",
        relation: { of: "entry", field: "categories" },
      },
      slots: { children: [] },
    },
  ],
};

describe("a write's collection lists, judged by the server", () => {
  it("refuses a list of the entry's related entries on a Single, which has no entry", async () => {
    const fieldsOf = async (collection: string) => FIELDS[collection];
    const onSingle = await newListQueryIssues(
      relatedToEntry,
      args({ kind: "single", slug: "home" }),
      "Content",
      { fieldsOf }
    );
    expect(onSingle.map(issue => issue.code)).toEqual([
      "list-relation-no-entry",
    ]);
    // An entry of a collection holding that relation keeps it.
    expect(
      await newListQueryIssues(relatedToEntry, args({}), "Content", {
        fieldsOf,
      })
    ).toEqual([]);
  });

  it("judges a component's list of the entry's related entries by its shape, since the pages placing it are the entries", async () => {
    // The component store is a collection too, and holds no such relation.
    const STORE: ListFields = {
      declared: new Set(["id", "title", "content"]),
      readable: [{ name: "id", type: "text" }],
    };
    const fieldsOf = vi.fn(async (collection: string) =>
      collection === "nx_pb_components" ? STORE : FIELDS[collection]
    );
    const asComponent = { ...relatedToEntry, kind: "component" };
    expect(
      await newListQueryIssues(
        asComponent,
        args({ slug: "nx_pb_components", locale: "fr" }),
        "Content",
        { fieldsOf }
      )
    ).toEqual([]);
    // Still judged in the write's language, and never against the store.
    expect(fieldsOf.mock.calls).toEqual([["categories", "fr"]]);
    // CONTROL: the same document as a page of that collection is refused.
    expect(
      (
        await newListQueryIssues(
          relatedToEntry,
          args({ slug: "nx_pb_components" }),
          "Content",
          { fieldsOf }
        )
      ).map(issue => issue.code)
    ).toEqual(["list-field-unknown"]);
  });

  it("asks for each collection's fields in the language the write is judged in", async () => {
    const fieldsOf = vi.fn(async (collection: string) => FIELDS[collection]);
    await newListQueryIssues(
      relatedToEntry,
      args({ locale: "fr" }),
      "Content",
      { fieldsOf }
    );
    expect(fieldsOf.mock.calls).toEqual([
      ["posts", "fr"],
      ["categories", "fr"],
    ]);
  });
});

describe("a template's lists and conditions, judged against the collection it draws", () => {
  // The templates collection holds a title and the collection's name; none
  // of a post's fields.
  const TEMPLATES: ListFields = {
    declared: new Set(["id", "title", "collection", "content"]),
    readable: [
      { name: "id", type: "text" },
      { name: "title", type: "text" },
    ],
  };
  const fieldsOf = vi.fn(async (collection: string) =>
    collection === "templates" ? TEMPLATES : FIELDS[collection]
  );
  const asTemplate = { ...relatedToEntry, kind: "template" };
  /** The templates collection, its stored targets read as the system. */
  const templates = (
    stored: Readonly<Record<string, string>> = {}
  ): TemplateTargets & { storedTargetsOf: ReturnType<typeof vi.fn> } => ({
    collection: "templates",
    fields: ["collection", "entryCollection"],
    storedTargetsOf: vi.fn(
      async (ids: readonly string[]) =>
        new Map(
          ids.flatMap(id =>
            stored[id] === undefined ? [] : [[id, stored[id]]]
          )
        )
    ),
  });
  /** A write to the templates collection, carrying `data`. */
  const templateWrite = (
    data: Record<string, unknown>,
    write: Partial<PluginFieldWrite> = {}
  ): PluginFieldValidateArgs => ({
    ...args({ slug: "templates", ...write }),
    data,
  });

  it("judges a related list against the template's collection, as the write stores it", async () => {
    fieldsOf.mockClear();
    expect(
      await newListQueryIssues(
        asTemplate,
        templateWrite({ collection: "posts" }),
        "Template",
        { fieldsOf, templates: templates() }
      )
    ).toEqual([]);
    // The entry's fields are the posts', never the templates'.
    expect(fieldsOf.mock.calls.map(([collection]) => collection)).toEqual([
      "posts",
      "categories",
    ]);
  });

  it("judges the same list as a page of the templates collection against that collection (the control)", async () => {
    // A page stored in the templates collection is an entry of it, so a
    // list of its related entries is judged against the templates' fields,
    // which hold no categories.
    const asPage = await newListQueryIssues(
      relatedToEntry,
      templateWrite({ collection: "posts" }),
      "Template",
      { fieldsOf, templates: templates() }
    );
    expect(asPage.map(issue => issue.code)).toEqual(["list-field-unknown"]);
  });

  it("reads the template's stored collection when the write does not carry it", async () => {
    const targets = templates({ t1: "posts" });
    expect(
      await newListQueryIssues(
        asTemplate,
        templateWrite({}, { id: "t1" }),
        "Template",
        { fieldsOf, templates: targets }
      )
    ).toEqual([]);
    expect(targets.storedTargetsOf).toHaveBeenCalledWith(["t1"]);
  });

  it("refuses a template whose collection is neither sent nor stored, rather than judging its lists by shape", async () => {
    const found = await newListQueryIssues(
      asTemplate,
      templateWrite({}, { id: "t2" }),
      "Template",
      { fieldsOf, templates: templates({}) }
    );
    expect(found.map(issue => issue.code)).toEqual([
      "TEMPLATE_COLLECTION_UNKNOWN",
    ]);
  });

  it("judges an entry's own design against the collection its entry is of, made inside a transaction", async () => {
    // An own design leaves `collection` empty and names its entry's
    // collection as `entryCollection`, the write that makes it included.
    fieldsOf.mockClear();
    expect(
      await newListQueryIssues(
        asTemplate,
        templateWrite(
          { collection: "", entryCollection: "posts" },
          { inTransaction: true }
        ),
        "Template",
        { fieldsOf, templates: templates() }
      )
    ).toEqual([]);
    expect(fieldsOf.mock.calls.map(([collection]) => collection)).toEqual([
      "posts",
      "categories",
    ]);
    // And read from the stored design when the write names neither.
    const targets = templates({ d1: "posts" });
    expect(
      await newListQueryIssues(
        asTemplate,
        templateWrite({}, { id: "d1" }),
        "Template",
        { fieldsOf, templates: targets }
      )
    ).toEqual([]);
  });

  it("refuses a template saved inside a batch without its collection, where the stored one cannot be read", async () => {
    // The stored collection is there, but a read of it on another connection
    // could wait on the batch's own: it is not read, and the save is refused.
    const targets = templates({ t1: "posts" });
    const found = await newListQueryIssues(
      asTemplate,
      templateWrite({}, { id: "t1", inTransaction: true }),
      "Template",
      { fieldsOf, templates: targets }
    );
    expect(found.map(issue => issue.code)).toEqual([
      "TEMPLATE_COLLECTION_UNKNOWN",
    ]);
    expect(found[0]?.message).toContain("Send the template's collection");
    expect(targets.storedTargetsOf).not.toHaveBeenCalled();
    // The control: the same batch save carrying the collection is judged
    // against it, and kept.
    expect(
      await newListQueryIssues(
        asTemplate,
        templateWrite(
          { collection: "posts" },
          { id: "t1", inTransaction: true }
        ),
        "Template",
        { fieldsOf, templates: targets }
      )
    ).toEqual([]);
  });

  it("judges a condition on the entry against the template's collection", async () => {
    const condition = {
      formatVersion: 1,
      kind: "template",
      nodes: [
        {
          id: "box",
          type: "core/box",
          version: 1,
          props: {},
          visibility: {
            conditions: [[{ field: "categories", op: "exists" }]],
          },
        },
      ],
    };
    expect(
      await newConditionIssues(
        condition,
        templateWrite({ collection: "posts" }),
        "Template",
        { fieldsOf, templates: templates() }
      )
    ).toEqual([]);
    // CONTROL: the same condition on a page of the templates collection
    // names a field the templates do not have.
    const asPage = await newConditionIssues(
      { ...condition, kind: "page" },
      templateWrite({ collection: "posts" }),
      "Template",
      { fieldsOf, templates: templates() }
    );
    expect(asPage.map(issue => issue.code)).toEqual([
      "condition-field-unknown",
    ]);
  });
});

describe("a problem the stored page may already hold", () => {
  // A list sorted by a field visitors can't see, on a posts page.
  const hidden = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "l1",
        type: "core/collection-loop",
        version: 1,
        props: { collection: "categories", sort: "featured" },
        slots: { children: [] },
      },
    ],
  };
  const fieldsOf = async (collection: string) => FIELDS[collection];

  it("is kept, not refused, where the stored page cannot be read", async () => {
    const onUnjudged = vi.fn();
    expect(
      await newListQueryIssues(hidden, args({}), "Content", {
        fieldsOf,
        storedForms: async () => ({ forms: [], readable: false }),
        onUnjudged,
      })
    ).toEqual([]);
    expect(onUnjudged).toHaveBeenCalledWith(1);
    // CONTROL: nothing stored (a create), the problem is the write's own.
    expect(
      (
        await newListQueryIssues(hidden, args({}), "Content", {
          fieldsOf,
          storedForms: async () => ({ forms: [], readable: true }),
        })
      ).map(issue => issue.code)
    ).toEqual(["list-field-protected"]);
  });
});

describe("the schema a judgement reads", () => {
  it("reads the fields of no more lists than the judgement visits", async () => {
    // Five lists, each of its own collection, and a judgement bounded at two.
    const page = {
      formatVersion: 1,
      kind: "page",
      nodes: ["c1", "c2", "c3", "c4", "c5"].map(collection => ({
        id: collection,
        type: "core/collection-loop",
        version: 1,
        props: { collection, sort: "title" },
        slots: { children: [] },
      })),
    };
    const fieldsOf = vi.fn(async (): Promise<ListFields> => POSTS);
    await newListQueryIssues(page, args({}), "Content", {
      fieldsOf,
      maxNodes: 2,
    });
    expect(fieldsOf.mock.calls.map(call => call[0])).toEqual(["c1", "c2"]);
    // CONTROL: unbounded, every list's collection is read.
    fieldsOf.mockClear();
    await newListQueryIssues(page, args({}), "Content", { fieldsOf });
    expect(fieldsOf).toHaveBeenCalledTimes(5);
  });
});

describe("a collection's fields, as a list is judged by them", () => {
  it("reads what the public may read in the language asked", async () => {
    const readable = vi.fn(
      async (): Promise<readonly BindingFieldShape[]> => [
        { name: "title", type: "text" },
      ]
    );
    const read = listFieldsFrom({
      record: async () => ({ fields: [{ name: "title", type: "text" }] }),
      readable,
    });
    await read("posts", "fr");
    await read("posts");
    expect(readable.mock.calls).toEqual([["posts", "fr"], ["posts"]]);
  });
});

describe("a write's visibility conditions, judged by the server", () => {
  const PAGE_POSTS: ListFields = {
    declared: new Set(["id", "title", "internalScore", "categories"]),
    readable: [
      { name: "id", type: "text" },
      { name: "title", type: "text" },
    ],
    label: "Posts",
  };
  const fieldsOf = async (collection: string) =>
    collection === "posts" ? PAGE_POSTS : FIELDS[collection];

  const conditioned = (conditions: unknown, inList = false) => {
    const box = {
      id: "box",
      type: "core/box",
      version: 1,
      props: {},
      visibility: { conditions },
    };
    return {
      formatVersion: 1,
      kind: "page",
      nodes: inList
        ? [
            {
              id: "cats",
              type: "core/collection-loop",
              version: 1,
              props: { collection: "categories" },
              slots: { children: [box] },
            },
          ]
        : [box],
    };
  };

  it("refuses a condition on a field visitors can't see, naming the field", async () => {
    const found = await newConditionIssues(
      conditioned([[{ field: "internalScore", op: "exists" }]]),
      args({}),
      "Content",
      { fieldsOf }
    );
    expect(found.map(issue => issue.code)).toEqual([
      "condition-field-protected",
    ]);
    expect(found[0]?.message).toContain('"internalScore"');
  });

  it("accepts a condition on a public field, and judges one inside a list by its item's collection", async () => {
    expect(
      await newConditionIssues(
        conditioned([[{ field: "title", op: "contains", value: "x" }]]),
        args({}),
        "Content",
        { fieldsOf }
      )
    ).toEqual([]);
    const inList = await newConditionIssues(
      conditioned([[{ field: "title", op: "exists" }]], true),
      args({}),
      "Content",
      { fieldsOf }
    );
    // Categories has no title: the item is a category, not the page's post.
    expect(inList.map(issue => issue.code)).toEqual([
      "condition-field-unknown",
    ]);
  });

  it("refuses a condition on the entry of a Single, which has none", async () => {
    const found = await newConditionIssues(
      conditioned([[{ field: "title", op: "exists" }]]),
      args({ kind: "single", slug: "home" }),
      "Content",
      { fieldsOf }
    );
    expect(found.map(issue => issue.code)).toEqual([
      "condition-source-unavailable",
    ]);
  });

  it("keeps a problem the stored page already held", async () => {
    const value = conditioned([[{ field: "internalScore", op: "exists" }]]);
    expect(
      await newConditionIssues(value, args({}), "Content", {
        fieldsOf,
        storedForms: async () => ({ readable: true, forms: [value as never] }),
      })
    ).toEqual([]);
  });

  it("judges a component definition's condition on the entry by its operator alone", async () => {
    // A definition saved to the components collection: the entry its
    // condition reads is the placing page's, judged on each such page.
    const definition = {
      ...conditioned([[{ field: "title", op: "exists" }]]),
      kind: "component",
    };
    const componentsOnly = async () => ({
      declared: new Set(["id"]),
      readable: [{ name: "id", type: "text" }],
    });
    expect(
      await newConditionIssues(
        definition,
        args({ slug: "components" }),
        "Document",
        { fieldsOf: componentsOnly }
      )
    ).toEqual([]);
    // A list's item inside the definition is still judged.
    const inList = {
      ...conditioned([[{ field: "nope", op: "exists" }]], true),
      kind: "component",
    };
    expect(
      (
        await newConditionIssues(
          inList,
          args({ slug: "components" }),
          "Document",
          { fieldsOf }
        )
      ).map(issue => issue.code)
    ).toEqual(["condition-field-unknown"]);
  });

  it("leaves a problem unjudged when the stored page can't be read", async () => {
    // A language whose store is not ready: the stored page may already hold
    // the problem, so nothing can tell it from a new one.
    const value = conditioned([[{ field: "internalScore", op: "exists" }]]);
    expect(
      await newConditionIssues(value, args({}), "Content", {
        fieldsOf,
        storedForms: async () => ({ readable: false, forms: [] }),
      })
    ).toEqual([]);
  });
});
