/**
 * A page drawn with list data and no bindings still decides its list items'
 * conditions, and still serves the rules of the blocks an item shows: the
 * rules are held out of the page's sheet whether or not the page has
 * bindings to fill, so they have to reach the list either way.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BindingFieldShape,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import { createStandaloneContext } from "./context";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

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

const POSTS: readonly BindingFieldShape[] = [
  { name: "title", type: "text" },
  { name: "featured", type: "checkbox" },
];

/** A list of posts whose heading shows only for a featured post, styled. */
const document: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "loop",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts", limit: 2 },
      slots: {
        children: [
          {
            id: "pill",
            type: "core/heading",
            version: 1,
            props: { text: "Featured", level: "h2" },
            styles: { base: { base: { color: "#c0ffee" } } },
            visibility: {
              conditions: [[{ field: "featured", op: "is_true" }]],
            },
          },
        ],
      },
    },
  ],
};

async function renderWith(
  items: readonly Record<string, unknown>[]
): Promise<string> {
  return await renderToHtml(
    <PageRenderer
      document={document}
      blocks={resolver}
      siteStyles={false}
      context={createStandaloneContext({
        data: { find: () => Promise.resolve({ items: [...items] }) },
        fieldShapes: {
          fieldsOf: ref =>
            "collection" in ref && ref.collection === "posts"
              ? POSTS
              : undefined,
        },
      })}
    />
  );
}

describe("a page drawn with list data and no bindings", () => {
  it("serves the rules of a block an item shows, once, beside it", async () => {
    const html = await renderWith([
      { id: "1", title: "One", featured: true },
      { id: "2", title: "Two", featured: true },
    ]);
    // CONTROL: the item's conditions held, so the block is drawn for each.
    expect(html.match(/>Featured</g)).toHaveLength(2);
    expect(html.match(/data-nx-item-rules="pill"/g)).toHaveLength(1);
    expect(html).toContain("#c0ffee");
  });

  it("serves none of them when no item shows the block", async () => {
    const html = await renderWith([{ id: "1", title: "One", featured: false }]);
    expect(html).not.toContain(">Featured<");
    expect(html).not.toContain("#c0ffee");
  });
});
