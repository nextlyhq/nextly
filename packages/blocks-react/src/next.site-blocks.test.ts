/**
 * A route given no `blocks` draws the blocks of the site the process serves,
 * read from its page builder on each render, and refuses rather than drawing
 * every block as unknown when there is no page builder. A route given
 * `blocks` draws exactly those.
 */
import {
  createBlockRegistry,
  DOCUMENT_FORMAT_VERSION,
  type AnyBlockDefinition,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { throughBoundary } from "./__tests__/through-boundary";
import { createBlocksPage } from "./next";
import type { PageRendererProps } from "./page-renderer";
import { createBlockResolver, SITE_BLOCKS_SERVICE } from "./resolver";

/** What the process's instance offers its routes, per test. */
let offered: Record<string, Record<string, unknown>> = {};

vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<typeof import("nextly/runtime")>()),
  requireNextly: () => ({ plugins: offered }),
}));

afterEach(() => {
  offered = {};
});

const document: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [],
};

function block(name: string): AnyBlockDefinition {
  return {
    name,
    version: 1,
    description: name,
    example: { props: {} },
    render: () => null,
  } as unknown as AnyBlockDefinition;
}

const reader = {
  find: vi.fn(async () => ({
    items: [{ id: "1", slug: "about", content: document }],
    meta: {},
  })),
  findByID: vi.fn(async () => null),
  media: { findByID: vi.fn(async () => null) },
};

async function rendered(
  config: Partial<Parameters<typeof createBlocksPage>[0]> = {}
): Promise<PageRendererProps> {
  const route = createBlocksPage({
    collections: ["pages"],
    field: "content",
    nextly: reader as never,
    ...config,
  });
  const element = (await throughBoundary(
    route.ContentPage({ params: { slug: ["about"] } })
  )) as ReactElement<PageRendererProps>;
  return element.props;
}

/** The site's registry as the page builder offers it. */
function offer(definitions: AnyBlockDefinition[]) {
  const site = createBlockRegistry();
  site.register(definitions);
  offered = {
    [SITE_BLOCKS_SERVICE.plugin]: { [SITE_BLOCKS_SERVICE.service]: site },
  };
}

describe("a route given no blocks", () => {
  it("draws the site's registered blocks, custom ones included", async () => {
    offer([block("acme/pricing")]);
    const { blocks } = await rendered();
    expect(blocks?.get("acme/pricing")?.name).toBe("acme/pricing");
    expect(blocks?.get("acme/banner")).toBeUndefined();
  });

  it("reads the site's blocks again on each render, as a reload replaces them", async () => {
    offer([block("acme/pricing")]);
    const { blocks } = await rendered();
    offer([block("acme/banner")]);
    expect(blocks?.get("acme/pricing")).toBeUndefined();
    expect(blocks?.get("acme/banner")?.name).toBe("acme/banner");
  });

  it("refuses, naming the page builder, when the instance has none", async () => {
    const { blocks } = await rendered();
    expect(() => blocks?.get("core/text")).toThrow(
      /no page builder to read them from/
    );
  });
});

describe("a route given blocks", () => {
  it("draws exactly those, whatever the site registered", async () => {
    offer([block("acme/pricing")]);
    const own = createBlockResolver([block("acme/banner")]);
    const { blocks } = await rendered({ blocks: own });
    expect(blocks).toBe(own);
    expect(blocks?.get("acme/pricing")).toBeUndefined();
  });
});
