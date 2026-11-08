/**
 * How many entries a list draws, read through its own read: what an editor
 * compares a list's rows by, read as the person editing and as a visitor,
 * for every collection list, a related one among them.
 */
import { describe, expect, it } from "vitest";

import { createStandaloneContext } from "../context";
import type { BlocksDataProvider, BlocksQuery } from "../context";

import { listShownCount } from "./list-read";

const POSTS = [
  { id: "a", title: "Alder" },
  { id: "b", title: "Birch" },
  { id: "c", title: "Cedar" },
];

/** A reader holding one page, whose `related` field names two posts. */
function provider(): BlocksDataProvider & { asked: BlocksQuery[] } {
  const asked: BlocksQuery[] = [];
  return {
    asked,
    find: async query => {
      asked.push(query);
      if (query.collection === "pages") {
        return { items: [{ id: "p1", related: ["a", "b"] }], total: 1 };
      }
      const byId = query.filters?.find(filter => filter.field === "id");
      const ids =
        byId === undefined
          ? undefined
          : Array.isArray(byId.value)
            ? (byId.value as unknown[])
            : [byId.value];
      const items =
        ids === undefined ? POSTS : POSTS.filter(post => ids.includes(post.id));
      return { items, total: items.length };
    },
  };
}

describe("how many entries a list draws", () => {
  it("counts a collection list's rows, held to its limit", async () => {
    const data = provider();
    const ctx = createStandaloneContext({ data });
    await expect(
      listShownCount({ collection: "posts", limit: 2 }, ctx, data)
    ).resolves.toBe(2);
  });

  it("counts a related list's rows, read from the page's entry first", async () => {
    const data = provider();
    const ctx = createStandaloneContext({
      data,
      entry: { id: "p1" },
      entryCollection: "pages",
    });
    await expect(
      listShownCount(
        {
          collection: "posts",
          limit: 10,
          relation: { of: "entry", field: "related" },
        },
        ctx,
        data
      )
    ).resolves.toBe(2);
    // The entry was read for its ids, as the list reads it.
    expect(data.asked[0]).toMatchObject({ collection: "pages" });
  });

  it("counts nothing for a list naming no collection", async () => {
    const data = provider();
    await expect(
      listShownCount({}, createStandaloneContext({ data }), data)
    ).resolves.toBeUndefined();
  });
});
