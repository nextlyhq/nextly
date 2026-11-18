/**
 * What a list's template asks of each entry, read from the template: the
 * relations its item bindings follow and its links to entries, and nothing
 * inside a list nested in it.
 */
import { createBindingRun, type BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { createStandaloneContext, type ListBatchReads } from "../context";

import { fillItemBindings, itemReadDemand, readListAhead } from "./list-batch";
import { withListEntry } from "./list-entries";

const node = (
  id: string,
  type: string,
  props: Record<string, unknown>,
  extra: Partial<BlockNode> = {}
): BlockNode => ({ id, type, version: 1, props, ...extra }) as BlockNode;

const TEMPLATE: BlockNode[] = [
  node(
    "t",
    "core/heading",
    { text: "" },
    {
      bindings: { text: { $bind: "author.name", source: "item" } },
    }
  ),
  node(
    "img",
    "core/image",
    {},
    {
      bindings: { mediaId: { $bind: "cover", source: "item" } },
    }
  ),
  node("logo", "core/image", { mediaId: "logo-1" }),
  node(
    "go",
    "core/button",
    { entryCollection: "posts" },
    {
      bindings: { entryId: { $bind: "id", source: "item" } },
    }
  ),
  node(
    "inner",
    "core/collection-loop",
    { collection: "tags" },
    {
      slots: {
        children: [
          node(
            "tag",
            "core/heading",
            { text: "" },
            {
              bindings: { text: { $bind: "label.name", source: "item" } },
            }
          ),
        ],
      },
    }
  ),
];

describe("a list's read-ahead", () => {
  it("reads ahead for a block the route kept for the page entry's conditions, as the renderer draws it", async () => {
    const reads: ListBatchReads = {
      related: vi.fn(async () => new Map([["a1", { id: "a1", name: "Ada" }]])),
      entryPaths: vi.fn(async () => undefined),
    };
    // A condition the item does not meet: kept only because the route held
    // it for the page's entry.
    const kept = node(
      "kept",
      "core/heading",
      { text: "" },
      {
        bindings: { text: { $bind: "author.name", source: "item" } },
        visibility: {
          conditions: [[{ field: "title", op: "equals", value: "Page" }]],
        },
      }
    );
    const items = [{ id: "p1", title: "Post", author: "a1" }];
    const ahead = (held?: ReadonlySet<string>) =>
      readListAhead(
        items,
        [kept],
        createStandaloneContext({
          listReads: reads,
          ...(held === undefined ? {} : { heldConditions: held }),
        }),
        {
          nodeId: "list",
          collection: "posts",
          contextOf: item =>
            createStandaloneContext({ listReads: reads, item }),
        }
      );
    // CONTROL: not held, the item's conditions leave it out, so nothing is read.
    expect((await ahead()).size).toBe(0);
    expect(reads.related).not.toHaveBeenCalled();
    const followed = await ahead(new Set(["kept"]));
    expect(reads.related).toHaveBeenCalledOnce();
    expect(followed.get(items[0] as Record<string, unknown>)).toEqual({
      author: { id: "a1", name: "Ada" },
    });
  });

  it("reads what the template asks: its item relations and its links, not a nested list's", () => {
    const demand = itemReadDemand(TEMPLATE);
    expect([...demand.follows]).toEqual([["author", new Set(["name"])]]);
    // The one block that links to an entry, by a set collection and a
    // bound id; the nested list's are its own.
    expect(demand.links.map(node => node.id)).toEqual(["go"]);
  });

  it("asks once per kind for all the entries, and draws each item with its relation read", async () => {
    const reads: ListBatchReads = {
      related: vi.fn(async () => new Map([["a1", { id: "a1", name: "Ada" }]])),
      entryPaths: vi.fn(async () => undefined),
    };
    const items = [
      { id: "p1", author: "a1", cover: "c1" },
      { id: "p2", author: "a1", cover: "c2" },
      { id: "p3", author: "gone", cover: "c3" },
    ];
    const followed = await readListAhead(
      items,
      TEMPLATE,
      createStandaloneContext({ listReads: reads }),
      {
        nodeId: "list",
        collection: "posts",
        contextOf: item => createStandaloneContext({ listReads: reads, item }),
      }
    );
    expect(reads.related).toHaveBeenCalledOnce();
    expect(reads.related).toHaveBeenCalledWith(
      "posts",
      "author",
      ["a1", "a1", "gone"],
      ["name"],
      { nodeId: "list" }
    );
    // Read beside each item it was read for; the items keep their ids.
    expect(items.map(item => followed.get(item))).toEqual([
      { author: { id: "a1", name: "Ada" } },
      { author: { id: "a1", name: "Ada" } },
      undefined,
    ]);
    expect(items.map(item => item.author)).toEqual(["a1", "a1", "gone"]);
    // No binding pass on this context, so no item binding is filled, in
    // the render or here: the bound link has no entry to read ahead. A
    // routed page, which has the pass, reads it (`next.read-budget.test.ts`).
    expect(reads.entryPaths).not.toHaveBeenCalled();
  });

  it("reads an image's entry link ahead only while a click follows it", async () => {
    // One image per template: a list reads nothing more ahead past its
    // first image, so each case is a list of its own.
    const asked = async (whenClicked?: string): Promise<boolean> => {
      const reads: ListBatchReads = {
        related: vi.fn(async () => new Map()),
        entryPaths: vi.fn(async () => undefined),
      };
      const picture = node("pic", "core/image", {
        mediaId: "m1",
        entryCollection: "pages",
        entryId: "about",
        ...(whenClicked === undefined ? {} : { whenClicked }),
      });
      await readListAhead(
        [{ id: "p1" }],
        [picture],
        createStandaloneContext({ listReads: reads }),
        {
          nodeId: "list",
          collection: "posts",
          contextOf: item =>
            createStandaloneContext({ listReads: reads, item }),
        }
      );
      return vi.mocked(reads.entryPaths).mock.calls.length > 0;
    };
    // Stored before the choice existed, or set to Link: it links, so its
    // path is read ahead, as it always was.
    expect(await asked()).toBe(true);
    expect(await asked("link")).toBe(true);
    // Set to Nothing or Enlarge, it keeps its link stored and draws none.
    expect(await asked("nothing")).toBe(false);
    expect(await asked("enlarge")).toBe(false);
  });
});

describe("a host's own list reads", () => {
  it("keep the published types: steps that answer nothing", () => {
    // A host's steps as published, each answering nothing.
    const entryPaths = async (): Promise<void> => undefined;
    const media = async (): Promise<void> => undefined;
    const reads: ListBatchReads = {
      related: async () => undefined,
      entryPaths,
      media,
    };
    expectTypeOf(reads.entryPaths).returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<
      ReturnType<NonNullable<ListBatchReads["media"]>>
    >().toEqualTypeOf<Promise<void>>();
  });

  it("stop at the images where the host reads none ahead, so each keeps its own read", async () => {
    const template = [
      node("logo", "core/image", { mediaId: "logo-1" }),
      node(
        "t",
        "core/heading",
        { text: "" },
        { bindings: { text: { $bind: "author.name", source: "item" } } }
      ),
    ];
    const items = [{ id: "p1", author: "a1" }];
    const ahead = async (reads: ListBatchReads) => {
      await readListAhead(
        items,
        template,
        createStandaloneContext({ listReads: reads }),
        {
          nodeId: "list",
          collection: "posts",
          contextOf: item =>
            createStandaloneContext({ listReads: reads, item }),
        }
      );
    };
    const without: ListBatchReads = {
      related: vi.fn(async () => new Map([["a1", { id: "a1", name: "Ada" }]])),
      entryPaths: vi.fn(async () => undefined),
    };
    await ahead(without);
    // The image comes first and is read as it is drawn: the relation after
    // it is not read ahead of it.
    expect(without.related).not.toHaveBeenCalled();
    // CONTROL: a host that reads images ahead goes on to the relation.
    const withMedia: ListBatchReads = {
      ...without,
      related: vi.fn(async () => new Map([["a1", { id: "a1", name: "Ada" }]])),
      media: vi.fn(async () => undefined),
    };
    await ahead(withMedia);
    expect(withMedia.media).toHaveBeenCalledOnce();
    expect(withMedia.related).toHaveBeenCalledOnce();
  });
});

describe("a binding naming the list it reads, through a relation", () => {
  /** A heading reading `path` of the entry of the list `list`. */
  const named = (id: string, path: string, list: string) =>
    node(
      id,
      "core/heading",
      { text: "Own text" },
      { bindings: { text: { $bind: path, source: "item", list } } }
    );
  /** The outer list's template: a nested list holding `inner`. */
  const outerTemplate = (inner: BlockNode[]): BlockNode[] => [
    node("own", "core/heading", { text: "" }, {}),
    node(
      "posts",
      "core/collection-loop",
      { collection: "posts" },
      { slots: { children: inner } }
    ),
  ];

  it("is read ahead by the list it names, from inside a list nested in it", () => {
    const template = outerTemplate([
      named("by-category", "lead.name", "categories"),
      named("by-other", "editor.name", "elsewhere"),
    ]);
    // Read ahead by the list the binding names, and by no other.
    expect([
      ...itemReadDemand(template, undefined, "categories").follows,
    ]).toEqual([["lead", new Set(["name"])]]);
    // CONTROL: a list that is not named reads nothing for either.
    expect([...itemReadDemand(template).follows]).toEqual([]);
  });

  it("has its relation read ahead by the list it names, once for all its entries", async () => {
    const template = outerTemplate([
      named("by-category", "lead.name", "categories"),
    ]);
    const items = [
      { id: "c1", lead: "a1" },
      { id: "c2", lead: "a2" },
    ];
    const ahead = async (id?: string) => {
      const reads: ListBatchReads = {
        related: vi.fn(
          async () => new Map([["a1", { id: "a1", name: "Ada" }]])
        ),
        entryPaths: vi.fn(async () => undefined),
      };
      const followed = await readListAhead(
        items,
        template,
        createStandaloneContext({ listReads: reads }),
        {
          nodeId: "categories",
          ...(id === undefined ? {} : { id }),
          collection: "categories",
          contextOf: item =>
            createStandaloneContext({ listReads: reads, item }),
        }
      );
      return { reads, followed };
    };
    const { reads, followed } = await ahead("categories");
    expect(reads.related).toHaveBeenCalledOnce();
    expect(reads.related).toHaveBeenCalledWith(
      "categories",
      "lead",
      ["a1", "a2"],
      ["name"],
      { nodeId: "categories" }
    );
    expect(followed.get(items[0] as Record<string, unknown>)).toEqual({
      lead: { id: "a1", name: "Ada" },
    });
    // CONTROL: a list not told its own id cannot know the binding names it.
    expect((await ahead()).reads.related).not.toHaveBeenCalled();
  });

  it("is read ahead by the list it names from that list's own template", () => {
    const template = [named("direct", "lead.name", "categories")];
    expect([
      ...itemReadDemand(template, undefined, "categories").follows,
    ]).toEqual([["lead", new Set(["name"])]]);
    // CONTROL: naming another list, it is not this list's to read.
    expect([...itemReadDemand(template, undefined, "posts").follows]).toEqual(
      []
    );
  });

  it("reads the related entry its list read ahead, and the stored id for the field itself", () => {
    const run = createBindingRun({
      sources: {},
      props: {
        get: type =>
          type === "core/heading"
            ? { props: { text: { type: "text" } } }
            : undefined,
      },
    });
    // The category's entry as its list draws it, with what it read ahead,
    // and a post of the list inside it drawn within that.
    const { itemFollowed: _category, ...category } = withListEntry(
      createStandaloneContext({
        item: { id: "c1", name: "Surveys", lead: "a1" },
        itemSource: "categories",
        itemFollowed: { lead: { id: "a1", name: "Ada" } },
      }),
      "categories"
    );
    const context = {
      ...category,
      item: { id: "p1", title: "Post" },
      itemSource: "posts",
    };
    const through = fillItemBindings(
      named("h", "lead.name", "categories"),
      context,
      run
    );
    expect(through.props.text).toBe("Ada");
    const itself = fillItemBindings(
      named("h", "lead", "categories"),
      context,
      run
    );
    expect(itself.props.text).toBe("a1");
  });
});
