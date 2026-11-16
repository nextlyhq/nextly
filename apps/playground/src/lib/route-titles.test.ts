/**
 * The browser tab of a page this site serves: the page's own title, never the
 * text of a heading on it.
 *
 * Each route is loaded against the real `nextly.config.ts`, twice: once as a
 * site without the SEO plugin, and once with it, through the switch the
 * config reads. A page whose first block is an H2 is the case that went
 * wrong: its heading offered itself as the title and won over the page's own.
 */
import {
  type BlockDocument,
  deriveSeoFromDocument,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import type { RenderContext } from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const PAGE_TITLE = "Pricing";
const HEADING = "A section title";

/** The page's content: an H2 as its first block. */
const content: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "heading",
      type: "core/heading",
      version: 1,
      props: { text: HEADING, level: "h2" },
    },
  ],
};

/** A page titled "Pricing" whose first block is an H2. */
const entry = { id: "page-1", title: PAGE_TITLE, slug: "pricing", content };

/**
 * What the page's blocks offer for its head, as the route helper works it
 * out: the title and description as offered, and no image, which this page
 * has none of.
 */
function derivedOf(document: BlockDocument) {
  const blocks = createBlockResolver(coreBlocks);
  const { image: _candidates, ...offered } = deriveSeoFromDocument(
    document,
    type => blocks.get(type),
    () => true
  );
  return offered;
}

const context = { collection: "pages", slug: "pricing" } as RenderContext;

/** Loading the routes loads the whole site config, which takes a while cold. */
const LOAD_TIMEOUT = 60_000;

/** The three routes' metadata, loaded as a site with or without the SEO plugin. */
async function routes(seoPlugin: boolean) {
  vi.resetModules();
  vi.stubEnv("NEXTLY_PLAYGROUND_PLUGINS", seoPlugin ? "seo" : "");
  const [{ pagesRoute }, { blockPagesRoute }, { singleMetadata }] =
    await Promise.all([
      import("./pages-route"),
      import("./block-pages-route"),
      import("./site-content"),
    ]);
  const derived = derivedOf(content);
  return {
    pages: await pagesRoute.metadata?.(entry, context, derived),
    blockPages: await blockPagesRoute.metadata?.(entry, context, derived),
    single: singleMetadata(entry, context, derived),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the browser tab's title", () => {
  it("is offered the heading by the page's blocks", () => {
    // The control: without it, a derivation that offered nothing would make
    // every assertion below pass for the wrong reason.
    expect(derivedOf(content).title).toBe(HEADING);
  });

  it(
    "is the page's own title on a site without the SEO plugin",
    async () => {
      const { pages, blockPages, single } = await routes(false);
      expect(pages?.title).toBe(PAGE_TITLE);
      expect(blockPages?.title).toBe(PAGE_TITLE);
      expect(single.title).toBe(PAGE_TITLE);
    },
    LOAD_TIMEOUT
  );

  it(
    "is left to the SEO plugin where it runs",
    async () => {
      // A title a route states outranks the plugin's title pattern, so the
      // route states none and the plugin works the title out itself.
      const { pages, blockPages, single } = await routes(true);
      expect(pages?.title).toBeUndefined();
      expect(blockPages?.title).toBeUndefined();
      expect(single.title).toBeUndefined();
    },
    LOAD_TIMEOUT
  );
});
