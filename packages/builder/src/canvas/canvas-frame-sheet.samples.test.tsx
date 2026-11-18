/**
 * The canvas sheet greys and tags a Collection list's sample items by the
 * attribute the block writes on them: found by drawing the block itself, so
 * the two spellings cannot drift apart unseen.
 */
import {
  createBlockResolver,
  createStandaloneContext,
  PageRenderer,
} from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CANVAS_FRAME_SHEET } from "./canvas-frame-sheet";

describe("a list's sample items on the canvas", () => {
  it("are greyed and tagged by the attribute the block writes", async () => {
    const stream = await renderToReadableStream(
      <PageRenderer
        document={{
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "list",
              type: "core/collection-loop",
              version: 1,
              props: { collection: "posts" },
            },
          ],
        }}
        blocks={createBlockResolver(coreBlocks)}
        siteStyles={false}
        context={createStandaloneContext({
          data: { find: () => Promise.resolve({ items: [], total: 0 }) },
          diagnostics: true,
        })}
      />
    );
    await stream.allReady;
    const html = await new Response(stream).text();
    const written = /\s(data-nx-list-[a-z-]+)=""/.exec(html)?.[1];
    // CONTROL: the block drew its samples at all.
    expect(written).toBeDefined();
    expect(CANVAS_FRAME_SHEET).toContain(`[${String(written)}]::before`);
    expect(CANVAS_FRAME_SHEET).toContain('content: "Sample"');
  });
});
