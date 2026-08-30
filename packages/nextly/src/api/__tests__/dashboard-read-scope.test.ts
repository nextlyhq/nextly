/**
 * The dashboard's read scope must be the ACCESS LAYER's answer, not a re-read
 * of the permission table's slugs.
 *
 * `api/dashboard.test.ts` covers the SHAPE of the scope — that a write grant
 * confers no visibility, that an empty grant stays empty, that an API key is
 * judged on its own stamped scope. Every one of those assertions is satisfied
 * by a resolver that only ever looks at permission slugs, which is what this
 * file exists to disprove.
 *
 * A collection may be authorized ENTIRELY in code:
 *
 *     defineCollection({ slug: "posts", access: { read: ctx => ... } })
 *
 * `checkAccess` consults that rule BEFORE it falls back to the stored grants,
 * so a slug-only resolver answers a different question from the one the row
 * read answers. Both directions are wrong and only one is visible: a rule that
 * REFUSES a collection the caller holds `posts:read` for made `/stats` disclose
 * that collection's count and `/activity` disclose its entry titles, user names
 * and emails, while `GET /api/collections/posts` correctly returned 403.
 *
 * These tests therefore drive a REAL `RBACAccessControlService` with real
 * registered access rules, and stub only the database reads underneath it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { containerGet, containerHas, getStats, getRecentActivity } = vi.hoisted(
  () => ({
    containerGet: vi.fn(),
    containerHas: vi.fn(),
    getStats: vi.fn(),
    getRecentActivity: vi.fn(),
  })
);

// `api/dashboard` reads the container through `../di`, which re-exports it from
// `../di/container` — the same specifier `auth/entity-read-access` imports. One
// mock therefore serves both, and it has to: a resolver that consulted a
// DIFFERENT container from the one the RBAC service is registered in would
// silently deny everything and still look like a working scope.
vi.mock("../../di/container", () => ({
  container: { get: containerGet, has: containerHas },
}));

vi.mock("../../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  isErrorResponse: vi.fn(() => false),
}));

vi.mock("../../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: vi.fn((e: unknown) => new Error(String(e))),
}));

vi.mock("../../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

// The database underneath the access layer. `RBACAccessControlService` calls
// these directly, so stubbing them is what makes a real service runnable in a
// unit test — the registered code rules above them are NOT stubbed, because
// they are the subject.
vi.mock("../../services/lib/permissions", () => ({
  isSuperAdmin: vi.fn(),
  hasPermission: vi.fn(),
  listEffectivePermissions: vi.fn(),
  listRoleSlugsForUser: vi.fn(),
  resolveRoleSlugs: vi.fn(),
}));

import { requireAuthentication } from "../../auth/middleware";
import { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import {
  hasPermission,
  isSuperAdmin,
  listEffectivePermissions,
  listRoleSlugsForUser,
  resolveRoleSlugs,
} from "../../services/lib/permissions";
import { getDashboardActivity, getDashboardStats } from "../dashboard";

const asMock = (fn: unknown): ReturnType<typeof vi.fn> =>
  fn as ReturnType<typeof vi.fn>;

/** Two collections and one single, standing in for a real registry. */
const COLLECTIONS = [{ slug: "posts" }, { slug: "pages" }];
const SINGLES = [{ slug: "site-settings" }];

let rbac: RBACAccessControlService;

function scopeOf(spy: ReturnType<typeof vi.fn>): Set<string> {
  const arg = spy.mock.calls[0]?.[0] as {
    scope: { kind: string; resources?: Set<string> };
  };
  expect(arg.scope.kind).toBe("some");
  return arg.scope.resources as Set<string>;
}

beforeEach(() => {
  vi.clearAllMocks();
  rbac = new RBACAccessControlService();

  containerHas.mockImplementation(
    (name: string) => name === "rbacAccessControlService"
  );
  containerGet.mockImplementation((name: string) => {
    switch (name) {
      case "rbacAccessControlService":
        return rbac;
      case "collectionRegistryService":
        return { getAllCollections: vi.fn().mockResolvedValue(COLLECTIONS) };
      case "singleRegistryService":
        return { getAllSingles: vi.fn().mockResolvedValue(SINGLES) };
      case "dashboardService":
        return { getStats };
      case "activityLogService":
        return { getRecentActivity };
      default:
        throw new Error(`unexpected container.get("${name}")`);
    }
  });

  getStats.mockResolvedValue({});
  getRecentActivity.mockResolvedValue({
    activities: [],
    total: 0,
    hasMore: false,
  });

  // An ordinary editor, holding every stored read grant there is. The stored
  // grants are deliberately PERMISSIVE so that anything this scope excludes was
  // excluded by a code-defined rule and by nothing else.
  asMock(requireAuthentication).mockResolvedValue({
    userId: "alice",
    authMethod: "session",
    permissions: [],
    roles: ["role-7"],
  });
  asMock(isSuperAdmin).mockResolvedValue(false);
  asMock(hasPermission).mockResolvedValue(true);
  asMock(listEffectivePermissions).mockResolvedValue([
    "posts:read",
    "pages:read",
    "site-settings:read",
  ]);
  asMock(listRoleSlugsForUser).mockResolvedValue(["editor"]);
  asMock(resolveRoleSlugs).mockResolvedValue(["editor"]);
});

describe("a code-defined access.read rule bounds the dashboard scope", () => {
  it("excludes a collection the rule REFUSES, though the caller holds its read grant", async () => {
    // The finding, exactly: `posts` is readable only by an auditor, Alice is an
    // editor, and the permissions table still carries `posts:read` for her
    // role. `GET /api/collections/posts` answers 403; `/stats` must agree.
    rbac.registerCollectionAccess("posts", {
      read: ctx => ctx.roles.includes("auditor"),
    });

    await getDashboardStats(new Request("http://x/api/dashboard/stats"));

    expect(scopeOf(getStats).has("posts")).toBe(false);
  });

  it("keeps a collection the rule ALLOWS — the resolver must not just drop everything guarded", async () => {
    // The positive control. Without it, an implementation that excluded every
    // collection carrying any code rule would satisfy the assertion above.
    rbac.registerCollectionAccess("posts", {
      read: ctx => ctx.roles.includes("editor"),
    });

    await getDashboardStats(new Request("http://x/api/dashboard/stats"));

    expect(scopeOf(getStats).has("posts")).toBe(true);
  });

  it("honours a boolean `read: false` the same way", async () => {
    rbac.registerCollectionAccess("pages", { read: false });

    await getDashboardStats(new Request("http://x/api/dashboard/stats"));

    const scope = scopeOf(getStats);
    expect(scope.has("pages")).toBe(false);
    expect(scope.has("posts")).toBe(true);
  });

  it("admits a collection authorized ONLY in code, with no stored grant at all", async () => {
    // The other direction of the same defect. A slug-only resolver drops a
    // collection whose `read` rule allows it but whose row the permissions
    // table says nothing about, so the dashboard under-reports what the caller
    // can actually open.
    asMock(hasPermission).mockResolvedValue(false);
    asMock(listEffectivePermissions).mockResolvedValue([]);
    rbac.registerCollectionAccess("posts", { read: true });

    await getDashboardStats(new Request("http://x/api/dashboard/stats"));

    const scope = scopeOf(getStats);
    expect(scope.has("posts")).toBe(true);
    // `pages` has no rule and no grant, so it must still be refused.
    expect(scope.has("pages")).toBe(false);
  });

  it("applies the same rule to a SINGLE", async () => {
    // `getRegisteredAccess` reads the collection and single maps alike, so a
    // single resolves its own rules with no branch in the resolver.
    rbac.registerSingleAccess("site-settings", { read: false });

    await getDashboardStats(new Request("http://x/api/dashboard/stats"));

    expect(scopeOf(getStats).has("site-settings")).toBe(false);
  });

  it("bounds /activity by the same decision", async () => {
    // The endpoint that discloses entryTitle, userName and userEmail.
    rbac.registerCollectionAccess("posts", { read: false });

    await getDashboardActivity(new Request("http://x/api/dashboard/activity"));

    expect(scopeOf(getRecentActivity).has("posts")).toBe(false);
  });
});

describe("the resolver no longer parses permission slugs", () => {
  it("does not consult listEffectivePermissions at all", async () => {
    // `checkAccess` reaches the stored grants through `hasPermission`, which
    // asks about ONE resource. `listEffectivePermissions` was the slug-parsing
    // path's own source, and the access layer uses it only to build the context
    // a code rule reads — never registered here, so it must go unused.
    await getDashboardStats(new Request("http://x/api/dashboard/stats"));

    expect(listEffectivePermissions).not.toHaveBeenCalled();
    expect(hasPermission).toHaveBeenCalled();
  });

  it("keeps a hyphenated resource name whole without splitting anything", async () => {
    // `read-site-settings` names `site-settings`. The old api-key branch had to
    // strip the prefix by LENGTH to avoid yielding `site`; asking the access
    // layer removes the parser and the subtlety together.
    asMock(requireAuthentication).mockResolvedValue({
      userId: "owner-1",
      authMethod: "api-key",
      permissions: ["read-site-settings"],
      roles: ["viewer"],
    });
    asMock(resolveRoleSlugs).mockResolvedValue(["viewer"]);
    // The owner is a super-admin. A key exists to carry LESS reach than that.
    asMock(isSuperAdmin).mockResolvedValue(true);

    await getDashboardStats(new Request("http://x/api/dashboard/stats"));

    expect(scopeOf(getStats)).toEqual(new Set(["site-settings"]));
  });

  it("still refuses an API key's slug when a code rule denies it", async () => {
    asMock(requireAuthentication).mockResolvedValue({
      userId: "owner-1",
      authMethod: "api-key",
      permissions: ["read-posts", "read-pages"],
      roles: ["viewer"],
    });
    asMock(resolveRoleSlugs).mockResolvedValue(["viewer"]);
    rbac.registerCollectionAccess("posts", {
      read: ctx => ctx.roles.includes("auditor"),
    });

    await getDashboardStats(new Request("http://x/api/dashboard/stats"));

    expect(scopeOf(getStats)).toEqual(new Set(["pages"]));
  });
});

describe("a super-admin session", () => {
  it("is granted every registered entity, by the access layer's own bypass", async () => {
    // `checkAccess` short-circuits on `isSuperAdmin` before it reads any rule,
    // so the resolver needs no super-admin branch of its own.
    asMock(isSuperAdmin).mockResolvedValue(true);
    asMock(hasPermission).mockResolvedValue(false);
    rbac.registerCollectionAccess("posts", { read: false });

    await getDashboardStats(new Request("http://x/api/dashboard/stats"));

    expect(scopeOf(getStats)).toEqual(
      new Set(["posts", "pages", "site-settings"])
    );
  });
});

describe("the resolver fails closed", () => {
  it("admits nothing when the registries cannot be reached", async () => {
    containerGet.mockImplementation((name: string) => {
      if (name === "dashboardService") return { getStats };
      if (name === "rbacAccessControlService") return rbac;
      throw new Error("registry unavailable");
    });

    await getDashboardStats(new Request("http://x/api/dashboard/stats"));

    expect(scopeOf(getStats)).toEqual(new Set());
  });
});
