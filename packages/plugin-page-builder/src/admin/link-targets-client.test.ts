// @vitest-environment jsdom
/**
 * What the link control gets back from `findLinkTargets`, and what it asked.
 *
 * - The read is the pages search, in collection order, so the plugin's own
 *   Pages come first and each other collection's pages follow together.
 * - Each item keeps its address only where the search sent one, and is headed
 *   by its collection's plural name.
 * - A failure is a rejection, never an empty list.
 *
 * @module admin/link-targets-client.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readPluginRoute = vi.hoisted(() => vi.fn());
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({ readPluginRoute }));

import { PAGES_SEARCH_LIMIT_MAX } from "../pages-search-contract";
import { findLinkTargets, findLinkTargetsIn } from "./link-targets-client";

beforeEach(() => {
  readPluginRoute.mockReset();
});

/** What the one read asked for. */
function asked(): { plugin: string; path: string; signal?: AbortSignal } {
  expect(readPluginRoute).toHaveBeenCalledTimes(1);
  return readPluginRoute.mock.calls[0]?.[0];
}

/** The path's query, as a record. */
function queryOf(path: string): Record<string, string> {
  return Object.fromEntries(new URL(path, "http://admin.test").searchParams);
}

describe("findLinkTargets", () => {
  it("asks the pages search in collection order, capped at its most", async () => {
    readPluginRoute.mockResolvedValue({ items: [], meta: {} });
    const controller = new AbortController();

    await findLinkTargets({
      search: " pric ",
      limit: 500,
      signal: controller.signal,
    });

    const { plugin, path, signal } = asked();
    expect(plugin).toBe("@nextlyhq/plugin-page-builder");
    expect(new URL(path, "http://admin.test").pathname).toBe("/pages/search");
    expect(queryOf(path)).toEqual({
      q: "pric",
      limit: String(PAGES_SEARCH_LIMIT_MAX),
      order: "collection",
    });
    expect(signal).toBe(controller.signal);
  });

  it("keeps each page's address only where the search sent one, headed by its collection", async () => {
    readPluginRoute.mockResolvedValue({
      items: [
        {
          id: "p-1",
          collection: "pages",
          collectionLabel: "Page",
          collectionPluralLabel: "Pages",
          field: "content",
          title: "Pricing",
          path: "/pricing",
        },
        {
          id: "l-1",
          collection: "landing",
          collectionLabel: "Landing page",
          field: "content",
          title: "Promo",
        },
        // Not the contract's shape: left out rather than shown half-named.
        { id: 3, collection: "pages", title: "Broken" },
      ],
      meta: {},
    });

    // Strict, so a page sent with no address carries no `path` key at all.
    await expect(findLinkTargets({ search: "" })).resolves.toStrictEqual([
      {
        id: "p-1",
        collection: "pages",
        group: "Pages",
        title: "Pricing",
        path: "/pricing",
      },
      {
        id: "l-1",
        collection: "landing",
        group: "Landing page",
        title: "Promo",
      },
    ]);
  });

  it("searches in the language being edited when bound to one", async () => {
    readPluginRoute.mockResolvedValue({ items: [], meta: {} });
    await findLinkTargetsIn("fr")({ search: "prix" });
    expect(queryOf(asked().path)).toEqual({
      q: "prix",
      order: "collection",
      locale: "fr",
    });

    // Unbound to a language, the search names none and the route reads the
    // default locale.
    readPluginRoute.mockClear();
    await findLinkTargetsIn(undefined)({ search: "prix" });
    expect(queryOf(asked().path)).not.toHaveProperty("locale");
  });

  it("rejects when the route fails or answers something else", async () => {
    readPluginRoute.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(findLinkTargets({ search: "x" })).rejects.toThrow("Forbidden");

    readPluginRoute.mockResolvedValueOnce({ nope: true });
    await expect(findLinkTargets({ search: "x" })).rejects.toThrow(
      "Pages could not be searched. Try again."
    );
  });
});
