/**
 * What a Page Builder route hands the content route for a page's head, so a
 * plugin that provides page metadata hears what the page's blocks say.
 *
 * The content route asks a provider with the `derivedMetadata` its config
 * carries; this pins that `createBlocksPage` always gives one, worked out the
 * way the render draws the page, even when the route sets no `metadata` of its
 * own, and that it does so without a second walk when it does. The real
 * `createContentRoute` builds the route throughout: the wrapper only keeps the
 * config it was handed.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type {
  ContentRouteConfig,
  RenderContext,
  SingleRouteConfig,
} from "nextly/runtime";
import type { ReactElement } from "react";
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
    createPublicContentRoute: (config: ContentRouteConfig<ReactElement>) => {
      handed.push(config);
      return actual.createPublicContentRoute(config);
    },
    createSingleRoute: (config: SingleRouteConfig<ReactElement>) => {
      handedSingles.push(config);
      return actual.createSingleRoute(config);
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
    {
      id: "2",
      type: "core/text",
      version: 1,
      props: { text: "Plans for every team." },
    },
  ],
};

const ENTRY = { id: "p1", slug: "pricing", content: PRICING };
const CONTEXT: RenderContext = { collection: "pages", slug: "pricing" };

/** A reader that holds the one page, counting what it is asked. */
function reader() {
  return {
    find: vi.fn(async () => ({
      items: [ENTRY],
      meta: {
        total: 1,
        page: 1,
        limit: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    })),
    findByID: vi.fn(async () => null),
  };
}

beforeEach(() => {
  handed.length = 0;
  handedSingles.length = 0;
});

describe("a Page Builder route's offer for the head", () => {
  it("hands the content route what the blocks say, with no metadata of its own", async () => {
    createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: reader() as never,
      blocks: createBlockResolver(coreBlocks),
    });

    const config = handed[0];
    expect(config?.buildMetadata).toBeUndefined();
    expect(await config?.derivedMetadata?.(ENTRY, CONTEXT)).toEqual({
      title: "Pricing",
      description: "Plans for every team.",
    });
  });

  it("works the blocks out once when its own metadata asks for them too", async () => {
    // Every walk of the page looks its blocks up, so the lookups count walks.
    const resolver = createBlockResolver(coreBlocks);
    const lookups = vi.fn((type: string) => resolver.get(type));
    createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: reader() as never,
      blocks: { get: lookups },
      metadata: (_entry, _context, derived) => ({ title: derived.title }),
    });
    const config = handed[0];

    const own = await config?.buildMetadata?.(ENTRY, CONTEXT);
    const afterOne = lookups.mock.calls.length;
    const offered = await config?.derivedMetadata?.(ENTRY, CONTEXT);

    expect(own).toEqual({ title: "Pricing" });
    expect(offered).toMatchObject({ title: "Pricing" });
    expect(afterOne).toBeGreaterThan(0);
    expect(lookups.mock.calls.length).toBe(afterOne);
  });
});

describe("a Page Builder Single's offer for the head", () => {
  it("hands the Single route what the blocks say", async () => {
    createSinglePage({
      slug: "homepage",
      field: "content",
      nextly: reader() as never,
      blocks: createBlockResolver(coreBlocks),
    });

    const config = handedSingles[0];
    expect(
      await config?.derivedMetadata?.(
        { id: "s1", content: PRICING },
        { slug: "homepage" }
      )
    ).toEqual({ title: "Pricing", description: "Plans for every team." });
  });
});
