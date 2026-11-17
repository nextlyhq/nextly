// @vitest-environment jsdom
/**
 * "Keep out of search previews" on every container: a marked container's root
 * element carries `data-nosnippet` on the published page, whichever tag it
 * renders, and an unmarked one carries nothing new.
 */
import { renderToReadableStream } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import {
  DOCUMENT_FORMAT_VERSION,
  type AnyBlockDefinition,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";
import { coreBlocks } from "./index";

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

const blocks = createBlockResolver(coreBlocks as AnyBlockDefinition[]);

/** One container on a page, with the tag it is given. */
async function rendered(
  type: string,
  as: string,
  extra: Partial<BlockNode> = {}
): Promise<string> {
  const definition = coreBlocks.find(block => block.name === type);
  if (definition === undefined) throw new Error(`${type} is not core`);
  const node = {
    id: "box",
    type,
    version: definition.version,
    props: { as },
    ...extra,
  } as BlockNode;
  return renderToHtml(
    <PageRenderer
      document={{
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [node],
      }}
      blocks={blocks}
    />
  );
}

/** The tag of the element carrying the mark, and its opening tag. */
function marked(html: string): { tag?: string; opening?: string } {
  const found = /<([a-z]+)\b[^>]*data-nosnippet=""[^>]*>/.exec(html);
  return { tag: found?.[1], opening: found?.[0] };
}

describe("a container kept out of search previews", () => {
  it.each([
    ["core/card", "div"],
    ["core/card", "section"],
    ["core/columns", "section"],
    ["core/accordion", "div"],
    ["core/gallery", "section"],
    ["core/section", "section"],
    ["core/box", "div"],
  ])("marks the root of %s rendered as <%s>", async (type, as) => {
    const { tag, opening } = marked(
      await rendered(type, as, { nosnippet: true })
    );
    // The container's own root, by the tag its author picked.
    expect(tag).toBe(as);
    expect(opening).toMatch(/ class="nx-/);
  });

  it("leaves an unmarked card as it was", async () => {
    const html = await rendered("core/card", "div");
    expect(html).not.toContain("data-nosnippet");
  });
});
