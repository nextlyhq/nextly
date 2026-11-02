/**
 * respondX wire shapes for the endpoints that bypass the dispatcher and live
 * as private branches inside `routeHandler.ts`:
 *
 *   handleAdminMetaRequest         GET    /admin-meta
 *   handleAdminMetaSidebarGroups   PATCH  /admin-meta/sidebar-groups
 *
 * Every assertion includes a regression guard (`not.toHaveProperty("data")`)
 * to make sure the legacy `{ data: ... }` envelope cannot regress through
 * these branches. Mocks isolate the handlers from the DI container and the
 * generalSettingsService.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (must come before SUT imports so vi.mock hoisting wires up
// before module evaluation) ---------------------------------------------

// Auth middleware: the SUTs call requireAnyPermission / requirePermission
// to gate access. Tests force the happy path (auth allowed); negative auth
// paths are covered by other test suites.
vi.mock("../auth/middleware", () => ({
  admittedActionOf: vi.fn(),
  requireAnyPermission: vi.fn(),
  requirePermission: vi.fn(),
  requireAuthentication: vi.fn(),
  requireCollectionAccess: vi.fn(),
  requireCollectionWriteAccess: vi.fn(),
  requireLifecycleAccess: vi.fn(),
  isErrorResponse: vi.fn(),
  createJsonErrorResponse: vi.fn(),
}));

vi.mock("../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: vi.fn((errResponse: unknown) => {
    return new Error(`auth error: ${JSON.stringify(errResponse)}`);
  }),
}));

// `getCachedNextly` is stubbed so nothing the handlers reach boots a real
// adapter.
vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

// container.has is consulted by the admin-meta branch to decide whether
// to pull DB-overridden branding values; container.get is consulted by the
// sidebar-groups branch.
vi.mock("../di/container", () => ({
  container: {
    has: vi.fn().mockReturnValue(false),
    get: vi.fn(),
  },
}));

// `services/lib/permissions` is pulled into routeHandler to resolve a
// caller's roles. None of the tested branches resolve them, but the import
// must resolve. Derived from the real module rather than written out: a closed
// literal breaks the moment the subject imports one more export, and did.
vi.mock("../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/lib/permissions")>()),
  isSuperAdmin: vi.fn().mockResolvedValue(false),
  resolveRoleSlugs: vi.fn().mockResolvedValue([]),
}));

// The handler-config helper drives admin-meta branding; we feed it from
// `mockHandlerConfig` so individual tests can swap branding payloads.
const mockHandlerConfig: {
  admin?: {
    branding?: Record<string, unknown>;
    pluginOverrides?: Record<string, unknown>;
  };
  plugins?: unknown[];
} = {};

vi.mock("../route-handler", async () => {
  const actual =
    await vi.importActual<typeof import("../route-handler")>(
      "../route-handler"
    );
  return {
    ...actual,
    // Only the config getter is consulted by the admin-meta branch; the
    // rest of the route-handler surface (parseRestRoute, getDispatcher,
    // etc.) is irrelevant here so we keep the actual implementations.
    getHandlerConfig: vi.fn(() => mockHandlerConfig),
  };
});

// --- SUT imports (must come AFTER vi.mock calls so the mocks apply) -----

import { runWithRequestCaller } from "../auth/caller-scope";
import {
  isErrorResponse,
  requireAnyPermission,
  requirePermission,
  createJsonErrorResponse,
} from "../auth/middleware";
import { container } from "../di/container";
import { readAuthenticatedUser } from "../dispatcher/helpers/authenticated-user";
import {
  _handleAdminMetaRequestForTest,
  _handleAdminMetaSidebarGroupsForTest,
  _needsResolvedRolesForTest,
  _requestCallerForTest,
  _stripReservedIdentityParamsForTest,
} from "../routeHandler";
import { resolveRoleSlugs } from "../services/lib/permissions";
beforeEach(() => {
  vi.clearAllMocks();
  // Default: every auth gate allows the request through.
  (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValue(false);
  (requireAnyPermission as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "user-1",
    authMethod: "session",
  });
  (requirePermission as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "user-1",
    authMethod: "session",
  });
  // Reset the swapped-in handler config to an empty branding payload so
  // admin-meta defaults apply unless a test overrides them.
  for (const k of Object.keys(mockHandlerConfig)) {
    delete (mockHandlerConfig as Record<string, unknown>)[k];
  }
});

// =======================================================================
// admin-meta GET (handleAdminMetaRequest)
// =======================================================================

describe("handleAdminMetaRequest (GET /admin-meta)", () => {
  it("emits respondData (bare object body) with the resolved branding payload", async () => {
    // Provide a representative branding config so the response body has a
    // discriminating field beyond the always-included `showBuilder`.
    mockHandlerConfig.admin = {
      branding: {
        logoText: "Test Co.",
        showBuilder: false,
      },
    };

    const res = await _handleAdminMetaRequestForTest();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);

    const json = (await res.json()) as Record<string, unknown>;
    // Regression guard: legacy `{ data: ... }` envelope must not return.
    expect(json).not.toHaveProperty("data");
    // Bare body shape: branding fields live at the top level.
    expect(json.logoText).toBe("Test Co.");
    // `showBuilder` describes the installation rather than its appearance, so
    // it moved to the session-gated route with the rest of the workspace half.
    // Asserted as absent HERE rather than dropped, so the public payload's
    // boundary stays covered from this suite as well.
    expect(json.showBuilder).toBeUndefined();
  });
});

// =======================================================================
// admin-meta sidebar-groups PATCH (handleAdminMetaSidebarGroups)
// =======================================================================

describe("handleAdminMetaSidebarGroups (PATCH /admin-meta/sidebar-groups)", () => {
  it("emits respondMutation { message, item } with the updated groups", async () => {
    // Sidebar-groups requires the generalSettingsService from the DI
    // container. Wire `container.has` to true and `container.get` to a
    // service stub whose updateCustomSidebarGroups echoes the validated
    // input.
    const updated = [
      { slug: "marketing", name: "Marketing" },
      { slug: "ops", name: "Operations", icon: "wrench" },
    ];
    (container.has as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      updateCustomSidebarGroups: vi.fn().mockResolvedValue(updated),
    });

    const res = await _handleAdminMetaSidebarGroupsForTest(
      new Request("http://x/api/admin-meta/sidebar-groups", {
        method: "PATCH",
        body: JSON.stringify({ groups: updated }),
      })
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { message: string; item: unknown };
    // Regression guard: legacy `{ data: ... }` envelope must not return.
    expect(json).not.toHaveProperty("data");
    expect(json.message).toMatch(/updated/i);
    expect(json.item).toEqual(updated);
  });
});

describe("requestCallerFor", () => {
  const resolveRoleSlugsMock = vi.mocked(resolveRoleSlugs);
  const sessionUser = {
    userId: "u1",
    roles: ["role-id-1"],
    permissions: [],
    authMethod: "session" as const,
  };

  it("resolves the caller's role slugs when the route needs them", async () => {
    // Session auth carries role IDs; the handlers hand access rules SLUGS, so
    // the caller carries the resolved slugs rather than the IDs it came with.
    resolveRoleSlugsMock.mockResolvedValue(["editor"]);

    const caller = await _requestCallerForTest(sessionUser, true);

    expect(caller).toMatchObject({
      userId: "u1",
      actor: { type: "user", id: "u1" },
      roles: ["editor"],
    });
  });

  it("skips role resolution when roles are not needed", async () => {
    const caller = await _requestCallerForTest(sessionUser, false);

    expect(resolveRoleSlugsMock).not.toHaveBeenCalled();
    expect(caller?.userId).toBe("u1");
    // No roles at all, rather than an empty set standing in for "none".
    expect(caller).not.toHaveProperty("roles");
  });

  it("carries an empty role set when the user has none", async () => {
    // Resolved to nothing is still resolved: the caller says so with an empty
    // set, which the handlers read as no roles.
    resolveRoleSlugsMock.mockResolvedValue([]);

    const caller = await _requestCallerForTest(sessionUser, true);

    expect(caller?.roles).toEqual([]);
  });

  it("attributes an API-key request to the key, acting for its owner", async () => {
    // A write records the key itself as its actor, not silently the user
    // that owns the key.
    const caller = await _requestCallerForTest(
      { ...sessionUser, authMethod: "api-key", apiKeyId: "key-1" },
      false
    );

    expect(caller).toMatchObject({
      userId: "u1",
      actor: { type: "apiKey", id: "key-1" },
    });
  });

  it("carries verified claims through", async () => {
    // A stored `custom` rule may decide on a claim the framework knows nothing
    // about. Rebuilding the caller from the canonical fields alone leaves such a
    // rule reading `undefined` over HTTP while it works through the Direct API,
    // so an absence-tolerant rule admits the caller it was written to refuse.
    resolveRoleSlugsMock.mockResolvedValue(["editor"]);

    const caller = await _requestCallerForTest(
      { ...sessionUser, claims: { tenantId: "blocked" } },
      true
    );

    expect(caller?.claims).toEqual({ tenantId: "blocked" });
  });

  it("carries no claims when the caller has none", async () => {
    resolveRoleSlugsMock.mockResolvedValue(["editor"]);

    const caller = await _requestCallerForTest(sessionUser, true);

    expect(caller).not.toHaveProperty("claims");
  });

  it("is frozen, so no handler can rewrite who the request is", async () => {
    resolveRoleSlugsMock.mockResolvedValue(["editor"]);

    const caller = await _requestCallerForTest(
      { ...sessionUser, claims: { tenantId: "acme" } },
      true
    );

    expect(Object.isFrozen(caller)).toBe(true);
    expect(Object.isFrozen(caller?.actor)).toBe(true);
    expect(Object.isFrozen(caller?.roles)).toBe(true);
    expect(Object.isFrozen(caller?.claims)).toBe(true);
  });

  it("is no one when there is no authorized user", async () => {
    const caller = await _requestCallerForTest(undefined, true);

    expect(caller).toBeUndefined();
    expect(resolveRoleSlugsMock).not.toHaveBeenCalled();
  });
});

/**
 * The reserved identity param names, which `parseRestRoute` fills from the
 * query string like any other key. Identity no longer travels in them, so a
 * client-supplied copy is dropped before dispatch and nothing can read it.
 */
describe("stripReservedIdentityParams", () => {
  it("drops every reserved identity param a client sent, and keeps the rest", () => {
    // Attacker-supplied copies of what used to be server-authored identity.
    const routeParams: Record<string, string> = {
      collectionName: "posts",
      page: "2",
      _authenticatedUserId: "attacker",
      _authenticatedUserName: "Attacker",
      _authenticatedUserEmail: "attacker@example.com",
      _authenticatedUserRoles: JSON.stringify(["admin"]),
      _authenticatedActorType: "system",
      _authenticatedActorId: "forged",
      _authenticatedPermissions: JSON.stringify(["delete-posts"]),
      _authenticatedClaims: JSON.stringify({ tenantId: "acme" }),
    };

    _stripReservedIdentityParamsForTest(routeParams);

    expect(routeParams).toEqual({ collectionName: "posts", page: "2" });
  });

  it("tolerates a route with no params", () => {
    expect(() => _stripReservedIdentityParamsForTest(undefined)).not.toThrow();
  });

  it("leaves the dispatcher reading the authenticated caller, never a forged param", async () => {
    // The order the route handler runs them in: strip, then build the caller.
    // The user a handler builds comes from the caller alone, so the injected
    // id, roles and claims are nowhere in it.
    vi.mocked(resolveRoleSlugs).mockResolvedValue(["editor"]);
    const routeParams: Record<string, string> = {
      collectionName: "posts",
      _authenticatedUserId: "attacker",
      _authenticatedUserRoles: JSON.stringify(["admin"]),
      _authenticatedClaims: JSON.stringify({ tenantId: "acme" }),
    };

    _stripReservedIdentityParamsForTest(routeParams);
    const caller = await _requestCallerForTest(
      {
        userId: "u1",
        roles: ["role-id-1"],
        permissions: [],
        authMethod: "session",
        claims: { tenantId: "blocked" },
      },
      true
    );
    const user = runWithRequestCaller(caller, () => readAuthenticatedUser());

    expect(routeParams).toEqual({ collectionName: "posts" });
    expect(user).toMatchObject({
      id: "u1",
      roles: ["editor"],
      tenantId: "blocked",
    });
  });
});

/**
 * The role-resolution decision, tested apart from the caller it shapes.
 *
 * The suite above supplies `needsRoles` directly, so it can only prove that
 * building the caller honors the flag — never that a given request computes it correctly.
 * Any service or method whose access check reads roles has to be listed in the
 * decision, and a method missing from it fails silently: roles are simply absent
 * downstream, and a role-based rule then denies a caller who should be allowed.
 */
describe("needsResolvedRoles", () => {
  const resolveRoleSlugsMock = vi.mocked(resolveRoleSlugs);
  const sessionUser = {
    userId: "u1",
    roles: ["role-id-1"],
    permissions: [],
    authMethod: "session" as const,
  };

  it("resolves roles for the entry reads that evaluate stored read rules", () => {
    // These forward the caller into the query service, which evaluates the
    // collection's stored read rules (role-based matching and the super-admin
    // bypass) against the forwarded role set.
    for (const method of ["listEntries", "getEntry", "countEntries"]) {
      expect(_needsResolvedRolesForTest("collections", method, "GET")).toBe(
        true
      );
    }
  });

  it("resolves roles for the Single document read", () => {
    // Singles evaluate their stored read rule against the caller too, so a
    // role-based rule needs the resolved slugs the same way entry reads do.
    expect(
      _needsResolvedRolesForTest("singles", "getSingleDocument", "GET")
    ).toBe(true);
  });

  it("resolves roles for version reads", () => {
    for (const method of [
      "listEntryVersions",
      "getEntryVersion",
      "listSingleVersions",
      "getSingleVersion",
    ]) {
      const service = method.includes("Single") ? "singles" : "collections";
      expect(_needsResolvedRolesForTest(service, method, "GET")).toBe(true);
    }
  });

  it("resolves roles for collection and single mutations", () => {
    expect(
      _needsResolvedRolesForTest("collections", "createEntry", "POST")
    ).toBe(true);
    expect(
      _needsResolvedRolesForTest("collections", "deleteEntry", "DELETE")
    ).toBe(true);
    expect(_needsResolvedRolesForTest("singles", "updateSingle", "PATCH")).toBe(
      true
    );
  });

  it("skips the lookup for reads that consume no roles", () => {
    // A permissions query on every one of these would be paid for nothing.
    expect(_needsResolvedRolesForTest("media", "listMedia", "GET")).toBe(false);
    expect(_needsResolvedRolesForTest("singles", "getSingle", "GET")).toBe(
      false
    );
    expect(_needsResolvedRolesForTest("users", "listUsers", "GET")).toBe(false);
    // A collection preflight carries no access decision of its own.
    expect(
      _needsResolvedRolesForTest("collections", "listMeta", "OPTIONS")
    ).toBe(false);
  });

  it("carries the caller's roles all the way to the dispatcher for an entry read", async () => {
    // The full chain the entry reads depend on: decide, build the caller, then
    // read it in the handler. Asserting only the first or last link lets a
    // break in the middle pass.
    resolveRoleSlugsMock.mockResolvedValue(["editor"]);

    const caller = await _requestCallerForTest(
      sessionUser,
      _needsResolvedRolesForTest("collections", "listEntries", "GET")
    );

    const user = runWithRequestCaller(caller, () => readAuthenticatedUser());
    expect(user).toMatchObject({ id: "u1", roles: ["editor"], role: "editor" });
  });

  it("carries the caller's own claims the same way", async () => {
    // Same chain, for a claim the framework does not define. Asserting the
    // caller alone would not catch the handler's read dropping it again.
    resolveRoleSlugsMock.mockResolvedValue(["editor"]);

    const caller = await _requestCallerForTest(
      { ...sessionUser, claims: { tenantId: "acme", plan: "pro" } },
      _needsResolvedRolesForTest("collections", "listEntries", "GET")
    );

    const user = runWithRequestCaller(caller, () => readAuthenticatedUser());
    expect(user).toMatchObject({ id: "u1", tenantId: "acme", plan: "pro" });
  });

  it("does not let a claim override the authenticated identity", async () => {
    // The claims are verified, but they are still the token's account of
    // itself: a token restating `id` or `roles` must not be able to displace
    // what the route actually authenticated.
    resolveRoleSlugsMock.mockResolvedValue(["editor"]);

    const caller = await _requestCallerForTest(
      { ...sessionUser, claims: { id: "someone-else", roles: ["admin"] } },
      true
    );

    const user = runWithRequestCaller(caller, () => readAuthenticatedUser());
    expect(user).toMatchObject({ id: "u1", roles: ["editor"] });
  });
});
