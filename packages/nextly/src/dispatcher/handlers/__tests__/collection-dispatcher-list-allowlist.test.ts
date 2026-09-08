/**
 * The permission filter for `listCollections` is a QUERY CONDITION, not a pass
 * over the rows that came back.
 *
 * Filtering the returned page instead makes the rows and the meta describe
 * different sets: `total` becomes the count of one filtered page, `totalPages`
 * collapses to 1, and a client reading "there is no next page" stops with the
 * rest of what it may see unreachable.
 *
 * @module dispatcher/handlers/__tests__/collection-dispatcher-list-allowlist
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ServiceContainer } from "../../../services";
import { readableSlugAllowlist } from "../../../services/lib/readable-slug-allowlist";
import { dispatchCollections } from "../collection-dispatcher";

// Mocked at the SHARED resolver, which is the seam the handler calls. Mocking
// the helpers underneath it would keep passing after the handler stopped
// asking them, which is the drift the extraction removed.
vi.mock("../../../services/lib/readable-slug-allowlist", () => ({
  readableSlugAllowlist: vi.fn(),
}));

const allowlistFor = vi.mocked(readableSlugAllowlist);

function containerReturning(listCollections: ReturnType<typeof vi.fn>) {
  return { collections: { listCollections } } as unknown as ServiceContainer;
}

/** The legacy envelope the metadata service answers with. */
function serviceResult(slugs: string[], total = slugs.length) {
  return {
    success: true,
    statusCode: 200,
    message: "Collections fetched successfully",
    data: slugs.map(slug => ({ slug, name: slug })),
    meta: { total, page: 1, limit: 10, totalPages: Math.ceil(total / 10) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listCollections resolves its allowlist before querying", () => {
  it("passes the reader's readable slugs INTO the query", async () => {
    // 🔴 The allowlist has to reach the service, because only there can it
    // reach the WHERE clause that both the count and the page read. Handed the
    // rows afterwards, no amount of filtering can repair a total that was
    // computed over a different set.
    allowlistFor.mockResolvedValue(["pages", "posts"]);
    const listCollections = vi.fn().mockResolvedValue(serviceResult(["posts"]));

    await dispatchCollections(
      containerReturning(listCollections),
      "listCollections",
      { page: "1", limit: "10", _authenticatedUserId: "u1" },
      undefined
    );

    const passed = listCollections.mock.calls[0][0];
    expect([...passed.slugAllowlist].sort()).toEqual(["pages", "posts"]);
    // Asked about THIS caller, so a handler passing a constant fails here
    // rather than merely passing something list-shaped.
    expect(allowlistFor).toHaveBeenCalledWith("u1");
  });

  it("passes NO allowlist for a super admin", async () => {
    // The control in the permissive direction: a super admin sees everything,
    // and `undefined` is how the registry is told not to filter. An empty
    // array here would hide every collection from them.
    allowlistFor.mockResolvedValue(undefined);
    const listCollections = vi.fn().mockResolvedValue(serviceResult(["posts"]));

    await dispatchCollections(
      containerReturning(listCollections),
      "listCollections",
      { page: "1", limit: "10", _authenticatedUserId: "admin" },
      undefined
    );

    expect(listCollections.mock.calls[0][0].slugAllowlist).toBeUndefined();
  });

  it("passes an EMPTY allowlist for a reader granted nothing", async () => {
    // 🔴 Distinct from the super-admin case above, and the distinction is the
    // whole gate: `undefined` means "no filter", `[]` means "nothing is
    // visible". Collapsing them shows every collection to a reader with no
    // grants at all.
    allowlistFor.mockResolvedValue([]);
    const listCollections = vi.fn().mockResolvedValue(serviceResult([], 0));

    await dispatchCollections(
      containerReturning(listCollections),
      "listCollections",
      { page: "1", limit: "10", _authenticatedUserId: "u2" },
      undefined
    );

    expect(listCollections.mock.calls[0][0].slugAllowlist).toEqual([]);
  });

  it("SHIPS the meta the service returned, rather than recomputing it", async () => {
    // 🔴 The defect this replaces. The handler used to rebuild `total` and
    // `totalPages` from the filtered page, so a reader with rows on later
    // pages was told there was one page of them. The service counted with the
    // allowlist applied, so its meta is the answer.
    allowlistFor.mockResolvedValue(["pages", "posts"]);
    const listCollections = vi.fn().mockResolvedValue({
      success: true,
      statusCode: 200,
      message: "ok",
      data: [{ slug: "posts", name: "posts" }],
      meta: { total: 42, page: 1, limit: 1, totalPages: 42 },
    });

    const result = (await dispatchCollections(
      containerReturning(listCollections),
      "listCollections",
      { page: "1", limit: "1", _authenticatedUserId: "u1" },
      undefined
    )) as Response;

    const body = (await result.json()) as {
      meta: { total: number; totalPages: number; hasNext: boolean };
    };
    expect(body.meta.total).toBe(42);
    expect(body.meta.totalPages).toBe(42);
    // The consequence a client acts on: there IS a next page, and the old
    // rebuild reported false here for every reader who was not a super admin.
    expect(body.meta.hasNext).toBe(true);
  });
});
