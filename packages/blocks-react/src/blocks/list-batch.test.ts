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
  it("reads what the template asks: its item relations and its links, not a nested list's", () => {
    const demand = itemReadDemand(TEMPLATE);
    expect([...demand.follows]).toEqual([["author", new Set(["name"])]]);
    expect(demand.links).toEqual([
      { collection: { value: "posts" }, id: { path: ["id"] } },
    ]);
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
    const drawn = await readListAhead(
      items,
      TEMPLATE,
      createStandaloneContext({ listReads: reads }),
      { nodeId: "list", collection: "posts" }
    );
    expect(reads.related).toHaveBeenCalledOnce();
    expect(reads.related).toHaveBeenCalledWith(
      "posts",
      "author",
      ["a1", "a1", "gone"],
      ["name"],
      { nodeId: "list" }
    );
    expect(drawn.map(item => item.author)).toEqual([
      { id: "a1", name: "Ada" },
      { id: "a1", name: "Ada" },
      "gone",
    ]);
    expect(reads.entryPaths).toHaveBeenCalledOnce();
    expect(reads.entryPaths).toHaveBeenCalledWith(
      [
        { collection: "posts", id: "p1" },
        { collection: "posts", id: "p2" },
        { collection: "posts", id: "p3" },
      ],
      { nodeId: "list" }
    );
  });
});
