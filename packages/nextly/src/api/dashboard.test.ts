// Pins the canonical respondData wire shape for the three dashboard
// endpoints. The handlers are exercised in isolation (auth + DI mocked) so
// the assertions focus on the response envelope and not the underlying
// service queries.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  isErrorResponse: vi.fn(),
}));

vi.mock("../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: vi.fn((errResponse: unknown) => {
    return new Error(`auth error: ${JSON.stringify(errResponse)}`);
  }),
}));

vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../di", () => ({
  container: {
    get: vi.fn(),
  },
}));

vi.mock("../services/lib/permissions", () => ({
  isSuperAdmin: vi.fn(),
  listEffectivePermissions: vi.fn(),
}));

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { container } from "../di";
import {
  isSuperAdmin,
  listEffectivePermissions,
} from "../services/lib/permissions";

import {
  getDashboardActivity,
  getDashboardRecentEntries,
  getDashboardStats,
} from "./dashboard";

function makeReq(url: string): Request {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default to authenticated super-admin so the success-path tests below
  // can override only the bits they care about.
  (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "user-1",
  });
  (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValue(false);
  (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(true);
});

describe("getDashboardStats", () => {
  it("emits respondData (no `data` envelope) for the stats payload", async () => {
    const stats = {
      content: {
        totalEntries: 47,
        totalMedia: 3,
        contentTypes: 2,
        recentChanges24h: 5,
      },
      status: { draft: 1, published: 46 },
      collectionCounts: [],
      users: 1,
      roles: 2,
      permissions: 10,
      fieldGroups: 0,
      singles: 0,
      apiKeys: 0,
    };
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getStats: vi.fn().mockResolvedValue(stats),
    });

    const res = await getDashboardStats(
      makeReq("http://x/api/dashboard/stats")
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    // Bare body, no `{ data: ... }` wrapper.
    expect(json).not.toHaveProperty("data");
    expect((json as typeof stats).content.totalEntries).toBe(47);
    expect((json as typeof stats).status).toEqual({ draft: 1, published: 46 });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Vary")).toBe("Cookie");
  });
});

describe("getDashboardRecentEntries", () => {
  it("emits respondData with the named `entries` field", async () => {
    const entries = {
      entries: [
        { id: "p1", collection: "posts", updatedAt: "2026-04-29T00:00:00Z" },
      ],
    };
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getRecentEntries: vi.fn().mockResolvedValue(entries),
    });

    const res = await getDashboardRecentEntries(
      makeReq("http://x/api/dashboard/recent-entries?limit=5")
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("data");
    expect(json).toEqual(entries);
  });
});

describe("getDashboardActivity", () => {
  it("emits respondData with cursor-shaped { activities, total, hasMore }", async () => {
    const result = {
      activities: [{ id: "a1", action: "create", collection: "posts" }],
      total: 1,
      hasMore: false,
    };
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getRecentActivity: vi.fn().mockResolvedValue(result),
    });

    const res = await getDashboardActivity(
      makeReq("http://x/api/dashboard/activity?limit=5")
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("data");
    expect(json).toEqual(result);
  });
});

describe("dashboard read scope", () => {
  it("asks the service for nothing when the caller holds no read permissions", async () => {
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (listEffectivePermissions as ReturnType<typeof vi.fn>).mockResolvedValue(
      []
    );

    const getStats = vi.fn().mockResolvedValue({});
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({ getStats });

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    // The defect was that an empty permission set reached the service as
    // "no filter" and returned every collection. The scope must arrive as an
    // EMPTY `some`, which admits nothing.
    expect(getStats).toHaveBeenCalledWith({
      scope: { kind: "some", resources: new Set() },
    });
  });

  it("asks the service for everything when the caller is a super-admin", async () => {
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const getStats = vi.fn().mockResolvedValue({});
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({ getStats });

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    expect(getStats).toHaveBeenCalledWith({ scope: { kind: "all" } });
  });

  it("passes only the readable resources through", async () => {
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (listEffectivePermissions as ReturnType<typeof vi.fn>).mockResolvedValue([
      "posts:read",
      "posts:update",
      "pages:update",
    ]);

    const getStats = vi.fn().mockResolvedValue({});
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({ getStats });

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    // `pages` is writable but not readable, so it must not appear.
    expect(getStats).toHaveBeenCalledWith({
      scope: { kind: "some", resources: new Set(["posts"]) },
    });
  });
});

describe("dashboard activity scope", () => {
  it("scopes the activity feed to the caller's readable resources", async () => {
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (listEffectivePermissions as ReturnType<typeof vi.fn>).mockResolvedValue([
      "posts:read",
    ]);

    const getRecentActivity = vi
      .fn()
      .mockResolvedValue({ activities: [], total: 0, hasMore: false });
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getRecentActivity,
    });

    await getDashboardActivity(
      makeReq("http://localhost/api/dashboard/activity")
    );

    // The defect was that no scope was passed at all, so every caller saw
    // every collection's activity.
    expect(getRecentActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "some", resources: new Set(["posts"]) },
      })
    );
  });

  it("passes an EMPTY scope through rather than omitting it", async () => {
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (listEffectivePermissions as ReturnType<typeof vi.fn>).mockResolvedValue(
      []
    );

    const getRecentActivity = vi
      .fn()
      .mockResolvedValue({ activities: [], total: 0, hasMore: false });
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getRecentActivity,
    });

    await getDashboardActivity(
      makeReq("http://localhost/api/dashboard/activity")
    );

    // The fail-closed branch. An omitted scope would let the service's own
    // default decide, and a service default is exactly what went wrong in
    // dashboard-service. The handler states it.
    expect(getRecentActivity).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { kind: "some", resources: new Set() } })
    );
  });
});
