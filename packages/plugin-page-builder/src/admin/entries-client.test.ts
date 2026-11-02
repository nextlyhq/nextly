// @vitest-environment jsdom
/**
 * What the relation control gets back from `findEntries`, and what it asked.
 *
 * The two properties that fail quietly are the ADDRESS and the FAILURE: a
 * request to a path nothing serves, or a failure reported as an empty list,
 * both look to an author like a collection with no entries.
 *
 * @module admin/entries-client.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENTRIES_LIMIT_MAX } from "../entries-contract";
import { findEntries } from "./entries-client";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A route answer with this status and body. */
function answering(status: number, body: unknown): void {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  );
}

/** The URL and init of the one request made. */
function requested(): { url: URL; init: RequestInit | undefined } {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [input, init] = fetchMock.mock.calls[0] ?? [];
  return { url: new URL(String(input), "http://admin.test"), init };
}

describe("findEntries", () => {
  it("asks the page builder's entries route, under the admin API, with the query", async () => {
    answering(200, { items: [], meta: {} });

    await findEntries({
      collection: "posts",
      search: "hello",
      ids: ["a", "b"],
      limit: 5,
    });

    const { url, init } = requested();
    expect(url.pathname).toBe(
      "/admin/api/plugins/@nextlyhq/plugin-page-builder/entries"
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      collection: "posts",
      search: "hello",
      ids: "a,b",
      limit: "5",
    });
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
  });

  it("caps the limit it asks for at the route's ceiling", async () => {
    answering(200, { items: [], meta: {} });

    await findEntries({ collection: "posts", limit: 500 });

    expect(requested().url.searchParams.get("limit")).toBe(
      String(ENTRIES_LIMIT_MAX)
    );
  });

  it("passes the abort signal through, so a newer question cancels this one", async () => {
    answering(200, { items: [], meta: {} });
    const controller = new AbortController();

    await findEntries({ collection: "posts", signal: controller.signal });

    expect(requested().init?.signal).toBe(controller.signal);
  });

  it("resolves with the { id, title } items the route answered, and nothing else of them", async () => {
    answering(200, {
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
    answering(403, {
      error: {
        code: "FORBIDDEN",
        message: "You don't have permission to perform this action.",
      },
    });

    await expect(findEntries({ collection: "users" })).rejects.toThrow(
      "You don't have permission to perform this action."
    );
  });

  it("rejects with a sentence for an author when the failure carried no message", async () => {
    fetchMock.mockResolvedValue(new Response("upstream", { status: 502 }));

    await expect(findEntries({ collection: "posts" })).rejects.toThrow(
      "Entries could not be loaded. Try again."
    );
  });

  it("rejects a success that is not a list envelope, rather than reading it as no entries", async () => {
    answering(200, { status: "ok" });

    await expect(findEntries({ collection: "posts" })).rejects.toThrow(
      "Entries could not be loaded. Try again."
    );
  });
});
