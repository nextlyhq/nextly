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

import { contentTypesRoute } from "../content-types-route";

/** A reader's context whose one collection keeps `byline` in a group with no name. */
function context(): PluginRouteContext {
  return {
    user: { id: "u1" },
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
          ],
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
    const route = contentTypesRoute(["posts"]);
    const response = await route.handler(new Request("http://x/"), context());
    const body = (await (response as Response).json()) as {
      items: { fields: unknown; mappableFields: unknown }[];
    };

    expect(body.items[0]?.mappableFields).toEqual([
      { name: "title", label: "Title" },
      { name: "byline", label: "Byline" },
    ]);
    expect(body.items[0]?.fields).toEqual([
      { name: "byline", token: "Byline" },
    ]);
  });
});
