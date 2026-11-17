/**
 * A route given no `maxQueries` renders under the site's page data limit,
 * which the page builder offers on the instance (`pageBuilder({ maxQueries
 * })`), so the editor's meter and the published page count against one
 * number. A route's own `maxQueries` wins; with neither, 500.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { throughBoundary } from "./__tests__/through-boundary";
import { DEFAULT_MAX_QUERIES } from "./context";
import { createBlocksPage } from "./next";
import type { PageRendererProps } from "./page-renderer";
import {
  createBlockResolver,
  offeredSitePageDataLimit,
  SITE_PAGE_DATA_LIMIT_SERVICE,
} from "./resolver";

/** What the process's instance offers its routes, per test. */
let offered: Record<string, Record<string, unknown>> | "no instance" = {};

vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<typeof import("nextly/runtime")>()),
  requireNextly: () => {
    if (offered === "no instance") {
      throw new Error("Nextly services not initialized.");
    }
    return { plugins: offered };
  },
}));

afterEach(() => {
  offered = {};
});

const document: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [],
};

const reader = {
  find: vi.fn(async () => ({
    items: [{ id: "1", slug: "about", content: document }],
    meta: {},
  })),
  findByID: vi.fn(async () => null),
  media: { findByID: vi.fn(async () => null) },
};

/** The site's limit as the page builder offers it. */
function offerLimit(maxQueries: unknown): void {
  offered = {
    [SITE_PAGE_DATA_LIMIT_SERVICE.plugin]: {
      [SITE_PAGE_DATA_LIMIT_SERVICE.service]: { maxQueries },
    },
  };
}

/** The reads the page's render may make, as its budget says. */
async function renderedCap(
  config: Partial<Parameters<typeof createBlocksPage>[0]> = {}
): Promise<number> {
  const route = createBlocksPage({
    collections: ["pages"],
    field: "content",
    nextly: reader as never,
    blocks: createBlockResolver([]),
    ...config,
  });
  const element = (await throughBoundary(
    route.ContentPage({ params: { slug: ["about"] } })
  )) as ReactElement<PageRendererProps>;
  const budget = element.props.context?.queries as
    | { report(): { cap: number } }
    | undefined;
  if (budget === undefined) throw new Error("The render has no budget.");
  return budget.report().cap;
}

describe("a route's page data limit", () => {
  it("is the site's, where the route sets none", async () => {
    offerLimit(20);
    expect(await renderedCap()).toBe(20);
  });

  it("is the route's own, where it sets one", async () => {
    offerLimit(20);
    expect(await renderedCap({ maxQueries: 7 })).toBe(7);
  });

  it("is 500 where the site offers none", async () => {
    expect(await renderedCap()).toBe(DEFAULT_MAX_QUERIES);
  });

  it("is 500 where the process has no instance registered", async () => {
    offered = "no instance";
    expect(await renderedCap()).toBe(DEFAULT_MAX_QUERIES);
  });

  it("is unlimited where the site says so", async () => {
    offerLimit(Infinity);
    expect(await renderedCap()).toBe(Infinity);
  });
});

describe("the site's offered limit", () => {
  it.each([
    [20, 20],
    [0, 0],
    [Infinity, Infinity],
    [-1, undefined],
    [2.5, undefined],
    [Number.NaN, undefined],
    ["20", undefined],
  ])("reads %s as %s", (given, read) => {
    offerLimit(given);
    expect(
      offeredSitePageDataLimit(
        offered as Record<string, Record<string, unknown>>
      )
    ).toBe(read);
  });

  it("is nothing where no page builder offers one", () => {
    expect(offeredSitePageDataLimit({})).toBeUndefined();
  });
});
