/**
 * The path the admin client asks the entries route for, built from the one
 * spelling of each parameter both ends share.
 *
 * @module entries-contract.test
 */
import { describe, expect, it } from "vitest";

import { ENTRIES_ROUTE_PATH, entriesPath } from "./entries-contract";

/** The query parameters a built path carries, as the route will read them. */
function paramsOf(path: string): Record<string, string> {
  const [route, query = ""] = path.split("?");
  expect(route).toBe(ENTRIES_ROUTE_PATH);
  return Object.fromEntries(new URLSearchParams(query));
}

describe("the entries path", () => {
  it("carries every part of the query the caller stated", () => {
    expect(
      paramsOf(
        entriesPath({
          collection: "posts",
          search: "hello world",
          ids: ["a", "b"],
          limit: 5,
        })
      )
    ).toEqual({
      collection: "posts",
      search: "hello world",
      ids: "a,b",
      limit: "5",
    });
  });

  it("leaves out what was not asked, rather than sending it empty", () => {
    expect(
      paramsOf(entriesPath({ collection: "posts", search: "", ids: [] }))
    ).toEqual({ collection: "posts" });
  });

  it("encodes values, so a search cannot add a parameter of its own", () => {
    expect(
      paramsOf(
        entriesPath({ collection: "posts", search: "a&collection=users" })
      )
    ).toEqual({ collection: "posts", search: "a&collection=users" });
  });
});
