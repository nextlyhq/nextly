/**
 * Proves the route-write access decoupling: a route-authorized write skips the
 * redundant RBAC gate (the middleware already ran it), `overrideAccess` remains
 * a full system bypass, and super-admin bypasses the gate on every transport
 * EXCEPT through a scoped API key.
 *
 * The API-key section is the load-bearing half. A key is authoritative on its
 * OWN stamped grants and never on its owner's roles, so the two directions are
 * asserted against each other: a key the owner's RBAC would allow but the scope
 * does not, and a key the scope allows but the owner's RBAC would deny.
 *
 * Every case here drives `checkCollectionAccess` rather than a leaf, because
 * the claim is about how the layers combine.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { CollectionAccessService } from "./collection-access-service";

import {
  callerIsSuperAdmin,
  callerMay,
  createMockDb,
  createMockAdapter,
  fakeActorForUser,
  fakeUserHoldsPermission,
  fakeUserIsSuperAdmin,
  resetCallerAccess,
  silentLogger,
} from "../__tests__/collection-test-helpers";

// The signed-in caller the gate looks up, set per test (`callerMay`); spied,
// since "was the caller looked up" is what several tests here assert.
vi.mock("../../../auth/access/resolve-actor", async importOriginal => ({
  ...(await importOriginal<object>()),
  ...(await (async () => {
    const fake = await import("../__tests__/collection-test-helpers");
    return {
      actorForUser: fake.fakeActorForUser,
      userHoldsPermission: fake.fakeUserHoldsPermission,
      userIsSuperAdmin: fake.fakeUserIsSuperAdmin,
    };
  })()),
}));

beforeEach(() => {
  resetCallerAccess();
  fakeActorForUser.mockClear();
  fakeUserHoldsPermission.mockClear();
});

function buildAccessService() {
  const getRegisteredAccess = vi.fn().mockReturnValue(undefined);
  const rbac = {
    // Answers `undefined`: no code-defined rule governs the operation.
    checkAnonymousCodeAccess: vi.fn().mockResolvedValue(undefined),
    // No code-defined access by default: a scoped API key is judged on its
    // permission grant alone unless a test registers a rule.
    getRegisteredAccess,
    // Derived from `getRegisteredAccess`, as the service derives it, so a rule a test
    // registers there reaches every caller that asks for the target.
    getRegisteredTarget: (slug: string) => {
      const access: unknown = getRegisteredAccess(slug);
      return access ? { kind: "collection", slug, access } : undefined;
    },
  };
  const service = new CollectionAccessService(
    createMockAdapter(createMockDb({ rows: [] })) as never,
    silentLogger as never,
    rbac as never
  );
  return { service, rbac };
}

// A caller with no super-admin role.
const user = { id: "user-1", roles: ["editor"] };
// A caller naming the super-admin role in both shapes a caller may carry it:
// the plural set, and the singular `role` the Direct API forwards. The names
// grant nothing; the gate looks the caller up.
const namedSuperAdmin = {
  id: "user-1",
  role: "super-admin",
  roles: ["super-admin"],
};

describe("checkCollectionAccess — route-authorized decoupling", () => {
  it("skips the redundant RBAC gate when routeAuthorized", async () => {
    const { service, rbac } = buildAccessService();
    // Would deny if it were consulted, which is what makes the skip observable
    // rather than merely unobjectionable.
    callerMay();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "update",
      user,
      overrideAccess: false,
      routeAuthorized: true,
    });

    expect(result).toBeNull();
    expect(fakeActorForUser).not.toHaveBeenCalled();
    expect(fakeUserHoldsPermission).not.toHaveBeenCalled();
  });

  it("runs the RBAC gate when NOT routeAuthorized (Direct API)", async () => {
    const { service, rbac } = buildAccessService();
    callerMay();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "update",
      user,
      overrideAccess: false,
      routeAuthorized: false,
    });

    expect(result?.statusCode).toBe(403);
    expect(fakeUserHoldsPermission).toHaveBeenCalledTimes(1);
  });

  it("bypasses everything when overrideAccess is true (system write)", async () => {
    const { service, rbac } = buildAccessService();
    callerMay();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "update",
      user,
      overrideAccess: true,
      routeAuthorized: false,
    });

    expect(result).toBeNull();
    expect(fakeActorForUser).not.toHaveBeenCalled();
    expect(fakeUserHoldsPermission).not.toHaveBeenCalled();
  });

  it("lets a super-admin, as the lookup finds them, bypass the gate", async () => {
    const { service, rbac } = buildAccessService();
    callerMay();
    callerIsSuperAdmin();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "update",
      user: { id: "user-1" },
      overrideAccess: false,
      routeAuthorized: false,
    });

    expect(result).toBeNull();
    // Asked of the targeted lookup, not by reading the caller's whole access.
    expect(fakeActorForUser).not.toHaveBeenCalled();
  });

  it("refuses a caller naming the super-admin role that the lookup does not find holding it", async () => {
    const { service, rbac } = buildAccessService();
    callerMay();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "update",
      user: namedSuperAdmin,
      overrideAccess: false,
      routeAuthorized: false,
    });

    expect(result?.statusCode).toBe(403);
  });

  it("fails closed when routeAuthorized is set without an authenticated user", async () => {
    const { service, rbac } = buildAccessService();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "update",
      user: undefined,
      overrideAccess: false,
      routeAuthorized: true,
    });

    // A bare routeAuthorized flag (e.g. a direct bulkUpdateByQuery caller) must
    // not skip the RBAC gate and fall through to the permission-less default.
    expect(result?.statusCode).toBe(403);
    expect(fakeActorForUser).not.toHaveBeenCalled();
    expect(fakeUserHoldsPermission).not.toHaveBeenCalled();
  });
});

describe("checkCollectionAccess — scoped API key", () => {
  // The publish/unpublish transition gate runs NOT route-authorized (the route
  // only attested `update`). For a scoped API key it must judge the key's OWN
  // stamped grants, never the key owner's RBAC — otherwise an update-only key
  // owned by a publisher could publish.
  const apiKeyOwner = { id: "publisher-1", roles: ["editor"] };

  it("denies a publish the key is not scoped for, even when the owner's RBAC allows", async () => {
    const { service, rbac } = buildAccessService();
    // The OWNER can publish...

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "publish",
      user: apiKeyOwner,
      overrideAccess: false,
      routeAuthorized: false,
      // ...but the KEY is scoped for update only.
      authenticatedScope: {
        actorType: "apiKey",
        permissions: ["update-posts"],
      } as never,
    });

    expect(result?.statusCode).toBe(403);
    // The owner is never looked up for a scoped key.
    expect(fakeActorForUser).not.toHaveBeenCalled();
    expect(fakeUserHoldsPermission).not.toHaveBeenCalled();
  });

  it("does not let a super-admin-owned key bypass its scope for publish", async () => {
    const { service } = buildAccessService();
    // The key's resolved role set carries super-admin (from its owner), but the
    // session super-admin bypass must NOT apply to a scoped key — otherwise an
    // update-only key issued by an admin could publish.
    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "publish",
      user: { id: "admin-1", roles: ["super-admin"] },
      overrideAccess: false,
      routeAuthorized: false,
      authenticatedScope: {
        actorType: "apiKey",
        permissions: ["update-posts"],
      } as never,
    });

    expect(result?.statusCode).toBe(403);
  });

  it("still enforces a code-defined access rule for a scoped key that holds the grant", async () => {
    const { service, rbac } = buildAccessService();
    // The key HAS publish-posts, but the collection's code-defined
    // `access.publish` denies. The grant must not bypass that rule (which the
    // session decision — the path the API-key branch replaces — would have run).
    rbac.getRegisteredAccess.mockReturnValue({ publish: () => false });

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "publish",
      user: apiKeyOwner,
      overrideAccess: false,
      routeAuthorized: false,
      authenticatedScope: {
        actorType: "apiKey",
        permissions: ["publish-posts"],
      } as never,
    });

    expect(result?.statusCode).toBe(403);
  });

  it("allows a scoped key with the grant when the code-defined rule allows", async () => {
    const { service, rbac } = buildAccessService();
    rbac.getRegisteredAccess.mockReturnValue({ publish: () => true });

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "publish",
      user: apiKeyOwner,
      overrideAccess: false,
      routeAuthorized: false,
      authenticatedScope: {
        actorType: "apiKey",
        permissions: ["publish-posts"],
      } as never,
    });

    expect(result).toBeNull();
  });

  it("allows a publish the key IS scoped for, even when the owner's RBAC denies", async () => {
    const { service, rbac } = buildAccessService();
    // The OWNER cannot publish...
    callerMay();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "publish",
      user: apiKeyOwner,
      overrideAccess: false,
      routeAuthorized: false,
      // ...but the KEY carries the publish grant.
      authenticatedScope: {
        actorType: "apiKey",
        permissions: ["update-posts", "publish-posts"],
      } as never,
    });

    expect(result).toBeNull();
    expect(fakeActorForUser).not.toHaveBeenCalled();
    expect(fakeUserHoldsPermission).not.toHaveBeenCalled();
  });

  it("falls through to the owner's RBAC for a session caller (no api-key scope)", async () => {
    const { service, rbac } = buildAccessService();
    callerMay();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "publish",
      user: apiKeyOwner,
      overrideAccess: false,
      routeAuthorized: false,
      // A session caller carries a scope with actorType "user" (or none), so the
      // owner/session RBAC decides.
      authenticatedScope: { actorType: "user", permissions: [] } as never,
    });

    expect(result?.statusCode).toBe(403);
    expect(fakeUserHoldsPermission).toHaveBeenCalledTimes(1);
  });
});
