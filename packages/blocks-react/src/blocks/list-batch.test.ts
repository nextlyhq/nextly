/**
 * What a list's template asks of each entry, read from the template: the
 * relations its item bindings follow and its links to entries, and nothing
 * inside a list nested in it.
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import { createStandaloneContext, type ListBatchReads } from "../context";

import { itemReadDemand, readListAhead } from "./list-batch";

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
});
