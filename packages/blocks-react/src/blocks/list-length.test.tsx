/**
 * `core/list` at lengths a document can hold but a person would not write.
 *
 * Its own file rather than an addition to the primitives suite, because the
 * interesting assertion needs the BOUNDARY: the failure it guards against
 * happens after the block's render returns, when the normalizer refuses an
 * oversized output and the whole block becomes a placeholder.
 */
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  defineBlock,
  type AnyBlockDefinition,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { BlockBoundary } from "../block-boundary";
import type { BlockRenderArgs, PageContext } from "../context";
import { createBlockResolver } from "../resolver";

import { renderList } from "./list";

const NODE: BlockNode = { id: "n1", type: "core/list", version: 1, props: {} };

function context(): PageContext {
  return {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
  };
}

function args<P>(props: P): BlockRenderArgs<P> {
  return {
    props,
    node: NODE,
    className: "nx-n1",
    // Required by the render contract. These fixtures declare no parts, so the
    // answer is empty for every name — but a renderer that could omit it would
    // leave every block's parts unmarked with nothing to report.
    partClass: () => "",
    ctx: context(),
    renderSlot: () => null,
  };
}

describe("core/list at length", () => {
  it("renders an oversized list instead of losing the whole block", async () => {
    // A stored array has no length of its own: the document's caps bound node
    // count and depth, never a prop array. Past the renderer's inspection
    // budget the normalizer refuses the output, so before the clamp an
    // accidentally long list cost the reader EVERY item rather than the tail.
    const items = Array.from({ length: 12_000 }, (_, index) => `item ${index}`);
    const oversized = defineBlock({
      name: "test/oversized-list",
      version: 1,
      description: "A list far past the inspection budget.",
      example: { props: {} },
      render: () => renderList(args({ items })),
    });

    const stream = await renderToReadableStream(
      <BlockBoundary
        node={{ id: "n1", type: "test/oversized-list", version: 1, props: {} }}
        context={context()}
        blocks={createBlockResolver([oversized as AnyBlockDefinition])}
        classes={{ n1: "nx-node" }}
      />
    );
    const html = await new Response(stream).text();

    expect(html).not.toContain("data-nx-block-placeholder");
    expect(html).toContain("item 0");
    // The tail is traded for the body rather than the body for the tail.
    expect(html).not.toContain("item 11999");
  });

  it("leaves a list nobody would call long alone", () => {
    // The control. Without it the assertions above would pass on a clamp of any
    // size, including one that silently truncated ordinary content.
    const items = Array.from({ length: 250 }, (_, index) => `row ${index}`);
    const out = renderToStaticMarkup(renderList(args({ items })));

    expect(out).toContain("row 0");
    expect(out).toContain("row 249");
    expect(out.match(/<li>/g)).toHaveLength(250);
  });
});
