// @vitest-environment jsdom
/**
 * What the relation control gets back from `findEntries`, and what it asked.
 *
 * The two properties that fail quietly are the ADDRESS and the FAILURE: a
 * request to a path nothing serves, or a failure reported as an empty list,
 * both look to an author like a collection with no entries. The read goes
 * through the SDK's `readPluginRoute`, which renews an expired session the
 * way every admin read does; it is stood in for here.
 *
 * @module admin/entries-client.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readPluginRoute = vi.hoisted(() => vi.fn());
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({ readPluginRoute }));

import { ENTRIES_LIMIT_MAX } from "../entries-contract";
import { findEntries } from "./entries-client";

beforeEach(() => {
  readPluginRoute.mockReset();
});

/** What the one read asked for. */
function asked(): {
  plugin: string;
  path: string;
  signal?: AbortSignal;
} {
  expect(readPluginRoute).toHaveBeenCalledTimes(1);
  return readPluginRoute.mock.calls[0]?.[0];
}

/** The path's query, as a record. */
function queryOf(path: string): Record<string, string> {
  return Object.fromEntries(new URL(path, "http://admin.test").searchParams);
}

describe("findEntries", () => {
  it("asks the page builder's own entries route, with the query", async () => {
    readPluginRoute.mockResolvedValue({ items: [], meta: {} });

    await findEntries({
      collection: "posts",
      search: "hello",
      ids: ["a", "b"],
      limit: 5,
    });

    const { plugin, path } = asked();
    expect(plugin).toBe("@nextlyhq/plugin-page-builder");
    expect(new URL(path, "http://admin.test").pathname).toBe("/entries");
    expect(queryOf(path)).toEqual({
      collection: "posts",
      search: "hello",
      ids: "a,b",
      limit: "5",
    });
  });

  it("caps the limit it asks for at the route's ceiling", async () => {
    readPluginRoute.mockResolvedValue({ items: [], meta: {} });

    await findEntries({ collection: "posts", limit: 500 });

    expect(queryOf(asked().path).limit).toBe(String(ENTRIES_LIMIT_MAX));
  });

  it("passes the abort signal through, so a newer question cancels this one", async () => {
    readPluginRoute.mockResolvedValue({ items: [], meta: {} });
    const controller = new AbortController();

    await findEntries({ collection: "posts", signal: controller.signal });

    expect(asked().signal).toBe(controller.signal);
  });

  it("resolves with the { id, title } items the route answered, and nothing else of them", async () => {
    readPluginRoute.mockResolvedValue({
      items: [
        { id: "a", title: "First", extra: "dropped" },
        { id: 7, title: "not a string id" },
        { id: "b", title: "Second" },
      ],
      meta: { total: 3 },
    });

    expect(await findEntries({ collection: "posts" })).toEqual([
      { id: "a", title: "First" },
      { id: "b", title: "Second" },
    ]);
  });

  it("REJECTS a refusal with the route's own message, rather than resolving an empty list", async () => {
    readPluginRoute.mockRejectedValue(
      new Error("You don't have permission to perform this action.")
    );

    await expect(findEntries({ collection: "users" })).rejects.toThrow(
      "You don't have permission to perform this action."
    );
  });

  it("rejects an answer that is not a list envelope, rather than reading it as no entries", async () => {
    for (const body of [{ status: "ok" }, undefined]) {
      readPluginRoute.mockResolvedValue(body);
      await expect(findEntries({ collection: "posts" })).rejects.toThrow(
        "Entries could not be loaded. Try again."
      );
    }
  });

  it("asks in the language being edited, when there is one", async () => {
    readPluginRoute.mockResolvedValue({ items: [], meta: {} });

    await findEntries({ collection: "posts", locale: "de" });

    expect(queryOf(asked().path).locale).toBe("de");
  });
});
