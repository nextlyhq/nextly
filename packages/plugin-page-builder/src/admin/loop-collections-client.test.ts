// @vitest-environment jsdom
/**
 * What a collection list gets back from `listLoopCollections`, and what it
 * asked.
 *
 * The two properties that fail quietly are the ADDRESS and the FAILURE: a
 * request to a path nothing serves, or a failure read as an empty list, both
 * look to an author like a site with no collections. The read goes through
 * the SDK's `readPluginRoute`, stood in for here.
 *
 * @module admin/loop-collections-client.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readPluginRoute = vi.hoisted(() => vi.fn());
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({ readPluginRoute }));

import { listLoopCollections } from "./loop-collections-client";

beforeEach(() => {
  readPluginRoute.mockReset();
});

describe("listLoopCollections", () => {
  it("asks the page builder's own loop collections route", async () => {
    readPluginRoute.mockResolvedValue({ items: [], meta: {} });
    await listLoopCollections();
    expect(readPluginRoute).toHaveBeenCalledTimes(1);
    expect(readPluginRoute.mock.calls[0]?.[0]).toEqual({
      plugin: "@nextlyhq/plugin-page-builder",
      path: "/loop-collections",
    });
  });

  it("asks in the language being edited, as a save judges the page's lists", async () => {
    readPluginRoute.mockResolvedValue({ items: [], meta: {} });
    await listLoopCollections("fr");
    expect(readPluginRoute.mock.calls[0]?.[0]).toEqual({
      plugin: "@nextlyhq/plugin-page-builder",
      path: "/loop-collections?locale=fr",
    });
  });

  it("keeps each collection, field and relation of the promised shape, and drops the rest", async () => {
    readPluginRoute.mockResolvedValue({
      items: [
        {
          slug: "posts",
          label: "Blog posts",
          singular: "Post",
          fields: [
            { name: "title", label: "Title", kind: "text" },
            {
              name: "kind",
              label: "Kind",
              kind: "choice",
              options: [{ value: "news", label: "News" }, { value: 3 }],
            },
            {
              name: "author",
              label: "Author",
              kind: "entry",
              relationTo: "authors",
            },
            { name: "day", label: "Day", kind: "date", dateOnly: true },
            { name: "broken", label: "Broken", kind: "relationship" },
            { name: "unkinded", label: "Unkinded" },
          ],
          relations: [
            {
              field: "categories",
              label: "Categories",
              collection: "categories",
            },
            { field: "nowhere", label: "Nowhere" },
          ],
          declared: ["id", "title", 4],
          readable: [
            { name: "title", type: "text" },
            {
              name: "tags",
              type: "relationship",
              hasMany: true,
              relationTo: ["a", "b"],
            },
            { name: "broken" },
          ],
        },
        { slug: "events", label: "Events" },
        { slug: 3, label: "Not a collection" },
      ],
      meta: {},
    });
    expect(await listLoopCollections()).toEqual([
      {
        slug: "posts",
        label: "Blog posts",
        singular: "Post",
        fields: [
          { name: "title", label: "Title", kind: "text" },
          {
            name: "kind",
            label: "Kind",
            kind: "choice",
            options: [{ value: "news", label: "News" }],
          },
          {
            name: "author",
            label: "Author",
            kind: "entry",
            relationTo: "authors",
          },
          { name: "day", label: "Day", kind: "date", dateOnly: true },
        ],
        relations: [
          {
            field: "categories",
            label: "Categories",
            collection: "categories",
          },
        ],
        declared: ["id", "title"],
        readable: [
          { name: "title", type: "text" },
          {
            name: "tags",
            type: "relationship",
            hasMany: true,
            relationTo: ["a", "b"],
          },
        ],
      },
      // An answer from before singular names reads as its label, with nothing to name.
      {
        slug: "events",
        label: "Events",
        singular: "Events",
        fields: [],
        relations: [],
        declared: [],
        readable: [],
      },
    ]);
  });

  it("rejects an answer that is not a list, rather than reading it as none", async () => {
    readPluginRoute.mockResolvedValue({ message: "nope" });
    await expect(listLoopCollections()).rejects.toThrow(
      "Collections could not be listed."
    );
  });

  it("rejects when the route refuses", async () => {
    readPluginRoute.mockRejectedValue(new Error("Forbidden"));
    await expect(listLoopCollections()).rejects.toThrow("Forbidden");
  });
});
