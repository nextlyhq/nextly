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
  // `readCaller` (via `authenticated-read.ts`) resolves this to build the
  // caller it hands the dashboard service. Unmocked, it falls through to a
  // real database lookup that has nothing to connect to in this suite.
  resolveRoleSlugs: vi.fn(),
}));

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { container } from "../di";
import {
  isSuperAdmin,
  listEffectivePermissions,
  resolveRoleSlugs,
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
  (resolveRoleSlugs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
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

  it("builds the caller from readCaller's RESOLVED slugs and forwards it as the third argument", async () => {
    // Session auth carries role IDS on the auth context; `resolveRoleSlugs`
    // is what turns those into the SLUGS a role-based access rule matches.
    // The two are made deliberately different strings ("role-7" vs
    // "editor") so this assertion can actually tell "the handler forwarded
    // the resolved caller" apart from "the handler forwarded the raw auth
    // context" -- if both were "editor" the test could not distinguish them.
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "user-1",
      roles: ["role-7"],
    });
    (resolveRoleSlugs as ReturnType<typeof vi.fn>).mockResolvedValue([
      "editor",
    ]);

    const getRecentEntries = vi.fn().mockResolvedValue({ entries: [] });
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getRecentEntries,
    });

    await getDashboardRecentEntries(
      makeReq("http://x/api/dashboard/recent-entries?limit=5")
    );

    // The seam this task's whole security property runs through: had the
    // handler built `{ user: { id: auth.userId, roles: auth.roles } }` by
    // hand instead of calling `readCaller(auth)`, this would observe
    // `roles: ["role-7"]` (the unresolved id) instead of `["editor"]`, and
    // every test in the file would otherwise stay green while a
    // role-guarded collection silently returned zero rows.
    expect(getRecentEntries).toHaveBeenCalledWith(
      5,
      { kind: "all" },
      { user: { id: "user-1", roles: ["editor"], role: "editor" } }
    );
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

/**
 * The api-key branch of `resolveReadableResources`.
 *
 * `auth.userId` for an API-key request is the key's OWNER, so authorizing by
 * that id judges the key on the owner's roles rather than on the grant the key
 * was actually minted with. The whole point of a narrowly scoped key is that it
 * carries LESS reach than its owner, and a super-admin owner is where that gap
 * is widest -- so every test here makes the owner a super-admin, because a test
 * with an ordinary owner passes on the broken implementation too.
 *
 * The two permission vocabularies are not interchangeable and this is the seam
 * where they meet. `listEffectivePermissions` (session RBAC) builds
 * `${resource}:${action}` -- `posts:read`. An API key's `auth.permissions`
 * carries the `permissions.slug` column, seeded as `${action}-${resource}` --
 * `read-posts`. Reading either spelling with the other's parser yields an empty
 * scope, which fails closed and therefore looks like a working deny rather than
 * a broken read.
 */
describe("dashboard read scope for an API-KEY caller", () => {
  /** A key whose OWNER is a super-admin, bearing the key's own narrow grant. */
  function authenticateAsApiKey(permissions: string[]): void {
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "owner-1",
      authMethod: "api-key",
      permissions,
      roles: ["viewer-of-posts"],
      apiKeyId: "key-1",
    });
    // The owner really is a super-admin. If the handler authorizes by owner id
    // this resolves true and the caller gets `all` -- the defect under test.
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  }

  it("scopes /stats to the KEY's grant, not the super-admin owner's roles", async () => {
    authenticateAsApiKey(["read-posts"]);

    const getStats = vi.fn().mockResolvedValue({});
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({ getStats });

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    expect(getStats).toHaveBeenCalledWith({
      scope: { kind: "some", resources: new Set(["posts"]) },
    });
    // The owner's RBAC must not be consulted at all for an API key: the key's
    // resolved set already reflects any super-admin bypass it was entitled to.
    expect(listEffectivePermissions).not.toHaveBeenCalled();
  });

  it("scopes /activity to the KEY's grant, not the super-admin owner's roles", async () => {
    authenticateAsApiKey(["read-posts"]);

    const getRecentActivity = vi
      .fn()
      .mockResolvedValue({ activities: [], total: 0, hasMore: false });
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getRecentActivity,
    });

    await getDashboardActivity(
      makeReq("http://localhost/api/dashboard/activity")
    );

    // Without this the response carries entryTitle, userName, userEmail and
    // metadata for every collection the key holds no grant on.
    expect(getRecentActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "some", resources: new Set(["posts"]) },
      })
    );
  });

  it("admits only `read-` slugs, so a write grant confers no visibility", async () => {
    authenticateAsApiKey(["read-posts", "create-pages", "delete-orders"]);

    const getStats = vi.fn().mockResolvedValue({});
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({ getStats });

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    expect(getStats).toHaveBeenCalledWith({
      scope: { kind: "some", resources: new Set(["posts"]) },
    });
  });

  it("keeps a hyphenated resource name whole", async () => {
    // `read-site-settings` names the resource `site-settings`. A parser that
    // splits on "-" and takes index 1 yields `site`, which matches no
    // collection -- a silent empty dashboard that reads as a working deny.
    authenticateAsApiKey(["read-site-settings"]);

    const getStats = vi.fn().mockResolvedValue({});
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({ getStats });

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    expect(getStats).toHaveBeenCalledWith({
      scope: { kind: "some", resources: new Set(["site-settings"]) },
    });
  });

  it("admits nothing for a key whose grant is empty", async () => {
    // A role-based key whose role was deleted resolves to `[]`. That must
    // stay empty rather than widening to the owner's reach.
    authenticateAsApiKey([]);

    const getStats = vi.fn().mockResolvedValue({});
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({ getStats });

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    expect(getStats).toHaveBeenCalledWith({
      scope: { kind: "some", resources: new Set() },
    });
  });

  it("still grants everything to a SESSION super-admin -- the branch must not over-restrict", async () => {
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "user-1",
      authMethod: "session",
      permissions: [],
      roles: ["super-admin"],
    });
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const getStats = vi.fn().mockResolvedValue({});
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({ getStats });

    await getDashboardStats(makeReq("http://localhost/api/dashboard/stats"));

    expect(getStats).toHaveBeenCalledWith({ scope: { kind: "all" } });
  });
});
