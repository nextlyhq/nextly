/**
 * The schema a list's items bind against, which the render, the save and the
 * report of bindings to fix all read an item binding by.
 */
import { describe, expect, it } from "vitest";

import { listItemRef } from "./list-query";

describe("listItemRef", () => {
  it("binds a collection's entries as that collection's, before any query", () => {
    expect(listItemRef({ collection: "posts", query: "deals" })).toEqual({
      collection: "posts",
    });
  });

  it("binds a named query's own rows as the query's", () => {
    expect(listItemRef({ query: "deals" })).toEqual({ query: "deals" });
    expect(listItemRef({ collection: "", query: "deals" })).toEqual({
      query: "deals",
    });
  });

  it("knows no item schema without either", () => {
    expect(listItemRef({})).toBeUndefined();
  });
});
