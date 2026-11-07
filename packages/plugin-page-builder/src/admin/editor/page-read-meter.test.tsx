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
