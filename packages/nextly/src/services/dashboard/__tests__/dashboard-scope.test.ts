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

// The per-collection totals are read through the access-controlled Direct API
// count. These tests are about WHICH collections get counted, so the number
// itself is pinned at zero; `collection-counts.test.ts` is where the number
// being the caller's rather than the table's is asserted.
const { count } = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock("../../../direct-api/nextly", () => ({
  requireNextly: () => ({ count }),
}));

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../../../di/container";
import type { Logger } from "../../shared";
import { DashboardService } from "../dashboard-service";
import {
  allResources,
  someResources,
  type ReadCaller,
} from "../readable-resources";

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

/** Who the counts are read as. Required by `getStats`, so it is stated once. */
const CALLER: ReadCaller = { user: { id: "user-1", roles: ["editor"] } };

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
    executeQuery: vi.fn().mockResolvedValue([{ count: 0 }]),
  } as unknown as DrizzleAdapter;
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/**
 * The activity figure is counted by the activity-log service's own walk, so what this service
 * decides is what it ASKS: the scope, the caller and the day. A distinct 7 tells the figure apart
 * from the zero every other counter returns.
 */
const countRecentActivity = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  count.mockResolvedValue({ total: 0 });
  countRecentActivity.mockResolvedValue({ count: 7, atLeast: false });
  (container.get as ReturnType<typeof vi.fn>).mockImplementation(
    (name: string) => {
      if (name === "activityLogService") return { countRecentActivity };
      if (name === "collectionRegistryService") {
        return { getAllCollections: vi.fn().mockResolvedValue(COLLECTIONS) };
      }
      if (name === "singleRegistryService") {
        return { getAllSingles: vi.fn().mockResolvedValue(SINGLES) };
      }
      // `getStats` also fans out to `fieldGroupRegistryService` and reads
      // `api_keys` via a raw query; neither is registered here. Both call
      // sites catch and fall back to zero, which is exactly what these tests
      // want -- the assertions below are about `collectionCounts`, `singles`
      // and the question the activity figure asks.
      throw new Error(`unexpected container.get("${name}") in this test`);
    }
  );
});

describe("DashboardService applies the read scope it is given", () => {
  it("admits nothing for an explicit empty scope", async () => {
    const service = new DashboardService(makeAdapter(), makeLogger());

    const stats = await service.getStats({
      scope: someResources([]),
      caller: CALLER,
    });

    expect(stats.collectionCounts).toEqual([]);
    expect(stats.singles).toBe(0);
  });

  it("admits nothing when the scope is omitted -- deny by default", async () => {
    // `caller` is REQUIRED and `scope` is not, so this is the only shape a
    // caller can still get wrong. It must deny; the old default returned
    // everything.
    const service = new DashboardService(makeAdapter(), makeLogger());

    const stats = await service.getStats({ caller: CALLER });

    expect(stats.collectionCounts).toEqual([]);
    expect(stats.singles).toBe(0);
  });

  it("admits only the named resource, not everything registered", async () => {
    const service = new DashboardService(makeAdapter(), makeLogger());

    const stats = await service.getStats({
      scope: someResources(["posts"]),
      caller: CALLER,
    });

    expect(stats.collectionCounts.map(c => c.slug)).toEqual(["posts"]);
  });

  it("admits everything for a super-admin's `all` scope", async () => {
    const service = new DashboardService(makeAdapter(), makeLogger());

    const stats = await service.getStats({
      scope: allResources(),
      caller: CALLER,
    });

    expect(stats.collectionCounts.map(c => c.slug).sort()).toEqual([
      "orders",
      "pages",
      "posts",
    ]);
    expect(stats.singles).toBe(2);
  });
});

/**
 * `recentChanges24h` reads `activity_log`, and left unscoped it made ONE `/stats` response
 * answer "what may this caller see" two different ways about one table: `collectionCounts`
 * honoured the scope while the figure counted every collection's changes, so the number itself
 * disclosed that activity exists outside the caller's reach.
 *
 * The figure is now counted by the activity feed's own walk, which applies the scope and then
 * each row's document check (`activity-scope.test.ts` asserts the query it builds). What this
 * service decides is what it hands that walk, so these assert the question asked.
 *
 * The other five counters (`media`, `users`, `roles`, `permissions`, active API keys) are
 * deliberately left unscoped. They are uniformly unscoped rather than newly inconsistent, and
 * scoping them is a design decision about what a dashboard admin metric means, not a defect in
 * this table's filter.
 */
describe("recentChanges24h honours the read scope", () => {
  /** The one question the figure asked. */
  const asked = () => {
    expect(countRecentActivity).toHaveBeenCalledTimes(1);
    return countRecentActivity.mock.calls[0]?.[0] as {
      since: Date;
      scope: unknown;
      caller: unknown;
    };
  };

  it("asks with the scope's collections, as the caller, for the last day", async () => {
    const service = new DashboardService(makeAdapter(), makeLogger());
    const before = Date.now();

    const stats = await service.getStats({
      scope: someResources(["posts", "email-providers"]),
      caller: CALLER,
    });

    const question = asked();
    expect(question.scope).toEqual(someResources(["posts", "email-providers"]));
    expect(question.caller).toBe(CALLER);
    // A day back from when it was asked, not from some fixed instant.
    const day = 24 * 60 * 60 * 1000;
    expect(question.since.getTime()).toBeGreaterThanOrEqual(before - day);
    expect(question.since.getTime()).toBeLessThanOrEqual(Date.now() - day);
    expect(stats.content.recentChanges24h).toBe(7);
  });

  it("asks across every collection for a super-admin's `all` scope", async () => {
    // The positive control for the case above: `all` must reach the walk as `all`, so an
    // implementation that narrowed unconditionally fails here.
    const service = new DashboardService(makeAdapter(), makeLogger());

    await service.getStats({ scope: allResources(), caller: CALLER });

    expect(asked().scope).toEqual(allResources());
  });

  it("asks with nothing in scope when the scope is omitted: deny by default", async () => {
    const service = new DashboardService(makeAdapter(), makeLogger());

    await service.getStats({ caller: CALLER });

    expect(asked().scope).toEqual(someResources([]));
  });

  it("says the figure is a floor when the walk stopped at its bound", async () => {
    countRecentActivity.mockResolvedValue({ count: 1000, atLeast: true });
    const service = new DashboardService(makeAdapter(), makeLogger());

    const stats = await service.getStats({
      scope: allResources(),
      caller: CALLER,
    });

    expect(stats.content).toMatchObject({
      recentChanges24h: 1000,
      recentChanges24hAtLeast: true,
    });
  });

  it("leaves the floor out when the figure is whole", async () => {
    const service = new DashboardService(makeAdapter(), makeLogger());

    const stats = await service.getStats({
      scope: allResources(),
      caller: CALLER,
    });

    expect("recentChanges24hAtLeast" in stats.content).toBe(false);
  });

  it("answers 0 when the count fails, as it always has", async () => {
    countRecentActivity.mockRejectedValue(new Error("connection lost"));
    const service = new DashboardService(makeAdapter(), makeLogger());

    const stats = await service.getStats({
      scope: allResources(),
      caller: CALLER,
    });

    expect(stats.content.recentChanges24h).toBe(0);
  });
});

describe("a scope naming a non-content activity namespace", () => {
  it("reaches the activity figure's question", async () => {
    const service = new DashboardService(makeAdapter(), makeLogger());

    await service.getStats({
      scope: someResources(["posts", "email-providers"]),
      caller: CALLER,
    });

    expect(countRecentActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: someResources(["posts", "email-providers"]),
      })
    );
  });

  it("does not become a collection to count", async () => {
    const service = new DashboardService(makeAdapter(), makeLogger());

    const stats = await service.getStats({
      scope: someResources(["posts", "email-providers"]),
      caller: CALLER,
    });

    expect(stats.collectionCounts.map(c => c.slug)).toEqual(["posts"]);
    expect(count).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "posts" })
    );
  });
});
