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
