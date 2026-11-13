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
  async function answer(): Promise<{
    single?: string;
    serverAddresses?: unknown;
  }> {
    const ctx = {
      ...context(),
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
});
