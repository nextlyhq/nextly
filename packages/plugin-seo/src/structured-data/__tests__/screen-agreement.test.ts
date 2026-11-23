/**
 * The Content types screen and the page's structured data answer one
 * question, whether a type's detail has a field holding it, from two places:
 * the screen from the fields the content types route lists, the page from the
 * entry it renders. This holds the two answers equal over a table of
 * mappings, for an entry as core returns it, its own dates included, so the
 * screen never warns of a detail the page has, nor passes one it lacks.
 */
import type {
  PageMetadataAnswer,
  PageMetadataInput,
  PluginContext,
  PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  typesWithoutAddress: async () => [],
  publicAddressOf: async () => ({ status: "none" }),
  languageAddressOf: async (path: string) => ({ status: "resolved", path }),
  addressOfRequest: async (url: URL) => ({ locale: "en", path: url.pathname }),
}));
// The address record, holding no address here.
vi.mock("../../address-record/store", async importOriginal => ({
  ...(await importOriginal()),
  ...(await import("../../address-record/__tests__/record-double"))
    .recordDouble,
}));

import { draftOf, missingDetails } from "../../admin/settings-draft";
import { contentTypesRoute } from "../../settings/content-types-route";
import type { SeoContentType } from "../../settings/contract";
import { STRUCTURED_DATA_TYPES } from "../catalog";
import { buildStructuredData } from "../graph";
import type { DetailMapping } from "../rules";

/** A type declaring a byline, a date, a group with a date, and the SEO group. */
const DECLARED = [
  { name: "title", type: "text", label: "Title" },
  { name: "byline", type: "text", label: "Byline" },
  { name: "published", type: "date", label: "Published" },
  {
    name: "event",
    type: "group",
    label: "Event",
    fields: [{ name: "startsAt", type: "date", label: "Starts at" }],
  },
  {
    name: "seo",
    type: "group",
    fields: [{ name: "ogImage", type: "upload", relationTo: "media" }],
  },
];

/** An entry as core returns it: its declared fields, and the row's own dates. */
const ENTRY = {
  id: "c1",
  title: "Guide to keyword cannibalization",
  byline: "Sara Khan",
  published: "2026-09-01",
  event: { startsAt: "2026-09-02" },
  seo: {
    ogImage: { id: "m1", url: "/media/cover.jpg", width: 1200, height: 630 },
  },
  createdAt: "2026-09-03T09:14:20.705Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

/** The type as the content types route lists it to the screen. */
async function listedType(): Promise<SeoContentType> {
  const ctx = {
    user: { id: "u1" },
    caller: { can: async () => true },
    services: {
      collections: {
        getCollection: async () => ({
          labels: { plural: "Case studies" },
          fields: DECLARED,
        }),
        listCollections: async () => ({
          data: [],
          pagination: { total: 0, hasMore: false },
        }),
        listEntries: async () => ({
          data: [],
          pagination: { total: 0, limit: 1, offset: 0, hasMore: false },
        }),
      },
    },
  } as unknown as PluginRouteContext;
  const response = await contentTypesRoute({
    collections: ["cases"],
  }).handler(new Request("http://x/"), ctx);
  const body = (await (response as Response).json()) as {
    items: SeoContentType[];
  };
  const type = body.items[0];
  if (type === undefined) throw new Error("the route listed no type");
  return type;
}

function pageContext(): PluginContext {
  return {
    self: { collections: {} },
    config: {},
    publicAddresses: { defaultLanguage: async () => "en" },
    services: {
      ownCollections: { listEntries: async () => ({ data: [] }) },
      collections: {
        getCollection: async (slug: string) => ({
          name: slug,
          schemaDefinition: { fields: DECLARED },
        }),
      },
      singles: { list: async () => ({ total: 0, data: [] }) },
    },
  } as unknown as PluginContext;
}

const ANSWER: PageMetadataAnswer = {
  title: "Guide",
  description: "A guide.",
  canonical: "/cases/guide",
  robots: { index: true, follow: true },
};

const INPUT: PageMetadataInput = {
  path: "/cases/guide",
  locale: "en",
  source: { kind: "entry", collection: "cases", entry: ENTRY },
  code: {},
  derived: {},
};

/** What the page lacks of a Blog post's needed details, for a mapping. */
async function pageMissing(mapping: DetailMapping): Promise<string[]> {
  const { problems } = await buildStructuredData(pageContext(), INPUT, ANSWER, {
    origin: "https://example.com",
    brand: { name: "Rext AI" },
    types: {
      cases: { type: "blogPosting", details: { blogPosting: mapping } },
    },
  });
  const needs: readonly string[] = STRUCTURED_DATA_TYPES.blogPosting.needs;
  return problems
    .map(problem => problem.detail)
    .filter(detail => needs.includes(detail))
    .sort();
}

/** What the screen calls missing, for the same mapping given in the plugin's options. */
async function screenMissing(mapping: DetailMapping): Promise<string[]> {
  const draft = draftOf(
    { id: "s1" },
    {
      structuredData: {
        cases: { type: "blogPosting", details: { blogPosting: mapping } },
      },
    }
  );
  return [...missingDetails(draft, await listedType(), "blogPosting")].sort();
}

// Each mapping with what both should call missing; the image is the
// page's share image unless mapped, and this page has none, so a mapping
// to the SEO group's image is what supplies it.
const CASES: [string, DetailMapping, string[]][] = [
  [
    "the created date",
    { datePublished: "createdAt", author: "byline", image: "seo.ogImage" },
    [],
  ],
  [
    "a declared date",
    { datePublished: "published", author: "byline", image: "seo.ogImage" },
    [],
  ],
  [
    "a date inside a group",
    { datePublished: "event.startsAt", author: "byline", image: "seo.ogImage" },
    [],
  ],
  [
    "a field that does not exist",
    { datePublished: "publishedOn", author: "byline", image: "seo.ogImage" },
    ["datePublished"],
  ],
  [
    "a missing author and nothing mapped to the date, found by its name",
    { author: "writer", image: "seo.ogImage" },
    ["author"],
  ],
];

describe("the Content types screen and the page agree on what is missing", () => {
  for (const [name, mapping, missing] of CASES) {
    it(`for ${name}`, async () => {
      const page = await pageMissing(mapping);
      // The page is the reference: it is what Google receives.
      expect(page).toEqual(missing);
      expect(await screenMissing(mapping)).toEqual(page);
    });
  }
});
