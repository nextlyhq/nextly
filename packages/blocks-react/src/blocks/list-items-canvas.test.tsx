// @vitest-environment jsdom
/**
 * A List's items marked for typing on the canvas: each item's element carries
 * its own address, in an editor's render only, so the published page is the
 * plain list it always was.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  itemPropName,
  type BlockDocument,
  type PropSchema,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { propMarker } from "../block-boundary-attributes";
import { PageRenderer } from "../page-renderer";
import type { BlockResolver } from "../resolver";

import { coreBlocks } from "./index";

const resolver: BlockResolver = {
  get: (name: string) => coreBlocks.find(block => block.name === name) as never,
};

async function markup(canvas: boolean): Promise<string> {
  const document = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "l",
        type: "core/list",
        version: 1,
        props: { kind: "ordered", items: ["One", "Two"] },
      },
    ],
  } as BlockDocument;
  const stream = await renderToReadableStream(
    <PageRenderer
      document={document}
      blocks={resolver}
      {...(canvas ? { nodeAttribute: true } : {})}
    />
  );
  await stream.allReady;
  return new Response(stream).text();
}

describe("a List's items on the canvas", () => {
  it("marks each item with its own address", async () => {
    const html = await markup(true);
    expect(html).toContain(
      `<li data-nx-prop="${itemPropName("items", 0)}">One</li>`
    );
    expect(html).toContain(
      `<li data-nx-prop="${itemPropName("items", 1)}">Two</li>`
    );
  });

  it("marks nothing on the published page", async () => {
    const html = await markup(false);
    expect(html).toContain("<li>One</li><li>Two</li>");
  });
});

describe("propMarker, for an item's address", () => {
  // The prop as a block declares it, so each case is a schema a block could hold.
  const markFor = (items: PropSchema) =>
    propMarker({ props: { items } }, true)?.(itemPropName("items", 0));

  it("marks an item of an inline array of words", () => {
    expect(markFor({ type: "array", of: "text", inline: true })).toEqual({
      "data-nx-prop": "items.0",
    });
  });

  it("marks nothing for an array the block left out of canvas editing", () => {
    expect(markFor({ type: "array", of: "text" })).toEqual({});
    expect(markFor({ type: "array", of: "object", inline: true })).toEqual({});
  });
});
