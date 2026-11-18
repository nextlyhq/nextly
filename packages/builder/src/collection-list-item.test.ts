import {
  clearBlocks,
  registerBlocks,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { box, card, heading, image, paragraph } from "@nextlyhq/blocks-react/blocks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  itemFieldsOf,
  planStartingList,
  startingItem,
  type ItemSource,
} from "./collection-list-item";

beforeAll(() => {
  registerBlocks([box, card, heading, image, paragraph] as never, {
    source: "collection-list-item-test",
  });
});

afterAll(() => {
  clearBlocks();
});

/** A blog's posts: a title, a cover, an excerpt, served as pages. */
const POSTS: ItemSource = {
  slug: "posts",
  titleField: "title",
  entriesHavePages: true,
  readable: [
    { name: "title", type: "text" },
    { name: "slug", type: "text" },
    { name: "cover", type: "upload", relationTo: "media" },
    { name: "body", type: "richText" },
    { name: "excerpt", type: "textarea" },
    { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
  ],
};

/** A team's people: a name only, and no pages. */
const PEOPLE: ItemSource = {
  slug: "people",
  readable: [
    { name: "name", type: "text" },
    { name: "role", type: "text" },
  ],
};

/** What an item's tree holds, without ids: type, bindings and children. */
function shape(nodes: readonly BlockNode[]): unknown[] {
  return nodes.map(node => ({
    type: node.type,
    ...(node.bindings === undefined ? {} : { bindings: node.bindings }),
    ...(node.slots?.children === undefined
      ? {}
      : { children: shape(node.slots.children) }),
  }));
}

describe("itemFieldsOf", () => {
  it("takes the title field, the first image upload and an excerpt, and links to pages", () => {
    expect(itemFieldsOf(POSTS)).toEqual({
      title: "title",
      picture: "cover",
      summary: "excerpt",
      link: true,
    });
  });

  it("finds a title by its name, and no picture, summary or link where there are none", () => {
    expect(itemFieldsOf(PEOPLE)).toEqual({ title: "name", link: false });
  });

  it("falls back to the first long text for a summary, never the title itself", () => {
    expect(
      itemFieldsOf({
        slug: "notes",
        titleField: "heading",
        readable: [
          { name: "heading", type: "text" },
          { name: "notes", type: "textarea" },
        ],
      })
    ).toEqual({ title: "heading", summary: "notes", link: false });
  });

  it("takes the first single upload of images, and nothing the image binding rule refuses", () => {
    expect(
      itemFieldsOf({
        slug: "albums",
        readable: [
          { name: "files", type: "upload", relationTo: "media", hasMany: true },
          { name: "brief", type: "upload", relationTo: "media", takesImages: false },
          // A relation to the library is a reference, which an Image's
          // picture does not take: the save would refuse it.
          { name: "photo", type: "relationship", relationTo: "media" },
          { name: "cover", type: "upload", relationTo: "media" },
        ],
      }).picture
    ).toBe("cover");
  });

  it("passes over a declared title field that holds a number or a date", () => {
    expect(
      itemFieldsOf({
        slug: "orders",
        titleField: "number",
        readable: [
          { name: "number", type: "number" },
          { name: "name", type: "text" },
        ],
      }).title
    ).toBe("name");
    expect(
      itemFieldsOf({
        slug: "events",
        titleField: "when",
        readable: [{ name: "when", type: "date" }],
      }).title
    ).toBeUndefined();
  });

  it("ignores a declared title field visitors cannot read", () => {
    expect(
      itemFieldsOf({
        slug: "secret",
        titleField: "internal",
        readable: [{ name: "name", type: "text" }],
      }).title
    ).toBe("name");
  });
});

describe("startingItem", () => {
  it("builds a card of the picture, the linked title and the summary", () => {
    const [cardNode] = startingItem(POSTS, "cards");
    expect(shape(startingItem(POSTS, "cards"))).toEqual([
      {
        type: "core/card",
        children: [
          { type: "core/image", bindings: { mediaId: { $bind: "cover", source: "item" } } },
          {
            type: "core/heading",
            bindings: {
              text: { $bind: "title", source: "item" },
              entryId: { $bind: "id", source: "item" },
            },
          },
          { type: "core/text", bindings: { text: { $bind: "excerpt", source: "item" } } },
        ],
      },
    ]);
    const [picture, title] = cardNode?.slots?.children ?? [];
    expect(picture?.styles?.base?.base).toMatchObject({ aspectRatio: "16 / 9", objectFit: "cover" });
    expect(title?.props).toMatchObject({ level: "h3", entryCollection: "posts" });
  });

  it("links no title where entries have no pages", () => {
    const [cardNode] = startingItem(PEOPLE, "cards");
    const [title] = cardNode?.slots?.children ?? [];
    expect(title?.props).not.toHaveProperty("entryCollection");
    expect(title?.bindings).toEqual({ text: { $bind: "name", source: "item" } });
  });

  it("lays a row of a square picture beside the title and summary", () => {
    expect(shape(startingItem(POSTS, "rows"))).toEqual([
      {
        type: "core/box",
        children: [
          { type: "core/image", bindings: { mediaId: { $bind: "cover", source: "item" } } },
          {
            type: "core/box",
            children: [
              {
                type: "core/heading",
                bindings: {
                  text: { $bind: "title", source: "item" },
                  entryId: { $bind: "id", source: "item" },
                },
              },
              { type: "core/text", bindings: { text: { $bind: "excerpt", source: "item" } } },
            ],
          },
        ],
      },
    ]);
  });

  it("binds only the linked title for Titles only", () => {
    expect(shape(startingItem(POSTS, "titles"))).toEqual([
      {
        type: "core/heading",
        bindings: {
          text: { $bind: "title", source: "item" },
          entryId: { $bind: "id", source: "item" },
        },
      },
    ]);
  });

  it("leaves an empty item for a collection with none of the fields", () => {
    const bare: ItemSource = { slug: "bare", readable: [{ name: "count", type: "number" }] };
    expect(startingItem(bare, "cards")).toEqual([]);
    expect(startingItem(bare, "titles")).toEqual([]);
  });

  it("gives every block an id of its own", () => {
    const ids: string[] = [];
    const walk = (nodes: readonly BlockNode[]): void =>
      nodes.forEach(node => {
        ids.push(node.id);
        walk(node.slots?.children ?? []);
      });
    walk([...startingItem(POSTS, "cards"), ...startingItem(POSTS, "cards")]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("planStartingList", () => {
  const list = (sort?: string) => ({
    formatVersion: 1 as const,
    kind: "page" as const,
    nodes: [
      {
        id: "list",
        type: "core/collection-loop",
        version: 1,
        props: { limit: 6, ...(sort === undefined ? {} : { sort }) },
      },
    ],
  });

  it("keeps Newest first for a collection that keeps its creation dates", () => {
    const [update] = planStartingList(list("-createdAt"), "list", { ...POSTS, sortsByCreated: true }, "titles") ?? [];
    expect(update).toMatchObject({ patch: { props: { collection: "posts", sort: "-createdAt" } } });
  });

  it("drops it for a collection with timestamps off, which a save would refuse", () => {
    const [update] = planStartingList(list("-createdAt"), "list", { ...PEOPLE, sortsByCreated: false }, "skip") ?? [];
    const props = (update as { patch: { props: Record<string, unknown> } }).patch.props;
    expect(props).toEqual({ limit: 6, collection: "people" });
  });

  it("leaves an author's own sort alone", () => {
    const [update] = planStartingList(list("title"), "list", { ...PEOPLE, sortsByCreated: false }, "skip") ?? [];
    expect(update).toMatchObject({ patch: { props: { sort: "title" } } });
  });
});
