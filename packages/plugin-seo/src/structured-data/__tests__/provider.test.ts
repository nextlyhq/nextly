/**
 * A page's structured data reaches core with its head, from the same answer.
 *
 * What each case pins:
 * - the plugin's page-metadata provider answers each page's structured data
 *   beside its head, built from that answer's title, address and image;
 * - a page with none gets an answer without any, and the provider's cache
 *   tags are kept;
 * - the SEO tab and the problem list read the same build;
 * - the plugin's options are checked when it is created, so a misspelled
 *   type or detail fails at start.
 */
import type {
  PageMetadataInput,
  PageMetadataResolver,
  PluginContext,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { seoPlugin } from "../../plugin";
import {
  pageStructuredData,
  structuredDataProblems,
  withStructuredData,
} from "../provider";
import { rulesFromOptions } from "../rules";

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  publicAddressOf: async () => ({ status: "resolved", path: "/blog/hello" }),
  languageAddressOf: async (path: string) => ({ status: "resolved", path }),
  // The SEO settings as stored: nothing saved unless a test saves some, so
  // the plugin's options answer.
  getCachedNextly: async () => ({ findSingle: async () => savedSettings }),
}));

/** The SEO settings a test has saved. */
let savedSettings: Record<string, unknown> = {};

/**
 * A context whose content types declare no relationships, on a site whose
 * address record holds no page's address yet.
 */
const ctx = {
  self: { collections: {} },
  config: {},
  publicAddresses: { defaultLanguage: async () => "en" },
  services: {
    ownCollections: { listEntries: async () => ({ data: [] }) },
    collections: {
      getCollection: async () => ({ schemaDefinition: { fields: [] } }),
    },
  },
  // The plugin's own Singles, none renamed by the host.
  self: { singles: {}, collections: {} },
} as unknown as PluginContext;

const input: PageMetadataInput = {
  path: "/blog/hello",
  source: {
    kind: "entry",
    collection: "posts",
    entry: {
      id: "p1",
      title: "Hello",
      writer: "Sara",
      publishedAt: "2026-11-01",
    },
  },
  code: {},
  derived: {},
};

const head: PageMetadataResolver = {
  tags: () => ["media"],
  resolve: () => ({
    title: "Hello, answered",
    canonical: "/blog/hello",
    social: { image: { url: "/media/hello.png" } },
  }),
};

describe("withStructuredData", () => {
  it("adds the page's structured data to the answer its head is built from", async () => {
    const resolver = withStructuredData(
      ctx,
      head,
      rulesFromOptions("https://example.com", {})
    );

    const answer = await resolver.resolve(input);

    expect(answer.title).toBe("Hello, answered");
    const article = answer.structuredData?.find(
      node => node["@type"] === "Article"
    );
    // The head's own title, not one worked out beside it.
    expect(article?.headline).toBe("Hello, answered");
    expect(resolver.tags?.(input)).toEqual(["media"]);
  });

  it("answers a page with no structured data without any", async () => {
    const resolver = withStructuredData(
      ctx,
      head,
      rulesFromOptions(undefined, {})
    );

    expect(await resolver.resolve(input)).toEqual(await head.resolve(input));
  });
});

describe("the plugin's page-metadata provider", () => {
  it("answers each page's structured data with its head", async () => {
    const plugin = seoPlugin({
      collections: ["posts"],
      baseUrl: "https://example.com",
      structuredData: { types: { posts: { type: "webPage" } } },
    });
    const service = plugin.contributes?.services?.pageMetadata;
    const resolver = (
      service as (context: PluginContext) => PageMetadataResolver
    )(ctx);

    const answer = await resolver.resolve(input);

    // No site name or brand is set, so only the page is described.
    expect(answer.structuredData?.map(node => node["@type"])).toEqual([
      "WebPage",
    ]);
    expect(answer.structuredData?.[0]?.["@id"]).toBe(
      "https://example.com/blog/hello"
    );
  });
});

describe("the SEO tab and the problem list", () => {
  const readers = {
    readStructuredDataRules: rulesFromOptions("https://example.com", {
      types: { posts: { type: "product" } },
    }),
  };

  it("read the type a page is described as, and what it offers", async () => {
    const result = await pageStructuredData(ctx, input, readers);

    expect(result.type).toBe("product");
    expect(result.chosen).toBe("type");
    expect(result.offered).toContain("localBusiness");
  });

  it("list each detail the chosen type is missing", async () => {
    expect(
      (await structuredDataProblems(ctx, input, readers)).map(
        problem => problem.message
      )
    ).toEqual(["Missing: price.", "Missing: availability."]);
  });
});

describe("the problem list with no readers given", () => {
  it("reads the type the SEO settings chose, as the page's own markup does", async () => {
    savedSettings = {
      productionAddresses: ["https://example.com"],
      structuredData: { posts: { type: "product" } },
    };
    try {
      expect(
        (await structuredDataProblems(ctx, input)).map(
          problem => problem.message
        )
      ).toEqual(["Missing: price.", "Missing: availability."]);
    } finally {
      savedSettings = {};
    }
  });
});

describe("the plugin's structured data options", () => {
  it.each([
    ["a type not offered", { posts: { type: "faqPage" } }],
    ["a mapping for a type not offered", { posts: { details: { faq: {} } } }],
    [
      "a detail no type has",
      { posts: { details: { product: { colour: "colour" } } } },
    ],
    [
      "a detail read from nowhere",
      { posts: { details: { product: { price: "" } } } },
    ],
  ])("refuses %s when the plugin is created", (_, types) => {
    expect(() =>
      seoPlugin({
        collections: ["posts"],
        structuredData: { types: types as never },
      })
    ).toThrow(/seoPlugin: structuredData\.types\.posts/);
  });

  it("accepts a field, a field in a group, and a fixed value", () => {
    expect(() =>
      seoPlugin({
        collections: ["posts"],
        structuredData: {
          types: {
            posts: {
              type: "product",
              details: {
                product: {
                  price: "price",
                  availability: "stock.status",
                  currency: { value: "EUR" },
                },
              },
            },
          },
        },
      })
    ).not.toThrow();
  });
});
