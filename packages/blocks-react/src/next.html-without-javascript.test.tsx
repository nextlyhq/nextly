/**
 * A published page's HTML holds the page, for a visitor or crawler without
 * JavaScript.
 *
 * With Cache Components on, Next.js renders with React's experimental build,
 * which outlines a finished Suspense boundary out of the HTML around it when
 * the boundary holds an image that loads eagerly, or once the page sent before
 * it passes React's chunk size (12.8 kB): the boundary's content is sent in a
 * `<div hidden id="S:…">` and only React's inline `$RC` script moves it into
 * place. Without JavaScript it stays hidden. So a published render places no
 * boundary around content that is ready when the page is made, which is every
 * page a prerender or a cached render produces.
 *
 * The React these tests run writes a finished boundary inline, so what is
 * pinned is the cause rather than the symptom: no boundary at all, seen as
 * React's boundary marker (`<!--$`) missing from the HTML, with the page's
 * content in it. What a visitor is sent by a production build is the browser
 * suite's (`e2e/tests/production/published-pages-without-javascript.spec.ts`).
 *
 * Rendered with `prerender` from `react-dom/static`, the renderer Next.js
 * builds a page ahead of time with, through the real public route factories,
 * with Cache Components on. The page holds an eager image, more than a chunk
 * of text and an asynchronous block, which renders inside a boundary of its
 * own wherever it is given one.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type AnyBlockDefinition,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { Suspense, type ReactElement } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { coreBlocks } from "./blocks";
import { defineBlock } from "./context";
import {
  createBlocksPage,
  createPublicBlocksPage,
  createPublicSinglePage,
} from "./next";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

/** What React writes where it outlines a boundary's content. */
const OUTLINED = /<div hidden id="S:\d+"/;

/** React's marker for a Suspense boundary, written for every one it renders. */
const BOUNDARY = "<!--$";

/** A block that waits before it draws an eager image and its words. */
const lateImage = defineBlock({
  name: "test/late-image",
  version: 1,
  description: "Awaits, then draws an eager image and a line of text.",
  example: { props: {} },
  render: async ({ className }) => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return (
      <figure className={className}>
        <img src="/uploads/hero.webp" alt="The hero" />
        <figcaption>The late caption</figcaption>
      </figure>
    );
  },
});

/** A block whose asynchronous render rejects. */
const lateFailure = defineBlock({
  name: "test/late-failure",
  version: 1,
  description: "Awaits, then throws.",
  example: { props: {} },
  render: async () => {
    await Promise.resolve();
    throw new Error("the late block failed");
  },
});

const blocks = createBlockResolver([
  ...coreBlocks,
  lateImage as AnyBlockDefinition,
  lateFailure as AnyBlockDefinition,
]);

/** Over React's 12.8 kB chunk on its own. */
const LONG_TEXT = "A sentence an author wrote for the page. ".repeat(400);

/** The published page: a heading, a long paragraph and a late image. */
const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "h",
      type: "core/heading",
      version: 1,
      props: { text: "The welcome heading", level: "h1" },
    },
    { id: "t", type: "core/text", version: 1, props: { text: LONG_TEXT } },
    { id: "i", type: "test/late-image", version: 1, props: {} },
  ],
};

/** A reader serving PAGE as the one page, or as the Single. */
function pageReader() {
  const document = {
    id: "p1",
    slug: "welcome",
    title: "Welcome",
    content: PAGE,
  };
  return {
    findSingle: vi.fn(async () => document),
    find: vi.fn(async () => ({
      items: [document],
      meta: { hasNext: false },
    })),
    findByID: vi.fn(async () => null),
    media: { findByID: vi.fn(async () => null) },
  };
}

/** The HTML a build makes of `page`, as a prerender writes it. */
async function prerendered(page: ReactElement): Promise<string> {
  const { prelude } = await prerender(page, {
    onError(error) {
      throw error;
    },
  });
  return await new Response(prelude).text();
}

/** What a visitor without JavaScript sees: the HTML minus outlined parts. */
function shownWithoutJavaScript(html: string): string {
  return html.replace(/<div hidden id="S:\d+">[\s\S]*?<\/div>(?=<script)/g, "");
}

describe("a published page's HTML without JavaScript", () => {
  beforeEach(() => {
    vi.stubEnv("__NEXT_CACHE_COMPONENTS", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["createPublicBlocksPage", "content"],
    ["createPublicSinglePage", "single"],
  ] as const)(
    "%s sends the page in its HTML, with no part React reveals by script",
    async (_, shape) => {
      const page =
        shape === "content"
          ? await createPublicBlocksPage({
              collections: ["pages"],
              field: "content",
              blocks,
              nextly: pageReader() as never,
            }).ContentPage({
              params: Promise.resolve({ slug: ["welcome"] }),
            })
          : await createPublicSinglePage({
              slug: "homepage",
              field: "content",
              blocks,
              nextly: pageReader() as never,
            }).SinglePage();

      const html = await prerendered(page);

      expect(html).not.toContain(BOUNDARY);
      expect(html).not.toMatch(OUTLINED);
      const shown = shownWithoutJavaScript(html);
      expect(shown).toContain("The welcome heading");
      expect(shown).toContain(LONG_TEXT.trim());
      expect(shown).toContain("The late caption");
      expect(shown).toContain('src="/uploads/hero.webp"');
    }
  );

  it("still answers a page that reads the visitor inside a boundary, which a prerender stops at", async () => {
    // An access-enforced page reads as the visitor, at request time, so its
    // body must sit beneath a boundary for Next.js to build the rest: the
    // limit of a per-request route, kept as it was.
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks,
      nextly: pageReader() as never,
    });

    const page = (await route.ContentPage({
      params: Promise.resolve({ slug: ["welcome"] }),
    })) as ReactElement;

    expect(page.type).toBe(Suspense);
  });
});

describe("an asynchronous block on a published render", () => {
  it("is drawn in place in the page's HTML, with no boundary of its own", async () => {
    const html = await prerendered(
      <PageRenderer document={PAGE} blocks={blocks} />
    );

    expect(html).not.toContain(BOUNDARY);
    expect(html).not.toMatch(OUTLINED);
    expect(shownWithoutJavaScript(html)).toContain("The late caption");
  });

  it("that rejects still shows its placeholder, and the page around it", async () => {
    const html = await prerendered(
      <PageRenderer
        document={{
          ...PAGE,
          nodes: [
            PAGE.nodes[0]!,
            { id: "f", type: "test/late-failure", version: 1, props: {} },
          ],
        }}
        blocks={blocks}
      />
    );

    expect(html).toContain('data-nx-block-placeholder="render-error"');
    expect(html).toContain("The welcome heading");
    expect(html).not.toContain(BOUNDARY);
  });

  it.each([
    ["an editor surface (node addresses)", { nodeAttribute: true }],
    ["an editor surface (kept outputs)", { keepAsyncOutputs: true }],
    ["a render that shows a fallback", { blockFallback: "Loading" }],
  ] as const)("keeps its own boundary on %s", async (_, props) => {
    const html = await prerendered(
      <PageRenderer document={PAGE} blocks={blocks} {...props} />
    );

    expect(html).toContain(BOUNDARY);
    expect(html).toContain("The late caption");
  });
});
