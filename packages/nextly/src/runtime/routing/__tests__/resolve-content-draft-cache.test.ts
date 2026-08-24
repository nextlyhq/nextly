/**
 * A draft read is never cached.
 *
 * Asserted as the MECHANISM — whether `cachedFind` is reached at all — rather
 * than by reading twice and hoping to observe staleness. Outside a Next runtime
 * `cachedFind` calls straight through, so a round-trip test would pass whether
 * or not the rule existed.
 *
 * The rule matters because cache tags are busted by writes to the LIVE row
 * while a working draft changes on every save: a cached draft would show an
 * editor their previous save and call it a preview.
 */
import { describe, expect, it, vi } from "vitest";

import type { ListResult } from "../../../direct-api/types/shared";
import { resolveContent, type NextlyContentReader } from "../resolve-content";
import { TRUSTS_EVERY_COLLECTION } from "../../../services/collections/trust-grant";

const { cachedFindSpy } = vi.hoisted(() => ({ cachedFindSpy: vi.fn() }));

vi.mock("../../cache/cached-find", () => ({
  cachedFind: (read: () => Promise<unknown>, options: unknown) => {
    cachedFindSpy(options);
    return read();
  },
}));

function reader(): NextlyContentReader {
  const row = { id: "1", title: "A", status: "published" };
  return {
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
    findByID: async (): Promise<Record<string, unknown> | null> => ({
      ...row,
      _isWorkingDraft: true,
    }),
  };
}

describe("caching a draft read", () => {
  it("caches a trusted published read", async () => {
    // The baseline the next case is measured against. Without it, "not cached"
    // could mean the rule works or that nothing here is ever cached.
    cachedFindSpy.mockClear();

    await resolveContent("posts", "a", {
      nextly: reader(),
      overrideAccess: true,
      trustedCollections: TRUSTS_EVERY_COLLECTION,
    });

    expect(cachedFindSpy).toHaveBeenCalledOnce();
  });

  it("never caches a draft read, even when it is trusted and userless", async () => {
    cachedFindSpy.mockClear();

    const result = await resolveContent("posts", "a", {
      nextly: reader(),
      overrideAccess: true,
      trustedCollections: TRUSTS_EVERY_COLLECTION,
      draft: true,
    });

    expect(cachedFindSpy).not.toHaveBeenCalled();
    // And the read still happened — "not cached" must not mean "not read".
    expect(result).toEqual({
      id: "1",
      title: "A",
      status: "published",
      _isWorkingDraft: true,
    });
  });
});
