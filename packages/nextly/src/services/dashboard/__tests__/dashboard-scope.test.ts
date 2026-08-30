/**
 * Regression coverage for the read-scope defect at the level where it lived:
 * `DashboardService` itself.
 *
 * `api/dashboard.test.ts` covers the HANDLER -- that `resolveReadableResources`
 * computes the right `ReadableResources` and forwards it to the service. It
 * mocks the service out entirely, so it can never observe whether the service
 * actually APPLIES the scope it is handed. `readable-resources.test.ts` covers
 * the `filterByResource`/`someResources` helpers in isolation, never through
 * the service's own consumption of them.
 *
 * Neither of those files would go red if `getRegisteredCollections` /
 * `getRegisteredSingles` reverted to the old
 * `if (!scope || scope.resources.size === 0) return mapped;` -- exactly the
 * fail-open bug this task exists to close. These tests construct a real
 * `DashboardService` against a stubbed adapter and a stubbed DI container so
 * that bug has a test that actually exercises the vulnerable code path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// `DashboardService` reads its registries off the shared DI container
// (`container.get("collectionRegistryService")` /
// `container.get("singleRegistryService")`) rather than taking them as
// constructor arguments, so the container module itself is the seam to mock
// -- the same shape `api/dashboard.test.ts` uses for `../di`.
vi.mock("../../../di/container", () => ({
  container: { get: vi.fn() },
}));

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../../../di/container";
import type { Logger } from "../../shared";
import { DashboardService } from "../dashboard-service";
import { allResources, someResources } from "../readable-resources";

/** Three registered collections, standing in for a real registry response. */
const COLLECTIONS = [
  {
    slug: "posts",
    tableName: "posts",
    labels: { plural: "Posts" },
    fields: [],
  },
  {
    slug: "pages",
    tableName: "pages",
    labels: { plural: "Pages" },
    fields: [],
  },
  {
    slug: "orders",
    tableName: "orders",
    labels: { plural: "Orders" },
    fields: [],
  },
];

const SINGLES = [{ slug: "site-settings" }, { slug: "about" }];

/**
 * Adapter stub for the count fan-out `getStats` performs. Every COUNT(*)
 * query resolves to zero rows/zero count -- the point of these tests is
 * which COLLECTIONS get counted at all, not the counts themselves.
 */
function makeAdapter(
  dialect: "postgresql" | "mysql" | "sqlite" = "sqlite"
): DrizzleAdapter {
  return {
    getCapabilities: () => ({ dialect }),
    // `activity_log` answers with a DISTINCT count so `recentChanges24h` can be
    // told apart from the zero every other counter returns. A shared 0 would
    // make "the scope short-circuited the query" and "the query ran and found
    // nothing" the same observation -- and the first is the property under
    // test.
    executeQuery: vi
      .fn()
      .mockImplementation((sql: string) =>
        Promise.resolve([{ count: sql.includes("activity_log") ? 7 : 0 }])
      ),
  } as unknown as DrizzleAdapter;
}

/** Every `activity_log` query `getStats` emitted, with its bound params. */
function activityLogCalls(adapter: DrizzleAdapter): Array<[string, unknown[]]> {
  const calls = (adapter.executeQuery as unknown as ReturnType<typeof vi.fn>)
    .mock.calls as Array<[string, unknown[]]>;
  return calls.filter(([sql]) => sql.includes("activity_log"));
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (container.get as ReturnType<typeof vi.fn>).mockImplementation(
    (name: string) => {
      if (name === "collectionRegistryService") {
        return { getAllCollections: vi.fn().mockResolvedValue(COLLECTIONS) };
      }
      if (name === "singleRegistryService") {
        return { getAllSingles: vi.fn().mockResolvedValue(SINGLES) };
      }
      // `getStats` also fans out to `fieldGroupRegistryService` and reads
      // `activity_log`/`api_keys` via raw queries; neither is registered
      // here. Both call sites catch and fall back to zero, which is exactly
      // what these tests want -- the assertions below are all about
      // `collectionCounts` and `singles`.
      throw new Error(`unexpected container.get("${name}") in this test`);
    }
  );
});

describe("DashboardService applies the read scope it is given", () => {
  it("admits nothing for an explicit empty scope", async () => {
    const service = new DashboardService(makeAdapter(), makeLogger());

    const stats = await service.getStats({ scope: someResources([]) });

    expect(stats.collectionCounts).toEqual([]);
    expect(stats.singles).toBe(0);
  });

  it("admits nothing when the options object is omitted entirely -- deny by default", async () => {
    const service = new DashboardService(makeAdapter(), makeLogger());

    const stats = await service.getStats();

    expect(stats.collectionCounts).toEqual([]);
    expect(stats.singles).toBe(0);
  });

  it("admits only the named resource, not everything registered", async () => {
    const service = new DashboardService(makeAdapter(), makeLogger());

    const stats = await service.getStats({
      scope: someResources(["posts"]),
    });

    expect(stats.collectionCounts.map(c => c.slug)).toEqual(["posts"]);
  });

  it("admits everything for a super-admin's `all` scope", async () => {
    const service = new DashboardService(makeAdapter(), makeLogger());

    const stats = await service.getStats({ scope: allResources() });

    expect(stats.collectionCounts.map(c => c.slug).sort()).toEqual([
      "orders",
      "pages",
      "posts",
    ]);
    expect(stats.singles).toBe(2);
  });
});

/**
 * `recentChanges24h` reads `activity_log` -- the very table this branch taught
 * `ActivityLogService` to filter. Left unscoped it made ONE `/stats` response
 * answer "what may this caller see" two different ways about one table:
 * `collectionCounts` honoured the scope while `recentChanges24h` counted every
 * collection's changes, so the number itself disclosed that activity exists
 * outside the caller's reach.
 *
 * The counter is private and its result is a bare number, so a count of 7 and a
 * count of 7-of-which-some-are-forbidden are indistinguishable from the return
 * value alone. What separates them is the SQL: these assert the emitted query
 * and its bound params, the way `activity-scope.test.ts` does for
 * `countActivities`.
 *
 * The other five counters (`media`, `users`, `roles`, `permissions`, active API
 * keys) are deliberately left unscoped. They are uniformly unscoped rather than
 * newly inconsistent, and scoping them is a design decision about what a
 * dashboard admin metric means, not a defect in this table's filter.
 */
describe("recentChanges24h honours the read scope", () => {
  it("counts nothing WITHOUT querying when the caller may read nothing", async () => {
    const adapter = makeAdapter();
    const service = new DashboardService(adapter, makeLogger());

    const stats = await service.getStats({ scope: someResources([]) });

    expect(stats.content.recentChanges24h).toBe(0);
    // An empty `IN ()` is a syntax error on some dialects, so the
    // short-circuit must happen BEFORE the query is built rather than let the
    // driver reject it -- the same rule `getRecentActivity` follows.
    expect(activityLogCalls(adapter)).toEqual([]);
  });

  it.each([
    {
      dialect: "sqlite" as const,
      expectedSql:
        'SELECT COUNT(*) as count FROM "activity_log" WHERE "created_at" > ? AND "collection" IN (?, ?)',
    },
    {
      dialect: "postgresql" as const,
      expectedSql:
        'SELECT COUNT(*) as count FROM "activity_log" WHERE "created_at" > $1 AND "collection" IN ($2, $3)',
    },
    {
      dialect: "mysql" as const,
      expectedSql:
        "SELECT COUNT(*) as count FROM `activity_log` WHERE `created_at` > ? AND `collection` IN (?, ?)",
    },
  ])(
    "restricts the count to the scope's collections, on $dialect",
    async ({ dialect, expectedSql }) => {
      const adapter = makeAdapter(dialect);
      const service = new DashboardService(adapter, makeLogger());

      await service.getStats({
        scope: someResources(["posts", "email-providers"]),
      });

      const calls = activityLogCalls(adapter);
      expect(calls).toHaveLength(1);
      const [sql, params] = calls[0];
      // Full string, not a substring: `toContain("IN (")` passes a query that
      // also dropped the cutoff, and passes one whose placeholders are
      // numbered wrongly. The cutoff must stay bound at position 1 with the
      // scope's values after it, in order.
      expect(sql).toBe(expectedSql);
      expect(params.slice(1)).toEqual(["posts", "email-providers"]);
      // Parameterised, never interpolated: no collection name may appear in
      // the SQL text itself.
      expect(sql).not.toContain("posts");
    }
  );

  it("counts across every collection for a super-admin's `all` scope", async () => {
    const adapter = makeAdapter();
    const service = new DashboardService(adapter, makeLogger());

    const stats = await service.getStats({ scope: allResources() });

    const calls = activityLogCalls(adapter);
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    // The positive control for the two cases above: `all` must NOT narrow, so
    // an implementation that filtered unconditionally -- which would satisfy
    // every scoped assertion here -- fails this one.
    expect(sql).toBe(
      'SELECT COUNT(*) as count FROM "activity_log" WHERE "created_at" > ?'
    );
    expect(params).toHaveLength(1);
    expect(stats.content.recentChanges24h).toBe(7);
  });

  it("denies by default when the options object is omitted entirely", async () => {
    const adapter = makeAdapter();
    const service = new DashboardService(adapter, makeLogger());

    const stats = await service.getStats();

    expect(stats.content.recentChanges24h).toBe(0);
    expect(activityLogCalls(adapter)).toEqual([]);
  });
});
