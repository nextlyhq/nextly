/**
 * A Page Builder page carries the structured data the content route hands
 * its render, in the HTML a crawler receives: as the body of one JSON-LD
 * script element, exactly as handed, beside the page's blocks.
 *
 * The route config is the one `createBlocksPage` and `createSinglePage` hand
 * the real content and Single routes; its `render` is called as those routes
 * call it, with `context.structuredData` set where a page-metadata provider
 * answered with some.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type {
  ContentRouteConfig,
  RenderContext,
  SingleRouteConfig,
} from "nextly/runtime";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handed: ContentRouteConfig<ReactElement>[] = [];
const handedSingles: SingleRouteConfig<ReactElement>[] = [];

vi.mock("nextly/runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("nextly/runtime")>();
  return {
    ...actual,
    createContentRoute: (config: ContentRouteConfig<ReactElement>) => {
      handed.push(config);
      return actual.createContentRoute(config);
    },
    createSingleRoute: (config: SingleRouteConfig<ReactElement>) => {
      handedSingles.push(config);
      return actual.createSingleRoute(config);
    },
    readPublicSiteSettings: async () => {
      throw new Error("no site settings");
    },
  };
});

const { createBlocksPage, createSinglePage } = await import("./next");
const { coreBlocks } = await import("./blocks");
const { createBlockResolver } = await import("./resolver");

const PRICING: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    { id: "1", type: "core/heading", version: 1, props: { text: "Pricing" } },
  ],
};

const ENTRY = { id: "p1", slug: "pricing", content: PRICING };
const CONTEXT: RenderContext = { collection: "pages", slug: "pricing" };

/**
 * Structured data as core writes it: no value can end its element, so a
 * `<` in a value is written `\u003c`.
 */
const STRUCTURED = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Pricing \\u003c/script> plans",
});

/** A reader holding the one page. */
function reader() {
  return {
    find: vi.fn(async () => ({
      items: [ENTRY],
      meta: { total: 1, hasNext: false },
    })),
    findByID: vi.fn(async () => null),
    findSingle: vi.fn(async () => null),
    media: { findByID: vi.fn(async () => null) },
  };
}

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

/** The JSON-LD script elements in `markup`, by their bodies. */
function jsonLd(markup: string): string[] {
  return [
    ...markup.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
    ),
  ].map(match => match[1] ?? "");
}

beforeEach(() => {
  handed.length = 0;
  handedSingles.length = 0;
});

describe("a Page Builder page's structured data", () => {
  it("is placed in the page's HTML exactly as the content route hands it", async () => {
    createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: reader() as never,
      blocks: createBlockResolver(coreBlocks),
    });
    const config = handed[0];

    const markup = await html(
      await config!.render(ENTRY, { ...CONTEXT, structuredData: STRUCTURED })
    );

    expect(jsonLd(markup)).toEqual([STRUCTURED]);
    expect(markup).toContain("Pricing");
  });

  it("places none where the route hands none", async () => {
    createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: reader() as never,
      blocks: createBlockResolver(coreBlocks),
    });
    const config = handed[0];

    const markup = await html(await config!.render(ENTRY, CONTEXT));

    expect(jsonLd(markup)).toEqual([]);
    expect(markup).toContain("Pricing");
  });

  it("is placed in a Page Builder Single's HTML as the Single route hands it", async () => {
    createSinglePage({
      slug: "homepage",
      field: "content",
      nextly: reader() as never,
      blocks: createBlockResolver(coreBlocks),
    });
    const config = handedSingles[0];

    const markup = await html(
      await config!.render(
        { id: "s1", content: PRICING },
        { slug: "homepage", structuredData: STRUCTURED }
      )
    );

    expect(jsonLd(markup)).toEqual([STRUCTURED]);
    expect(markup).toContain("Pricing");
  });
});
