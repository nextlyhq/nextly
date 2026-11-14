/**
 * The fields the content types route offers for a type that lays fields out
 * in a group with no name: a registry-built shape `defineCollection` refuses,
 * so it is built here as the stored collection reads.
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  typesWithoutAddress: async () => [],
  publicAddressOf: async () => ({ status: "resolved", path: "/blog/a" }),
}));

import {
  contentTypesRoute,
  settingsDocumentRoute,
} from "../content-types-route";

/**
 * A context for someone holding site-wide SEO, whose one collection keeps
 * `byline` in a group with no name.
 */
function context(): PluginRouteContext {
  return {
    user: { id: "u1" },
    caller: { can: async () => true },
    services: {
      collections: {
        getCollection: async () => ({
          labels: { plural: "Blog posts" },
          fields: [
            { name: "title", type: "text" },
            {
              type: "group",
              label: "Credits",
              fields: [{ name: "byline", type: "text", label: "Byline" }],
            },
            {
              name: "event",
              type: "group",
              label: "Event",
              fields: [{ name: "startsAt", type: "date", label: "Starts at" }],
            },
          ],
        }),
        listCollections: async () => ({
          data: [],
          pagination: { total: 0, limit: 100, offset: 0, hasMore: false },
        }),
        listEntries: async () => ({
          data: [{ title: "A", byline: "Ada" }],
          pagination: { total: 1, limit: 1, offset: 0, hasMore: false },
        }),
      },
    },
  } as unknown as PluginRouteContext;
}

describe("the content types route", () => {
  it("offers the fields a group with no name lays out, which the entry itself holds", async () => {
    const route = contentTypesRoute({ collections: ["posts"] });
    const response = await route.handler(new Request("http://x/"), context());
    const body = (await (response as Response).json()) as {
      items: { fields: unknown; mappableFields: unknown }[];
    };

    expect(body.items[0]?.mappableFields).toEqual([
      { name: "title", label: "Title" },
      { name: "byline", label: "Byline" },
      // A named group, and each field in it by its path.
      { name: "event", label: "Event" },
      { name: "event.startsAt", label: "Event › Starts at" },
    ]);
    expect(body.items[0]?.fields).toEqual([
      { name: "byline", token: "Byline" },
    ]);
  });
});

describe("the settings document route", () => {
  /** What the route answers, its body as the screen reads it. */
  async function answer(
    can: (action: string, resource: string) => Promise<boolean> = async () =>
      true
  ): Promise<{
    single?: string;
    serverAddresses?: unknown;
    canChange?: unknown;
  }> {
    const ctx = {
      ...context(),
      caller: { can },
      self: { singles: { "seo-settings": "site-seo" } },
    } as unknown as PluginRouteContext;
    const response = await settingsDocumentRoute().handler(
      new Request("http://x/"),
      ctx
    );
    const json = (await (response as Response).json()) as {
      data?: unknown;
    } & Record<string, unknown>;
    return (json.data ?? json) as {
      single?: string;
      serverAddresses?: unknown;
      canChange?: unknown;
    };
  }

  it("names the production addresses the server sets, which win over saved ones", async () => {
    vi.stubEnv(
      "NEXTLY_PRODUCTION_ADDRESSES",
      "https://example.com, https://de.example.com/"
    );
    try {
      expect(await answer()).toEqual({
        single: "site-seo",
        serverAddresses: ["https://example.com", "https://de.example.com"],
        canChange: true,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("names none where the server sets none", async () => {
    vi.stubEnv("NEXTLY_PRODUCTION_ADDRESSES", "");
    try {
      expect((await answer()).serverAddresses).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("says whether the reader may change the settings, asked of the Single the host registered", async () => {
    const asked: string[] = [];
    const body = await answer(async (action, resource) => {
      asked.push(`${action} ${resource}`);
      // Site-wide SEO and the Single's read, but not its update.
      return action !== "update";
    });
    expect(body.canChange).toBe(false);
    expect(asked).toContain("update site-seo");
  });
});

/** A collection as core lists it. */
interface Listed {
  slug: string;
  source: string;
  label?: string;
  fields?: unknown[];
}

/**
 * A context for someone holding site-wide SEO on a site whose collections
 * `listed` and Singles `singles` are as given.
 */
function siteContext(
  listed: Listed[],
  singles: { slug: string; label: string; source: string }[] = []
): PluginRouteContext {
  return {
    user: { id: "u1" },
    caller: { can: async () => true },
    services: {
      collections: {
        getCollection: async (slug: string) => {
          const found = listed.find(each => each.slug === slug);
          return {
            slug,
            source: found?.source,
            labels: { plural: found?.label ?? slug },
            fields: found?.fields ?? [{ name: "title", type: "text" }],
          };
        },
        listCollections: async () => ({
          data: listed.map(each => ({
            slug: each.slug,
            source: each.source,
            labels: { plural: each.label ?? each.slug },
            fields: each.fields ?? [{ name: "title", type: "text" }],
          })),
          pagination: { total: listed.length, hasMore: false },
        }),
        listEntries: async () => ({
          data: [{ title: "A" }],
          pagination: { total: 3, limit: 1, offset: 0, hasMore: false },
        }),
      },
      singles: {
        list: async () => ({
          data: singles.map(each => ({
            ...each,
            fields: [{ name: "title", type: "text" }],
          })),
        }),
      },
    },
  } as unknown as PluginRouteContext;
}

async function listedBy(
  types: { collections: string[]; singles?: string[] },
  ctx: PluginRouteContext
): Promise<Record<string, unknown>[]> {
  const response = await contentTypesRoute({
    singles: [],
    ...types,
  }).handler(new Request("http://x/"), ctx);
  const body = (await (response as Response).json()) as {
    items: Record<string, unknown>[];
  };
  return body.items;
}

describe("the content types route, for the Content types tab", () => {
  it("says where each type was made, in code or in the Schema Builder", async () => {
    const items = await listedBy(
      { collections: ["posts", "products"] },
      siteContext([
        { slug: "posts", source: "code" },
        { slug: "products", source: "ui" },
      ])
    );
    expect(
      items.map(({ key, kind, source }) => ({ key, kind, source }))
    ).toEqual([
      { key: "posts", kind: "collection", source: "code" },
      { key: "products", kind: "collection", source: "builder" },
    ]);
  });

  it("lists each Single with SEO by its key, after the collections", async () => {
    const items = await listedBy(
      { collections: ["posts"], singles: ["home"] },
      siteContext(
        [{ slug: "posts", source: "code" }],
        [{ slug: "home", label: "Home page", source: "ui" }]
      )
    );
    expect(items[1]).toMatchObject({
      key: "single:home",
      kind: "single",
      label: "Home page",
      source: "builder",
    });
  });

  it("says why a site's own type has no SEO: left out in code, or its own seo field", async () => {
    const items = await listedBy(
      { collections: ["posts"] },
      siteContext([
        { slug: "posts", source: "code" },
        {
          slug: "landing",
          source: "code",
          label: "Landing pages",
          fields: [
            { name: "title", type: "text" },
            { name: "seo", type: "group", fields: [] },
          ],
        },
        { slug: "docs-old", source: "ui", label: "Docs (old)" },
      ])
    );
    const without = items.filter(item => item.seo === false);
    expect(
      without.map(({ key, reason, source }) => ({ key, reason, source }))
    ).toEqual([
      { key: "landing", reason: "own-seo", source: "code" },
      { key: "docs-old", reason: "left-out", source: "builder" },
    ]);
  });
});
