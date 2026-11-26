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
      // Then the dates every entry holds by itself, the lifecycle off.
      { name: "createdAt", label: "Created", kind: "built-in" },
      { name: "updatedAt", label: "Updated", kind: "built-in" },
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

  it("says a plugin's Single was made in code, and names no maker for its collection", async () => {
    const items = await listedBy(
      { collections: ["events"], singles: ["landing"] },
      siteContext(
        [{ slug: "events", source: "plugin:@acme/shop" }],
        [{ slug: "landing", label: "Landing", source: "plugin:@acme/shop" }]
      )
    );
    expect(items.map(({ kind, source }) => [kind, source])).toEqual([
      ["collection", undefined],
      ["single", "code"],
    ]);
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

describe("the fields a detail may be read from", () => {
  /** A site with one collection and one Single, each with or without the lifecycle. */
  function datedContext(status: boolean): PluginRouteContext {
    const fields = [
      { name: "title", type: "text", label: "Title" },
      {
        name: "seo",
        type: "group",
        fields: [{ name: "ogImage", type: "upload", label: "Share image" }],
      },
    ];
    return {
      user: { id: "u1" },
      caller: { can: async () => true },
      services: {
        collections: {
          getCollection: async () => ({
            labels: { plural: "Cases" },
            status,
            fields,
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
        singles: {
          list: async () => ({
            data: [{ slug: "home", label: "Home", status, fields }],
          }),
        },
      },
    } as unknown as PluginRouteContext;
  }

  const fieldsOf = (item: Record<string, unknown> | undefined) =>
    item?.mappableFields as { name: string; label: string; kind?: string }[];

  it("offers the entry's own dates after its declared fields, and the first publication only with the lifecycle", async () => {
    for (const status of [false, true]) {
      const [collection, single] = await listedBy(
        { collections: ["cases"], singles: ["home"] },
        datedContext(status)
      );
      const own = [
        { name: "createdAt", label: "Created", kind: "built-in" },
        { name: "updatedAt", label: "Updated", kind: "built-in" },
        ...(status
          ? [
              {
                name: "firstPublishedAt",
                label: "First published",
                kind: "built-in",
              },
            ]
          : []),
      ];
      for (const item of [collection, single]) {
        expect(fieldsOf(item)).toEqual([
          { name: "title", label: "Title" },
          { name: "seo.ogImage", label: "SEO › Share image", kind: "seo" },
          ...own,
        ]);
      }
    }
  });
});
