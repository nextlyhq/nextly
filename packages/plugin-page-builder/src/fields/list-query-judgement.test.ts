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

import { listFieldsFrom, newListQueryIssues } from "./list-query-judgement";

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
