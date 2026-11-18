/**
 * A new Collection list: what it is placed with, and the sample items it
 * draws for an author while its collection shows nothing, which a visitor's
 * page never draws.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  toOneParagraph,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandaloneContext } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { collectionLoop } from "./collection-loop";

import { coreBlocks } from ".";

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

const resolver = createBlockResolver(coreBlocks);

/** A list of posts whose item shows each entry's title. */
const document: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "list",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts", limit: 6 },
      slots: {
        children: [
          {
            id: "title",
            type: "core/heading",
            version: 1,
            props: { text: "", level: "h3" },
            bindings: { text: { $bind: "title", source: "item" } },
          },
        ],
        empty: [
          {
            id: "none",
            type: "core/text",
            version: 2,
            props: { text: toOneParagraph("Nothing here yet.").value },
          },
        ],
      },
    },
  ],
};

/** The page drawn over a collection with no entries. */
async function drawEmpty(diagnostics: boolean): Promise<string> {
  return renderToHtml(
    <PageRenderer
      document={document}
      blocks={resolver}
      siteStyles={false}
      // Bindings resolved, as a page with bound blocks is drawn.
      bindings={{}}
      context={createStandaloneContext({
        data: { find: () => Promise.resolve({ items: [], total: 0 }) },
        diagnostics,
        fieldShapes: {
          fieldsOf: ref =>
            "collection" in ref && ref.collection === "posts"
              ? [
                  { name: "title", type: "text" },
                  { name: "cover", type: "upload", relationTo: "media" },
                ]
              : undefined,
        },
      })}
    />
  );
}

describe("a new list", () => {
  it("is placed with six entries, newest first, and no source", () => {
    const placed = {
      ...collectionLoop.defaultProps,
      ...collectionLoop.example.props,
    };
    expect(placed).toMatchObject({ limit: 6, sort: "-createdAt" });
    expect(placed).not.toHaveProperty("collection");
  });

  it("starts its When-empty slot with a Text saying there is nothing yet", () => {
    expect(collectionLoop.slots?.empty?.defaultBlock).toEqual([
      expect.objectContaining({ type: "core/text" }),
    ]);
    expect(JSON.stringify(collectionLoop.slots?.empty?.defaultBlock)).toContain(
      "Nothing here yet."
    );
  });
});

describe("sample items", () => {
  it("draw the item three times with sample values where an author looks at an empty collection", async () => {
    const html = await drawEmpty(true);
    expect(html.match(/data-nx-list-sample/g)).toHaveLength(3);
    expect(html).toContain("Sample title 1");
    expect(html).toContain("Sample title 3");
    // The empty state is not drawn beside them.
    expect(html).not.toContain("Nothing here yet.");
  });

  it("never reach a visitor's page, which shows the When-empty slot", async () => {
    const html = await drawEmpty(false);
    expect(html).not.toContain("data-nx-list-sample");
    expect(html).not.toContain("Sample title");
    expect(html).toContain("Nothing here yet.");
  });
});

/** The page drawn with a list whose item has no blocks yet, over two posts. */
async function drawItemless(diagnostics: boolean): Promise<string> {
  return renderToHtml(
    <PageRenderer
      document={{
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          {
            id: "list",
            type: "core/collection-loop",
            version: 1,
            props: { collection: "posts", limit: 6 },
            slots: { children: [] },
          },
        ],
      }}
      blocks={resolver}
      siteStyles={false}
      bindings={{}}
      context={createStandaloneContext({
        data: {
          find: () =>
            Promise.resolve({ items: [{ id: "a" }, { id: "b" }], total: 2 }),
        },
        diagnostics,
      })}
    />
  );
}

/** How many entries a page draws: one element per entry, inside the list. */
function entries(html: string): number {
  return (
    html.match(/class="nx-bt-core--collection-loop nx-pb-gap"/g)?.length ?? 0
  );
}

describe("a list whose item has no blocks yet", () => {
  it("draws no entries where an author looks, so the editor shows it as an empty container", async () => {
    const html = await drawItemless(true);
    expect(entries(html)).toBe(0);
    // The list's root itself is still drawn, empty.
    expect(html).toMatch(
      /<div class="[^"]*nx-bt-core--collection-loop"><\/div>/
    );
  });

  it("still draws a visitor's page as before, an entry per post", async () => {
    expect(entries(await drawItemless(false))).toBe(2);
  });
});
