// @vitest-environment jsdom
/**
 * Custom CSS on a rendered page: only what the host's checker accepts, after
 * the builder's own rules, the site's, then the page's, then each block's
 * scoped to the block. A render with no checker, which is what a bare
 * blocks-react render is, draws none of it; and a value the checker refuses
 * stays in the document but is not in the page's style.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  nodeClassName,
  type BlockDocument,
  type CustomCssPolicy,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import { PageRenderer } from "./page-renderer";
import type { BlockResolver } from "./resolver";

const resolver: BlockResolver = {
  get: (name: string) => coreBlocks.find(block => block.name === name) as never,
};

const SITE = ".site-mark{color:olive}";
const PAGE = ".page-mark{color:teal}";
const BLOCK = "selector{border:4px solid blue}";

const document = (): BlockDocument =>
  ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    settings: { customCss: PAGE },
    nodes: [
      {
        id: "t1",
        type: "core/text",
        version: 2,
        props: { text: "Words" },
        styles: { base: { base: { color: "#111111" } } },
        customCss: BLOCK,
      },
    ],
  }) as unknown as BlockDocument;

const checker = (refuse: readonly string[] = []): CustomCssPolicy => ({
  id: "test-checker",
  accepts: css => !refuse.includes(css),
  site: SITE,
});

async function html(doc: BlockDocument, customCss?: CustomCssPolicy) {
  const stream = await renderToReadableStream(
    <PageRenderer
      document={doc}
      blocks={resolver}
      styleContext={{
        breakpoints: { viewport: [], container: [] },
        ...(customCss === undefined ? {} : { customCss }),
      }}
    />
  );
  await stream.allReady;
  return new Response(stream).text();
}

describe("custom CSS on a rendered page", () => {
  it("draws the site's, the page's and the block's, in that order, after the builder's", async () => {
    const out = await html(document(), checker());
    const builder = out.indexOf("#111111");
    const site = out.indexOf(SITE);
    const page = out.indexOf(PAGE);
    const block = out.indexOf(`.${nodeClassName("t1")}{border:4px solid blue}`);
    expect(builder).toBeGreaterThan(-1);
    expect(site).toBeGreaterThan(builder);
    expect(page).toBeGreaterThan(site);
    expect(block).toBeGreaterThan(page);
  });

  it("draws none of it with no checker", async () => {
    const out = await html(document());
    expect(out).toContain("#111111");
    expect(out).not.toContain("site-mark");
    expect(out).not.toContain("page-mark");
    expect(out).not.toContain("border:4px solid blue");
  });

  it("leaves out what the checker refuses, the document keeping it", async () => {
    const doc = document();
    const out = await html(doc, checker([BLOCK, PAGE]));
    expect(out).toContain(SITE);
    expect(out).not.toContain("page-mark");
    expect(out).not.toContain("border:4px solid blue");
    expect(doc.settings?.customCss).toBe(PAGE);
    expect(doc.nodes[0]?.customCss).toBe(BLOCK);
  });
});
