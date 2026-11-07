/**
 * What the editor counts a page as reading: the page inside its Layout, as
 * the published page draws it, under the one budget.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  createBlockResolver,
  createStandaloneContext,
} from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { describe, expect, it } from "vitest";

import { countPageReads } from "./page-read-meter";

const page = (nodes: unknown[]): BlockDocument =>
  ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  }) as BlockDocument;

const list = (id: string) => ({
  id,
  type: "core/collection-loop",
  version: 1,
  props: { collection: "posts", limit: 2 },
  slots: { children: [] },
});

const drawnWith = {
  // The core blocks, as the admin registers them for the canvas.
  blocks: createBlockResolver(coreBlocks),
  styleContext: { breakpoints: { viewport: [], container: [] } },
  definitions: new Map(),
  context: createStandaloneContext({
    data: { find: () => Promise.resolve({ items: [{ id: "p1" }] }) },
  }),
};

describe("the page reads the editor counts", () => {
  it("counts a Layout's header with the page, as the published page draws them", async () => {
    const counted = await countPageReads(drawnWith, page([list("body")]), [
      { area: "header", document: page([list("header-list")]) },
    ]);
    // The page's list, the header's list, and the Layout's row.
    expect(counted.byKind).toEqual({ entries: 2, component: 1 });
    expect(counted.used).toBe(3);
  });

  it("counts the page alone where it is drawn inside no Layout", async () => {
    const counted = await countPageReads(drawnWith, page([list("body")]), []);
    expect(counted.byKind).toEqual({ entries: 1 });
  });
});

const button = (id: string) => ({
  id,
  type: "core/button",
  version: 1,
  props: { label: id, entryCollection: "posts", entryId: "p9" },
});

describe("the page reads the editor counts, near the allowance", () => {
  it("leaves a link refused unsettled, so the next block that draws it asks again and is named", async () => {
    // Room for less than one link's reads.
    const counted = await countPageReads(
      drawnWith,
      page([button("first"), button("second")]),
      [],
      2
    );
    expect(counted.unread.map(block => block.nodeId)).toEqual([
      "first",
      "second",
    ]);
  });

  it("reads a list's relations for real, so what its items draw through them is counted", async () => {
    const data = {
      find: (query: { collection: string }) =>
        Promise.resolve(
          query.collection === "authors"
            ? { items: [{ id: "a1", avatar: "m1" }], total: 1 }
            : { items: [{ id: "p1", author: "a1" }], total: 1 }
        ),
    };
    const shapes = new Map<string, unknown>([
      [
        "collection:posts",
        [{ name: "author", type: "relationship", relationTo: "authors" }],
      ],
      [
        "collection:authors",
        [{ name: "avatar", type: "upload", relationTo: "media" }],
      ],
    ]);
    const counted = await countPageReads(
      {
        ...drawnWith,
        context: createStandaloneContext({
          data,
          resolveMedia: () => Promise.resolve({ url: "/a.png" }),
        }),
        bindings: {
          fieldShapes: {
            fieldsOf: ref =>
              shapes.get(
                "collection" in ref
                  ? `collection:${ref.collection}`
                  : `single:${ref.single}`
              ) as never,
          },
        },
      },
      page([
        {
          ...list("posts-list"),
          slots: {
            children: [
              {
                id: "avatar",
                type: "core/image",
                version: 1,
                props: { alt: "" },
                bindings: {
                  mediaId: { $bind: "author.avatar", source: "item" },
                },
              },
            ],
          },
        },
      ]),
      []
    );
    // The list, its authors, and the avatar read through them.
    expect(counted.byKind).toEqual({ entries: 1, related: 1, image: 1 });
  });
});
