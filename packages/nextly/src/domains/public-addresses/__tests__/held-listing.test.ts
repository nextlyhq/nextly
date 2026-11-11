import { describe, expect, it, vi } from "vitest";

import { PAGINATION_DEFAULTS, clampLimit } from "../../../types/pagination";

/** 600 posts, read through a `find` that clamps its limit as the query does. */
const posts = Array.from({ length: 600 }, (_, i) => ({
  id: String(i + 1).padStart(4, "0"),
  title: `Post ${i + 1}`,
}));

vi.mock("../../../init", () => ({
  getCachedNextly: () =>
    Promise.resolve({
      find: (args: { offset?: number; limit?: number }) => {
        const limit = clampLimit(args.limit ?? 10);
        const offset = args.offset ?? 0;
        return Promise.resolve({ items: posts.slice(offset, offset + limit) });
      },
    }),
}));
vi.mock("../../../di/service-access", () => ({
  whenServicesRegistered: () => Promise.resolve(),
}));
vi.mock("../held-addresses", () => ({
  addressLanguages: () => [],
  heldIn: () => Promise.resolve([]),
  readEveryLanguage: () => Promise.resolve(new Map()),
}));
vi.mock("../../../di", () => ({
  container: {
    get: () => ({
      transaction: (work: (tx: unknown) => Promise<unknown>) => work({}),
    }),
  },
}));

import { heldPage } from "../held-listing";

describe("a page of held addresses", () => {
  it("says another page follows when the largest page is asked for", async () => {
    const page = await heldPage({
      type: { kind: "collection", slug: "posts" },
      limit: PAGINATION_DEFAULTS.maxLimit,
    });

    expect(page.next).toBeDefined();
    const rest = await heldPage({
      type: { kind: "collection", slug: "posts" },
      limit: PAGINATION_DEFAULTS.maxLimit,
      after: page.next,
    });
    expect(page.items.length + rest.items.length).toBe(posts.length);
  });
});
