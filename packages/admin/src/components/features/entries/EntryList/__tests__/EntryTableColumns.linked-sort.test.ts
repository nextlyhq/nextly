/**
 * The sort a link carries into the entry list, as `?sort=…`.
 *
 * Honoured only for a column the list's own sort menu can order by, so a link can never sort
 * the list by something the person could not sort it by here; anything else is ignored, and the
 * list opens newest first rather than failing.
 */
import { describe, expect, it } from "vitest";

import {
  choiceInForce,
  linkedSortFor,
  linkedStatusFor,
  type CollectionForColumns,
} from "../EntryTableColumns";

const posts: CollectionForColumns = {
  slug: "posts",
  fields: [
    { type: "text", name: "title", label: "Title" } as never,
    { type: "json", name: "settings", label: "Settings" } as never,
  ],
};

describe("a sort carried by the list's address", () => {
  it("is honoured for a column the sort menu orders by, either way round", () => {
    expect(linkedSortFor("-updatedAt", posts)).toBe("-updatedAt");
    expect(linkedSortFor("title", posts)).toBe("title");
  });

  it("is ignored for a field the menu cannot sort by, or one that is not there", () => {
    // 🔴 The separating pair: a reader that passed any field through fails the first; one that
    // refused everything fails the case above.
    expect(linkedSortFor("-settings", posts)).toBeUndefined();
    expect(linkedSortFor("missing", posts)).toBeUndefined();
  });

  it("is ignored until the collection is known, or when there is none", () => {
    expect(linkedSortFor("title", undefined)).toBeUndefined();
    expect(linkedSortFor(null, posts)).toBeUndefined();
    expect(linkedSortFor("", posts)).toBeUndefined();
  });
});

describe("the sort the list asks with", () => {
  const chosen = { collectionSlug: "posts", value: "title" };

  it("is the reader's choice on the collection it was made on, over the address's", () => {
    expect(choiceInForce(chosen, "posts", "-updatedAt", "-createdAt")).toBe(
      "title"
    );
  });

  it("drops a choice made on another collection, for the new address's sort", () => {
    // 🔴 The same list component renders the next collection: a field of the first is not one
    // of the second, and must not override the sort the new address carried.
    expect(choiceInForce(chosen, "pages", "-updatedAt", "-createdAt")).toBe(
      "-updatedAt"
    );
    expect(choiceInForce(chosen, "pages", undefined, "-createdAt")).toBe(
      "-createdAt"
    );
  });
});

describe("a lifecycle carried by the list's address", () => {
  const withLifecycle: CollectionForColumns = { ...posts, status: true };

  it("is honoured for a collection with the Draft / Published lifecycle", () => {
    expect(linkedStatusFor("draft", withLifecycle)).toBe("draft");
    expect(linkedStatusFor("published", withLifecycle)).toBe("published");
  });

  it("is ignored for a collection without one, and for anything but draft or published", () => {
    expect(linkedStatusFor("published", posts)).toBeUndefined();
    expect(linkedStatusFor("archived", withLifecycle)).toBeUndefined();
    expect(linkedStatusFor(null, withLifecycle)).toBeUndefined();
  });
});
