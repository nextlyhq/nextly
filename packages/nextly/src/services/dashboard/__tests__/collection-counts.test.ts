/**
 * Per-collection totals must be the CALLER's totals.
 *
 * `dashboard-scope.test.ts` covers which collections are counted at all, and
 * every assertion in it is satisfied by a bare `SELECT COUNT(*)` over the
 * physical table — which is what this used to be. Entity-level scope decides
 * whether a collection appears; it says nothing about which ROWS inside it the
 * caller may read. The raw count therefore reported rows the caller's own read
 * withholds — unpublished ones among them — so Alice saw a number she could not
 * reproduce by listing.
 *
 * The fix routes the total through `nextly.count({ overrideAccess: false })`,
 * which runs the same gate and the same filtering the list read runs. So the
 * tests here drive the raw table count and the
 * access-controlled count to DIFFERENT numbers; a test where they agreed could
 * not tell the two implementations apart.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { count } = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock("../../../direct-api/nextly", () => ({
  requireNextly: () => ({ count }),
}));

const { containerGet } = vi.hoisted(() => ({ containerGet: vi.fn() }));
vi.mock("../../../di/container", () => ({ container: { get: containerGet } }));

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../shared";
import { DashboardService } from "../dashboard-service";
import {
  allResources,
  someResources,
  type ReadCaller,
} from "../readable-resources";

/** Rows physically present in `posts`, of which the caller owns two. */
const ROWS_IN_TABLE = 7;
const ROWS_THE_CALLER_MAY_READ = 2;

const COLLECTIONS = [
  {
    slug: "posts",
    tableName: "posts",
    labels: { plural: "Posts" },
    fields: [],
  },
];

const CALLER: ReadCaller = {
  user: { id: "alice", roles: ["editor"] },
};

/** Every raw `COUNT(*)` answers with the WHOLE table, access ignored. */
function makeAdapter(): DrizzleAdapter {
  return {
    getCapabilities: () => ({ dialect: "sqlite" }),
    executeQuery: vi
      .fn()
      .mockImplementation(() => Promise.resolve([{ count: ROWS_IN_TABLE }])),
  } as unknown as DrizzleAdapter;
}

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeService(): DashboardService {
  return new DashboardService(makeAdapter(), makeLogger());
}

beforeEach(() => {
  vi.clearAllMocks();
  containerGet.mockImplementation((name: string) => {
    if (name === "collectionRegistryService") {
      return { getAllCollections: vi.fn().mockResolvedValue(COLLECTIONS) };
    }
    if (name === "singleRegistryService") {
      return { getAllSingles: vi.fn().mockResolvedValue([]) };
    }
    throw new Error(`unexpected container.get("${name}")`);
  });
  // The stored read rule at work: the access-controlled count sees two rows
  // where the table holds seven.
  count.mockResolvedValue({ total: ROWS_THE_CALLER_MAY_READ });
});

describe("a collection or Single kept off the dashboard is never counted", () => {
  it("leaves a hidden collection and a hidden Single out, even for a caller who may read everything", async () => {
    // `allResources()` is a super-admin's scope, so nothing about access removes them: only the
    // dashboard rule does. The page builder's internal usage index stands for `internal: true`,
    // which is stored as `admin.hidden`.
    containerGet.mockImplementation((name: string) => {
      if (name === "collectionRegistryService") {
        return {
          getAllCollections: vi.fn().mockResolvedValue([
            ...COLLECTIONS,
            {
              slug: "nx_pb_class_usage",
              tableName: "nx_pb_class_usage",
              labels: { plural: "Class usage" },
              admin: { hidden: true },
              fields: [],
            },
          ]),
        };
      }
      if (name === "singleRegistryService") {
        return {
          getAllSingles: vi
            .fn()
            .mockResolvedValue([
              { slug: "site-settings" },
              { slug: "hidden-single", admin: { hidden: true } },
            ]),
        };
      }
      throw new Error(`unexpected container.get("${name}")`);
    });

    const adapter = makeAdapter();
    const stats = await new DashboardService(adapter, makeLogger()).getStats({
      scope: allResources(),
      caller: CALLER,
    });

    expect(stats.collectionCounts.map(row => row.slug)).toEqual(["posts"]);
    expect(stats.singles).toBe(1);
    expect(count).not.toHaveBeenCalledWith(
      expect.objectContaining({ collection: "nx_pb_class_usage" })
    );
    // Nor is its activity counted in the recent-changes figure: the activity query leaves out
    // the collection the registry read above left out. Not the Single: the trail records none.
    const activity = activityQuery(adapter);
    expect(String(activity?.[0])).toContain("NOT IN");
    expect(activity?.[1]).toContain("nx_pb_class_usage");
    expect(activity?.[1]).not.toContain("hidden-single");
  });

  it("keeps a visible collection's activity when a hidden Single shares its slug", async () => {
    containerGet.mockImplementation((name: string) => {
      if (name === "collectionRegistryService") {
        return { getAllCollections: vi.fn().mockResolvedValue(COLLECTIONS) };
      }
      if (name === "singleRegistryService") {
        return {
          getAllSingles: vi
            .fn()
            .mockResolvedValue([{ slug: "posts", admin: { hidden: true } }]),
        };
      }
      throw new Error(`unexpected container.get("${name}")`);
    });

    const adapter = makeAdapter();
    const stats = await new DashboardService(adapter, makeLogger()).getStats({
      scope: allResources(),
      caller: CALLER,
    });

    expect(stats.singles).toBe(0);
    const activity = activityQuery(adapter);
    expect(String(activity?.[0])).not.toContain("NOT IN");
    expect(activity?.[1]).not.toContain("posts");
  });
});

describe("the recent-changes figure fails closed", () => {
  it("counts nothing when the read that names the hidden collections failed", async () => {
    // The scope may still allow everything, so a count run now would include the activity of
    // collections kept off the dashboard: the read that names them is what failed.
    containerGet.mockImplementation((name: string) => {
      if (name === "collectionRegistryService") {
        return {
          getAllCollections: vi
            .fn()
            .mockRejectedValue(new Error("registry unreachable")),
        };
      }
      if (name === "singleRegistryService") {
        return { getAllSingles: vi.fn().mockResolvedValue([]) };
      }
      throw new Error(`unexpected container.get("${name}")`);
    });

    const adapter = makeAdapter();
    const stats = await new DashboardService(adapter, makeLogger()).getStats({
      scope: allResources(),
      caller: CALLER,
    });

    expect(stats.content.recentChanges24h).toBe(0);
    expect(activityQuery(adapter)).toBeUndefined();
  });
});

/** The recent-changes count's query and its bound values, as the adapter received them. */
function activityQuery(adapter: ReturnType<typeof makeAdapter>) {
  return vi
    .mocked(adapter.executeQuery)
    .mock.calls.find(([sql]) => String(sql).includes("activity_log"));
}

describe("per-collection totals honour the caller's row-level access", () => {
  it("reports the access-controlled count, not the physical row count", async () => {
    const stats = await makeService().getStats({
      scope: someResources(["posts"]),
      caller: CALLER,
    });

    expect(stats.collectionCounts).toEqual([
      { slug: "posts", label: "Posts", group: null, count: 2 },
    ]);
    // The raw table count is still 7, and a bare `COUNT(*)` would have
    // reported it. This is the separating assertion: with the two numbers
    // equal, both implementations pass.
    expect(stats.collectionCounts[0].count).not.toBe(ROWS_IN_TABLE);
  });

  it("sums totalEntries from the same access-controlled numbers", async () => {
    const stats = await makeService().getStats({
      scope: someResources(["posts"]),
      caller: CALLER,
    });

    expect(stats.content.totalEntries).toBe(ROWS_THE_CALLER_MAY_READ);
  });

  it("reads with access ENFORCED and carries the caller", async () => {
    await makeService().getStats({
      scope: someResources(["posts"]),
      caller: CALLER,
    });

    // `overrideAccess: false` plus `user` is what runs both
    // `checkCollectionAccess` and the read path's own filtering. Omitting
    // either makes the count trusted, which is what the raw query already was.
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        overrideAccess: false,
        user: CALLER.user,
      })
    );
  });

  it("counts every lifecycle state, so the dashboard total does not silently drop drafts", async () => {
    // `resolveStatusFilter` returns `published` for an untrusted read that
    // states nothing, so a count without this reports published-only totals —
    // a number that would no longer agree with the draft/published breakdown
    // sitting beside it in the same response.
    await makeService().getStats({
      scope: someResources(["posts"]),
      caller: CALLER,
    });

    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ status: "all" })
    );
  });

  it("judges an API key on its OWN stamped scope, not its minter's roles", async () => {
    await makeService().getStats({
      scope: someResources(["posts"]),
      caller: {
        user: { id: "owner-1", roles: ["viewer"] },
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["read-posts"],
        },
      },
    });

    // Dropped, the count is judged by whoever minted the key — for a
    // super-admin owner that is their entire account.
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { actorType: "apiKey", permissions: ["read-posts"] },
      })
    );
  });

  it("contributes nothing for a collection whose count is refused", async () => {
    // `countEntries` throws rather than returning zero when collection access
    // is denied outright. A refusal must cost that collection's number, never
    // the whole response.
    count.mockRejectedValue(new Error("access denied"));

    const stats = await makeService().getStats({
      scope: someResources(["posts"]),
      caller: CALLER,
    });

    expect(stats.collectionCounts).toEqual([
      { slug: "posts", label: "Posts", group: null, count: 0 },
    ]);
  });
});
