/**
 * The summary's admin counts are LEFT OUT for a caller who may not read them,
 * and are not counted at all.
 *
 * Leaving the field out rather than sending zero is what makes the answer the
 * same whether or not rows exist. Not running the query is the precondition
 * rule: the decision is taken first, so a refused count does no work and has
 * nothing to leak through a failure or a timing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../di/container", () => ({
  container: { get: vi.fn() },
}));

const { count } = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock("../../../direct-api/nextly", () => ({
  requireNextly: () => ({ count }),
}));

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../../../di/container";
import type { Logger } from "../../shared";
import {
  ADMIN_COUNTS,
  type AdminCount,
  type ApiKeyCountScope,
} from "../admin-counts";
import { DashboardService } from "../dashboard-service";
import { someResources, type ReadCaller } from "../readable-resources";

const CALLER: ReadCaller = { user: { id: "user-1", roles: [] } };

/** A distinct number per table, so each field is known to be its own count. */
const ROWS: Record<string, number> = {
  users: 3,
  roles: 4,
  permissions: 5,
  media: 6,
  api_keys: 7,
};
const FIELD_GROUPS = 8;

function makeAdapter(): DrizzleAdapter {
  return {
    getCapabilities: () => ({ dialect: "sqlite" }),
    executeQuery: vi.fn().mockImplementation((sql: string) => {
      const table = /FROM "([a-z_]+)"/.exec(sql)?.[1] ?? "";
      return Promise.resolve([{ count: ROWS[table] ?? 0 }]);
    }),
  } as unknown as DrizzleAdapter;
}

/** The tables `getStats` counted, read off the queries it ran. */
function countedTables(adapter: DrizzleAdapter): string[] {
  const calls = (adapter.executeQuery as unknown as ReturnType<typeof vi.fn>)
    .mock.calls as Array<[string]>;
  return calls
    .map(([sql]) => /FROM "([a-z_]+)"/.exec(sql)?.[1] ?? "")
    .filter(table => table in ROWS)
    .sort();
}

const fieldGroupList = vi.fn();

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function statsFor(
  counts: Iterable<AdminCount> | undefined,
  /** Whose keys to count; `null` leaves it unsaid. */
  apiKeysOf: ApiKeyCountScope | null = { kind: "all" }
) {
  const adapter = makeAdapter();
  const stats = await new DashboardService(adapter, makeLogger()).getStats({
    scope: someResources([]),
    caller: CALLER,
    ...(counts === undefined ? {} : { counts: new Set(counts) }),
    ...(apiKeysOf === null ? {} : { apiKeysOf }),
  });
  return { stats, adapter };
}

/** The `api_keys` queries `getStats` ran, with their bound params. */
function apiKeyQueries(adapter: DrizzleAdapter): Array<[string, unknown[]]> {
  const calls = (adapter.executeQuery as unknown as ReturnType<typeof vi.fn>)
    .mock.calls as Array<[string, unknown[]]>;
  return calls.filter(([sql]) => sql.includes('"api_keys"'));
}

beforeEach(() => {
  vi.clearAllMocks();
  count.mockResolvedValue({ total: 0 });
  fieldGroupList.mockResolvedValue({ total: FIELD_GROUPS });
  (container.get as ReturnType<typeof vi.fn>).mockImplementation(
    (name: string) => {
      if (name === "collectionRegistryService") {
        return { getAllCollections: vi.fn().mockResolvedValue([]) };
      }
      if (name === "singleRegistryService") {
        return { getAllSingles: vi.fn().mockResolvedValue([]) };
      }
      if (name === "fieldGroupRegistryService") {
        return { listComponents: fieldGroupList };
      }
      throw new Error(`unexpected container.get("${name}") in this test`);
    }
  );
});

describe("a caller who may read every admin count", () => {
  it("is given each one, as its own count", async () => {
    // The control for every absence below.
    const { stats } = await statsFor(ADMIN_COUNTS);
    expect(stats).toMatchObject({
      users: 3,
      roles: 4,
      permissions: 5,
      apiKeys: 7,
      fieldGroups: FIELD_GROUPS,
      content: { totalMedia: 6 },
    });
  });
});

describe("a caller who may read only some", () => {
  it("is given those, and the others are left out rather than zeroed", async () => {
    const { stats, adapter } = await statsFor(["users"]);
    expect(stats.users).toBe(3);
    for (const field of ["roles", "permissions", "apiKeys", "fieldGroups"]) {
      expect(stats, field).not.toHaveProperty(field);
    }
    expect(stats.content).not.toHaveProperty("totalMedia");
    // 🔴 Not counted at all: a count computed and then dropped still did the
    // work the decision exists to prevent.
    expect(countedTables(adapter)).toEqual(["users"]);
    expect(fieldGroupList).not.toHaveBeenCalled();
  });
});

describe("the API-key count", () => {
  it("counts only the caller's own keys when its list shows only those", async () => {
    // 🔴 The API-key list shows a caller who is not a super-admin its own keys
    // alone; a count over every user's keys would disclose the rest.
    const { stats, adapter } = await statsFor(["apiKeys"], {
      kind: "owner",
      userId: "user-9",
    });
    expect(stats.apiKeys).toBe(7);
    const [query] = apiKeyQueries(adapter);
    expect(query?.[0]).toContain('"user_id"');
    expect(query?.[1]).toContain("user-9");
  });

  it("counts every key for a caller whose list is every key", async () => {
    const { adapter } = await statsFor(["apiKeys"], { kind: "all" });
    const [query] = apiKeyQueries(adapter);
    expect(query?.[0]).not.toContain('"user_id"');
  });

  it("is left out when nobody said whose keys to count", async () => {
    // The refusal is the default, as for the counts themselves.
    const { stats, adapter } = await statsFor(["apiKeys"], null);
    expect(stats).not.toHaveProperty("apiKeys");
    expect(apiKeyQueries(adapter)).toEqual([]);
  });
});

describe("a caller who may read none", () => {
  it("is given none, whether the set is empty or not given at all", async () => {
    for (const counts of [[], undefined]) {
      const { stats, adapter } = await statsFor(counts);
      for (const field of [
        "users",
        "roles",
        "permissions",
        "apiKeys",
        "fieldGroups",
      ]) {
        expect(stats, field).not.toHaveProperty(field);
      }
      expect(stats.content).not.toHaveProperty("totalMedia");
      expect(countedTables(adapter)).toEqual([]);
      expect(fieldGroupList).not.toHaveBeenCalled();
      // The rest of the summary is still there.
      expect(stats.content.contentTypes).toBe(0);
      expect(stats.singles).toBe(0);
    }
  });
});
