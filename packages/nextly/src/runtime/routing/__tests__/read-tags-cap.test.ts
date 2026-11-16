/**
 * Both cached routes hand the cache at most the 128 tags Next.js keeps, with
 * the collection's or Single's own tag first. A caller listing every related
 * collection a populated read depends on can name more than that, and Next.js
 * drops the last ones, so a route that put the caller's tags first would lose
 * the tag every write to its own content expires.
 */
import { describe, expect, it, vi } from "vitest";

import type { ListResult } from "../../../direct-api/types/shared";
import { TRUSTS_EVERY_COLLECTION } from "../../../services/collections/trust-grant";
import { MAX_TAGS_PER_READ } from "../../cache/nextly-tags";

const { cachedFind } = vi.hoisted(() => ({
  cachedFind: vi.fn(
    async (read: () => Promise<unknown>, _options: { tags?: string[] }) =>
      read()
  ),
}));

vi.mock("../../cache/cached-find", () => ({ cachedFind }));

const { resolveContent } = await import("../resolve-content");
const { createPublicSingleRoute } = await import("../single-route");

const related = Array.from({ length: 200 }, (_, i) => `nextly:related-${i}`);

/** The tags the one cached read was handed. */
function handedTags(): string[] {
  expect(cachedFind, "the cache was never consulted").toHaveBeenCalledOnce();
  return cachedFind.mock.calls[0]?.[1].tags ?? [];
}

describe("the tags a cached route read carries", () => {
  it("caps a collection read, its collection's tag first", async () => {
    cachedFind.mockClear();
    const row = { id: "1", title: "A", status: "published" };
    await resolveContent("posts", "a", {
      nextly: {
        find: async (): Promise<ListResult<Record<string, unknown>>> => ({
          items: [row],
          meta: {
            total: 1,
            page: 1,
            limit: 1,
            totalPages: 1,
            hasNext: false,
            hasPrev: false,
          },
        }),
        findByID: async () => row,
      },
      overrideAccess: true,
      trustedCollections: TRUSTS_EVERY_COLLECTION,
      tags: related,
    });

    const tags = handedTags();
    expect(tags).toHaveLength(MAX_TAGS_PER_READ);
    expect(tags[0]).toBe("nextly:posts");
  });

  it("caps a Single read, its Single's tag first", async () => {
    cachedFind.mockClear();
    const { generateMetadata } = createPublicSingleRoute({
      slug: "homepage",
      nextly: { findSingle: async () => ({ title: "Home" }) },
      render: () => "rendered",
      buildMetadata: () => ({ title: "Home" }),
      tags: related,
    } as unknown as Parameters<typeof createPublicSingleRoute>[0]);
    await generateMetadata();

    const tags = handedTags();
    expect(tags).toHaveLength(MAX_TAGS_PER_READ);
    expect(tags[0]).toBe("nextly:single:homepage");
  });
});
