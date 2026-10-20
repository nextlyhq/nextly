/**
 * What the release list route adds beside each release for a page at once:
 * its member counts on the list, and a batch readiness read.
 *
 * Asserted on what the route ASKED of the namespace as well as on what it
 * answered, because the point of both is the number of reads: one for the
 * counts of a whole page, one for its readiness, never one per release.
 *
 * @module api/__tests__/releases-route-list-summary.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAnyPermission, isErrorResponse, getCachedNextly, names } =
  vi.hoisted(() => ({
    requireAnyPermission: vi.fn(),
    isErrorResponse: vi.fn(() => false),
    getCachedNextly: vi.fn(),
    names: vi.fn(),
  }));

vi.mock("../../auth/middleware", () => ({
  requireAnyPermission,
  isErrorResponse,
}));
vi.mock("../../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: (e: unknown) => e,
}));
vi.mock("../../init", () => ({ getCachedNextly }));
vi.mock("../../domains/versions/author-hydration", () => ({
  peopleById: names,
}));

const { handleReleaseRequest } = await import("../releases");

const PAGE_META = {
  total: 2,
  page: 1,
  limit: 25,
  totalPages: 1,
  hasNext: false,
  hasPrev: false,
};

function namespace() {
  return {
    releases: {
      find: vi.fn(async (_query: Record<string, unknown>) => ({
        items: [
          { id: "r1", createdBy: "u-ada" },
          { id: "r2", createdBy: "u-gone" },
          { id: "r3", createdBy: "u-ada" },
          { id: "r4", createdBy: null },
        ],
        meta: PAGE_META,
      })),
      capabilities: vi.fn(
        async ({ releases }: { releases: readonly { id: string }[] }) =>
          new Map(releases.map(release => [release.id, { schedule: true }]))
      ),
      memberCounts: vi.fn(
        async ({ releaseIds }: { releaseIds: readonly string[] }) =>
          Object.fromEntries(
            releaseIds.map((id, i) => [
              id,
              { total: i + 1, goLive: i + 1, comeDown: 0 },
            ])
          )
      ),
      readinessOf: vi.fn(
        async ({ releaseIds }: { releaseIds: readonly string[] }) =>
          releaseIds.map(releaseId => ({
            releaseId,
            checked: true,
            hard: [],
            soft: [],
          }))
      ),
    },
  };
}

let api: ReturnType<typeof namespace>;

beforeEach(() => {
  names.mockResolvedValue(
    new Map([["u-ada", { kind: "person", id: "u-ada", name: "Ada Lovelace" }]])
  );
  api = namespace();
  getCachedNextly.mockResolvedValue(api);
  requireAnyPermission.mockResolvedValue({ userId: "u1" });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function call(method: string, query: string): Promise<Response> {
  return handleReleaseRequest(
    new Request(`https://example.test/api/releases${query}`),
    method,
    {}
  );
}

describe("the release list's member counts", () => {
  it("puts each release's counts on its row, from one read for the page", async () => {
    const res = await call("listReleases", "?tab=upcoming");
    const body = (await res.json()) as {
      items: { id: string; memberCounts: unknown }[];
    };
    expect(api.releases.memberCounts).toHaveBeenCalledTimes(1);
    expect(api.releases.memberCounts).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseIds: ["r1", "r2", "r3", "r4"],
        overrideAccess: false,
      })
    );
    expect(body.items.map(item => [item.id, item.memberCounts])).toEqual([
      ["r1", { total: 1, goLive: 1, comeDown: 0 }],
      ["r2", { total: 2, goLive: 2, comeDown: 0 }],
      ["r3", { total: 3, goLive: 3, comeDown: 0 }],
      ["r4", { total: 4, goLive: 4, comeDown: 0 }],
    ]);
  });

  it("names each release's owner from one read of the page's owners", async () => {
    const res = await call("listReleases", "?tab=upcoming");
    const body = (await res.json()) as {
      items: { id: string; owner: unknown }[];
    };
    // One read for the page; the shared lookup reads each distinct id once.
    expect(names).toHaveBeenCalledTimes(1);
    const asked = (names.mock.calls[0]?.[0] ?? []) as (string | null)[];
    expect(new Set(asked.filter(Boolean))).toEqual(
      new Set(["u-ada", "u-gone"])
    );
    expect(body.items.map(item => [item.id, item.owner])).toEqual([
      ["r1", { id: "u-ada", name: "Ada Lovelace" }],
      // Gone (deleted or erased): kept as unnamed, as version history does.
      ["r2", null],
      ["r3", { id: "u-ada", name: "Ada Lovelace" }],
      ["r4", null],
    ]);
  });

  it("does not count for a document's own releases, which the list does not show", async () => {
    await call(
      "listReleases",
      "?containingScopeKind=collection&containingScopeSlug=posts&containingEntryId=e1"
    );
    expect(api.releases.memberCounts).not.toHaveBeenCalled();
  });
});

describe("the batch readiness read", () => {
  it("demands only read, and asks for every id named in one call", async () => {
    const res = await call("listReleasesReadiness", "?ids=r1,r2&ids=r3");
    expect(requireAnyPermission.mock.calls[0]?.[1]).toEqual([
      { action: "read", resource: "content-releases" },
    ]);
    expect(api.releases.readinessOf).toHaveBeenCalledTimes(1);
    expect(api.releases.readinessOf).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseIds: ["r1", "r2", "r3"],
        overrideAccess: false,
      })
    );
    const body = (await res.json()) as {
      items: { releaseId: string }[];
      meta: { total: number };
    };
    expect(body.items.map(item => item.releaseId)).toEqual(["r1", "r2", "r3"]);
    expect(body.meta.total).toBe(3);
  });

  it("refuses a read that names no release", async () => {
    const res = await call("listReleasesReadiness", "");
    expect(res.status).toBe(400);
    expect(api.releases.readinessOf).not.toHaveBeenCalled();
  });
});
