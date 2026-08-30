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
function makeAdapter(): DrizzleAdapter {
  return {
    getCapabilities: () => ({ dialect: "sqlite" }),
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
