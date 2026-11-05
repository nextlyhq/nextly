// @vitest-environment jsdom
/**
 * What a collection loop gets back from `listLoopCollections`, and what it
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

  it("keeps each collection and field of the promised shape, and drops the rest", async () => {
    readPluginRoute.mockResolvedValue({
      items: [
        {
          slug: "posts",
          label: "Blog posts",
          sortFields: [
            { name: "title", label: "Title", date: false },
            { name: "broken", label: "Broken" },
          ],
        },
        { slug: 3, label: "Not a collection" },
      ],
      meta: {},
    });
    expect(await listLoopCollections()).toEqual([
      {
        slug: "posts",
        label: "Blog posts",
        sortFields: [{ name: "title", label: "Title", date: false }],
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
